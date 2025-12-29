import { useState, useEffect, useRef } from 'react';
import './index.css';

function App() {
    const [formData, setFormData] = useState({
        topic: '',
        duration_seconds: 30,
        tone: 'informative',
    });
    const [response, setResponse] = useState(null);
    const [loading, setLoading] = useState(false);
    const [isMarked, setIsMarked] = useState(false);
    const [pollInterval, setPollInterval] = useState(null);
    const [activeTab, setActiveTab] = useState('generate');
    const [jobHistory, setJobHistory] = useState([]);
    const [brainstormedScript, setBrainstormedScript] = useState(null);
    const [isBrainstorming, setIsBrainstorming] = useState(false);

    // Preview State
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const timerRef = useRef(null);
    const videoRef = useRef(null);

    const tones = [
        { value: 'informative', icon: '📚', label: 'Informative', desc: 'Clear & Educational' },
        { value: 'dramatic', icon: '🎬', label: 'Dramatic', desc: 'Intense & Cinematic' },
        { value: 'motivational', icon: '🔥', label: 'Motivational', desc: 'Inspiring & Bold' },
        { value: 'neutral', icon: '⚖️', label: 'Neutral', desc: 'Balanced & Calm' },
    ];

    const voices = [
        { id: 'storyteller', name: 'The Storyteller', icon: '📖', desc: 'Warm & Engaging' },
        { id: 'hype', name: 'Hype Ninja', icon: '⚡', desc: 'High Energy & Viral' },
        { id: 'professor', name: 'The Professor', icon: '🎓', desc: 'Deep & Authoritative' },
        { id: 'whisper', name: 'Soft Whisper', icon: '🍃', desc: 'Calm & Relaxing' },
    ];

    const captionStyles = [
        { id: 'beast', name: 'Beast Style', icon: '🦁', color: '#fbbf24' },
        { id: 'cyber', name: 'Cyberpunk', icon: '🦾', color: '#ff00ff' },
        { id: 'minimal', name: 'Minimalist', icon: '⚪', color: '#ffffff' },
        { id: 'bold', name: 'Neon Bold', icon: '🌈', color: '#00ffcc' },
    ];

    // Load history on mount
    useEffect(() => {
        const history = JSON.parse(localStorage.getItem('viralflow_history') || '[]');
        setJobHistory(history);
    }, []);

    // Save to history when a job completes
    useEffect(() => {
        if (response?.status === 'COMPLETED' && response.result?.video_path) {
            const history = JSON.parse(localStorage.getItem('viralflow_history') || '[]');
            const exists = history.find(h => h.job_id === (response.job_id || response.id));
            if (!exists) {
                const newEntry = {
                    job_id: response.job_id || response.id,
                    topic: formData.topic,
                    video_path: response.result.video_path,
                    thumbnail: response.result.thumbnail_path || null,
                    date: new Date().toISOString()
                };
                const updatedHistory = [newEntry, ...history].slice(0, 20); // Keep last 20
                localStorage.setItem('viralflow_history', JSON.stringify(updatedHistory));
                setJobHistory(updatedHistory);
            }
        }
    }, [response]);

    const handleGenerate = async (brainstormOnly = false) => {
        if (!formData.topic.trim()) {
            alert('Please enter a topic!');
            return;
        }

        if (brainstormOnly) {
            setIsBrainstorming(true);
        } else {
            setLoading(true);
            setResponse(null);
            setIsPlaying(false);
            setCurrentTime(0);
            setIsMarked(false);
        }

        try {
            const res = await fetch('http://localhost:5001/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    duration_seconds: parseInt(formData.duration_seconds),
                    dry_run: brainstormOnly // We'll use dry_run for brainstorming
                }),
            });

            if (!res.ok) throw new Error('Failed to generate');

            const data = await res.json();

            if (brainstormOnly) {
                // Poll for brainstorm result
                const pollId = setInterval(async () => {
                    try {
                        const statusRes = await fetch(`http://localhost:5001/api/status/${data.job_id}`);
                        const statusData = await statusRes.json();

                        if (statusData.status === 'COMPLETED') {
                            setBrainstormedScript(statusData.result.script);
                            clearInterval(pollId);
                            setIsBrainstorming(false);
                        } else if (statusData.status === 'FAILED') {
                            alert('Brainstorming failed.');
                            clearInterval(pollId);
                            setIsBrainstorming(false);
                        }
                    } catch (err) {
                        console.error('Brainstorm poll error:', err);
                    }
                }, 2000);
            } else {
                setResponse(data);
                // ... (rest of the logic)
                setActiveTab('monitor');

                // Auto-poll status
                let checkCount = 0;
                const pollId = setInterval(async () => {
                    checkCount++;
                    if (checkCount > 180) { // Max 15 minutes
                        clearInterval(pollId);
                        return;
                    }

                    try {
                        const statusRes = await fetch(`http://localhost:5001/api/status/${data.job_id}`);
                        const statusData = await statusRes.json();
                        setResponse(statusData);

                        if (statusData.status === 'COMPLETED' || statusData.status === 'FAILED') {
                            clearInterval(pollId);
                        }
                    } catch (err) {
                        console.error('Poll error:', err);
                    }
                }, 5000);

                setPollInterval(pollId);
            }
        } catch (error) {
            if (!brainstormOnly) {
                setResponse({ error: error.message });
                setActiveTab('monitor');
            } else {
                alert(`Brainstorm failed: ${error.message}`);
            }
        } finally {
            setLoading(false);
            setIsBrainstorming(false);
        }
    };

    const checkStatus = async () => {
        const jobId = response?.job_id || response?.id;
        if (!jobId) return;

        try {
            const res = await fetch(`http://localhost:5001/api/status/${jobId}`);
            const data = await res.json();
            setResponse(data);

            const markRes = await fetch(`http://localhost:5001/api/is-marked/${jobId}`);
            const markData = await markRes.json();
            setIsMarked(markData.isMarked);
        } catch (error) {
            console.error('Status check failed:', error);
        }
    };

    const toggleMark = async () => {
        const jobId = response?.job_id || response?.id;
        if (!jobId) return;

        try {
            const endpoint = isMarked ? 'unmark' : 'mark';
            await fetch(`http://localhost:5001/api/${endpoint}/${jobId}`, { method: 'POST' });
            setIsMarked(!isMarked);
        } catch (error) {
            console.error('Failed to toggle mark:', error);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleToneSelect = (tone) => {
        setFormData(prev => ({ ...prev, tone }));
    };

    // Caption Preview Logic
    useEffect(() => {
        if (isPlaying) {
            const interval = 50;
            timerRef.current = setInterval(() => {
                setCurrentTime(prev => {
                    const next = prev + interval;
                    const duration = response?.result?.audio?.duration_ms || 30000;
                    if (next > duration) {
                        setIsPlaying(false);
                        return 0;
                    }
                    return next;
                });
            }, interval);
        } else {
            clearInterval(timerRef.current);
        }
        return () => clearInterval(timerRef.current);
    }, [isPlaying, response]);

    const getCurrentCaption = () => {
        if (!response?.result?.captions?.timeline) return null;
        return response.result.captions.timeline.find(
            cap => currentTime >= cap.start_ms && currentTime <= cap.end_ms
        );
    };

    const activeCaption = getCurrentCaption();
    const duration = response?.result?.audio?.duration_ms || 30000;
    const progress = response?.progress || 0;

    const getStatusColor = (status) => {
        switch (status) {
            case 'COMPLETED': return '#10b981';
            case 'FAILED': return '#ef4444';
            case 'PROCESSING': return '#3b82f6';
            case 'QUEUED': return '#f59e0b';
            default: return '#6b7280';
        }
    };

    const getStatusEmoji = (status) => {
        switch (status) {
            case 'COMPLETED': return '✨';
            case 'FAILED': return '❌';
            case 'PROCESSING': return '⚙️';
            case 'SCRIPTING': return '✍️';
            case 'AUDIO_GEN': return '🎙️';
            case 'CAPTION_GEN': return '📝';
            case 'VISUAL_GEN': return '🎨';
            case 'EDITING': return '🎬';
            case 'EDIT_READY': return '🎯';
            case 'QUEUED': return '⏳';
            default: return '🔄';
        }
    };

    return (
        <div className="app-container">
            {/* Header */}
            <header className="header">
                <div className="header-content">
                    <div className="logo">
                        <span className="logo-icon">🎬</span>
                        <div>
                            <h1 className="title">ViralFlow</h1>
                            <p className="subtitle">AI-Powered Short Video Generation</p>
                        </div>
                    </div>
                    <div className="header-stats">
                        <div className="stat">
                            <span className="stat-number">∞</span>
                            <span className="stat-label">Videos</span>
                        </div>
                        <div className="stat">
                            <span className="stat-number">AI</span>
                            <span className="stat-label">Powered</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Navigation Tabs */}
            <nav className="tabs-nav">
                <button
                    className={`tab ${activeTab === 'generate' ? 'active' : ''}`}
                    onClick={() => setActiveTab('generate')}
                >
                    <span>✨</span> Generate
                </button>
                <button
                    className={`tab ${activeTab === 'monitor' ? 'active' : ''}`}
                    onClick={() => setActiveTab('monitor')}
                >
                    <span>📊</span> Monitor {response && <span className="badge-small">{response.status}</span>}
                </button>
                <button
                    className={`tab ${activeTab === 'history' ? 'active' : ''}`}
                    onClick={() => setActiveTab('history')}
                >
                    <span>📚</span> Library
                </button>
            </nav>

            {/* Main Content */}
            <main className="main-content">
                {activeTab === 'generate' ? (
                    <section className="generate-section">
                        <div className="section-header">
                            <h2>Create Your Viral Video</h2>
                            <p>Tell the AI what your video is about, choose the vibe, and watch the magic happen</p>
                        </div>

                        {/* Topic Input */}
                        <div className="form-card">
                            <label className="form-label">
                                <span className="label-text">📝 What's Your Video About?</span>
                                <span className="char-count">{formData.topic.length}/200</span>
                            </label>
                            <textarea
                                name="topic"
                                className="topic-input"
                                placeholder="e.g., How to make the perfect morning coffee in 30 seconds..."
                                value={formData.topic}
                                onChange={handleChange}
                                maxLength="200"
                                rows="4"
                            />
                            <p className="input-hint">Be specific and creative! The AI uses this to generate your script.</p>
                        </div>

                        {/* Duration Slider */}
                        <div className="form-card">
                            <label className="form-label">
                                <span className="label-text">⏱️ Video Duration</span>
                                <span className="duration-display">{formData.duration_seconds}s</span>
                            </label>
                            <div className="slider-container">
                                <input
                                    type="range"
                                    name="duration_seconds"
                                    min="20"
                                    max="60"
                                    step="5"
                                    value={formData.duration_seconds}
                                    onChange={handleChange}
                                    className="duration-slider"
                                />
                                <div className="slider-labels">
                                    <span>20s</span>
                                    <span>30s</span>
                                    <span>40s</span>
                                    <span>50s</span>
                                    <span>60s</span>
                                </div>
                            </div>
                        </div>

                        {/* Voice Selection */}
                        <div className="form-card">
                            <label className="form-label">🗣️ Voice Character</label>
                            <div className="voice-grid">
                                {voices.map(voice => (
                                    <div
                                        key={voice.id}
                                        className={`voice-card ${formData.voice === voice.id ? 'selected' : ''}`}
                                        onClick={() => setFormData(prev => ({ ...prev, voice: voice.id }))}
                                    >
                                        <div className="voice-icon">{voice.icon}</div>
                                        <div className="voice-info">
                                            <div className="voice-name">{voice.name}</div>
                                            <div className="voice-desc">{voice.desc}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Caption Style Selection */}
                        <div className="form-card">
                            <label className="form-label">✨ Caption Style</label>
                            <div className="caption-style-grid">
                                {captionStyles.map(style => (
                                    <div
                                        key={style.id}
                                        className={`style-card ${formData.captionStyle === style.id ? 'selected' : ''}`}
                                        onClick={() => setFormData(prev => ({ ...prev, captionStyle: style.id }))}
                                        style={{ '--highlight': style.color }}
                                    >
                                        <div className="style-icon">{style.icon}</div>
                                        <div className="style-name">{style.name}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="action-grid">
                            <button
                                className={`brainstorm-btn ${isBrainstorming ? 'loading' : ''}`}
                                onClick={() => handleGenerate(true)}
                                disabled={isBrainstorming || loading || !formData.topic.trim()}
                            >
                                {isBrainstorming ? <span className="spinner"></span> : '🧠 Brainstorm Script'}
                            </button>
                            <button
                                className={`generate-btn ${loading ? 'loading' : ''}`}
                                onClick={() => handleGenerate(false)}
                                disabled={loading || isBrainstorming || !formData.topic.trim()}
                            >
                                {loading ? (
                                    <>
                                        <span className="spinner"></span>
                                        Generating...
                                    </>
                                ) : (
                                    <>
                                        <span className="btn-icon">🚀</span>
                                        Generate Video
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Brainstorm Result Preview */}
                        {brainstormedScript && (
                            <div className="brainstorm-preview glass-card animate-fadeIn">
                                <div className="preview-header">
                                    <h4>🧠 Script Draft</h4>
                                    <button className="close-btn" onClick={() => setBrainstormedScript(null)}>✕</button>
                                </div>
                                <div className="preview-content">
                                    <div className="scene-list">
                                        {(brainstormedScript.scenes || []).map((scene, idx) => (
                                            <div key={idx} className="scene-item">
                                                <span className="scene-tag">{scene.type.replace('_', ' ')}</span>
                                                <p>{scene.text}</p>
                                                <div className="scene-keywords">
                                                    {(scene.keywords || []).map((kw, kIdx) => (
                                                        <span key={kIdx} className="kw-tag">#{kw}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="preview-footer">
                                        <div className="preview-badge">Modular Scene Plan Ready ✨</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Info Cards */}
                        <div className="info-grid">
                            <div className="info-card">
                                <div className="info-icon">⚡</div>
                                <h3>Lightning Fast</h3>
                                <p>Generate complete videos in seconds using cutting-edge AI</p>
                            </div>
                            <div className="info-card">
                                <div className="info-icon">🎯</div>
                                <h3>AI-Optimized</h3>
                                <p>Perfect for social media with viral-ready captions and effects</p>
                            </div>
                            <div className="info-card">
                                <div className="info-icon">🎬</div>
                                <h3>Professional</h3>
                                <p>Cinema-grade quality with AI-selected stock footage</p>
                            </div>
                        </div>
                    </section>
                ) : activeTab === 'monitor' ? (
                    <section className="monitor-section">
                        {response ? (
                            <>
                                {/* ... existing monitor code ... */}
                                {/* [REPLACING WITH CONDENSED VERSION FOR BREVITY IN MULTI-REPLACE] */}
                                <div className="status-header">
                                    <div className="status-info">
                                        <div className="status-badge" style={{ borderColor: getStatusColor(response.status) }}>
                                            <span className="status-emoji">{getStatusEmoji(response.status)}</span>
                                            <span className="status-text">{response.status.replace(/_/g, ' ')}</span>
                                        </div>
                                        <div>
                                            <h3>Job ID</h3>
                                            <code className="job-id">{response.job_id || response.id}</code>
                                        </div>
                                    </div>
                                    <div className="status-actions">
                                        <button
                                            className={`action-btn star-btn ${isMarked ? 'marked' : ''}`}
                                            onClick={toggleMark}
                                            title={isMarked ? 'Remove star' : 'Add star'}
                                        >
                                            {isMarked ? '⭐' : '☆'} {isMarked ? 'Starred' : 'Star'}
                                        </button>
                                        <button
                                            className="action-btn refresh-btn"
                                            onClick={checkStatus}
                                            title="Refresh status"
                                        >
                                            🔄 Refresh
                                        </button>
                                    </div>
                                </div>

                                {/* Progress Section */}
                                {(response.status === 'PROCESSING' || response.status === 'QUEUED') && (
                                    <div className="progress-section">
                                        <div className="progress-header">
                                            <h4>Processing Progress</h4>
                                            <span className="progress-percent">{response.progress || 0}%</span>
                                        </div>
                                        <div className="progress-bar-wrapper">
                                            <div
                                                className="progress-bar"
                                                style={{ width: `${response.progress || 0}%` }}
                                            ></div>
                                        </div>
                                        {response.eta_seconds > 0 && (
                                            <div className="eta-display">
                                                ⏱️ Estimated time remaining: <strong>{response.eta_seconds}s</strong>
                                            </div>
                                        )}
                                        <div className="phase-indicator">
                                            <p className="current-phase">
                                                {getStatusEmoji(response.status)} {response.status.replace(/_/g, ' ')}
                                                {response.message && <span className="sub-status"> — {response.message}</span>}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Completed - Show Video */}
                                {response.status === 'COMPLETED' && response.result?.video_path && (
                                    <div className="completed-section">
                                        <div className="success-badge">✨ Your Video is Ready! ✨</div>
                                        <div className="video-preview-container">
                                            <video
                                                ref={videoRef}
                                                src={`http://localhost:5001${response.result.video_path}`}
                                                controls
                                                className="video-player"
                                            />
                                        </div>
                                        <div className="download-section">
                                            <a
                                                href={`http://localhost:5001${response.result.video_path}`}
                                                download
                                                className="download-btn"
                                            >
                                                ⬇️ Download Video
                                            </a>
                                            <button
                                                className="new-video-btn"
                                                onClick={() => setActiveTab('generate')}
                                            >
                                                ✨ Create Another
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Failed */}
                                {response.status === 'FAILED' && (
                                    <div className="error-section">
                                        <div className="error-icon">❌</div>
                                        <h3>Generation Failed</h3>
                                        <p>{response.result?.error || 'Unknown error'}</p>
                                        <button className="retry-btn" onClick={() => setActiveTab('generate')}>🔄 Try Again</button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="empty-state">
                                <div className="empty-icon">📊</div>
                                <h3>No active job</h3>
                                <p>Start generating to monitor progress</p>
                            </div>
                        )}
                    </section>
                ) : (
                    <section className="history-section animate-fadeIn">
                        <div className="section-header">
                            <h2>📚 Your Creation Library</h2>
                            <p>All your cinematic masterpieces in one place</p>
                        </div>

                        {jobHistory.length > 0 ? (
                            <div className="history-grid">
                                {jobHistory.map(job => (
                                    <div key={job.job_id} className="history-card glass-card">
                                        <div className="job-date">{new Date(job.date).toLocaleDateString()}</div>
                                        <div className="job-topic">{job.topic}</div>
                                        <div className="job-actions">
                                            <button
                                                className="view-btn"
                                                onClick={() => {
                                                    setResponse({ job_id: job.job_id, status: 'COMPLETED', result: { video_path: job.video_path } });
                                                    setActiveTab('monitor');
                                                }}
                                            >
                                                👁️ View
                                            </button>
                                            <a href={`http://localhost:5001${job.video_path}`} download className="job-download">
                                                ⬇️ Save
                                            </a>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <div className="empty-icon">🎬</div>
                                <h3>Library is Empty</h3>
                                <p>You haven't generated any videos yet. Time to create magic!</p>
                            </div>
                        )}
                    </section>
                )}
            </main>

            {/* Footer */}
            <footer className="footer">
                <p>🎬 ViralFlow • AI Short Video Generation • Powered by Gemini & FFmpeg</p>
            </footer>
        </div>
    );
}

export default App;
