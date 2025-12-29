/**
 * PHASE 7: Rendering Service
 * 
 * Converts prepared assets (audio + captions + visual timeline + edit plan)
 * into a final vertical short-form video using FFmpeg.
 * 
 * Core responsibilities:
 * 1. Build FFmpeg filter graphs (video + audio + captions)
 * 2. Construct FFmpeg command with proper layer composition
 * 3. Execute rendering with error capture and diagnostics
 * 4. Validate output and attach results to job
 * 5. Support dry-run and preview modes
 * 
 * OUTPUT REQUIREMENTS (NON-NEGOTIABLE):
 * - Aspect ratio: 9:16
 * - Resolution: 1080×1920
 * - Duration: ≤ 60 seconds
 * - Video codec: H.264
 * - Audio codec: AAC
 * - Bitrate: 5000k (platform-safe)
 * - No black frames, no clipped captions
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { execSync, spawn } = require('child_process');
const assetCache = require('./assetCache');

class RenderingService {
    constructor() {
        // Output specifications
        this.TARGET_WIDTH = 1080;
        this.TARGET_HEIGHT = 1920;
        this.TARGET_FPS = 30;
        this.VIDEO_BITRATE = '8000k';
        this.AUDIO_BITRATE = '192k';

        // Output directory (temp)
        this.OUTPUT_DIR = path.join(__dirname, '../../temp_output');
        if (!fs.existsSync(this.OUTPUT_DIR)) {
            fs.mkdirSync(this.OUTPUT_DIR, { recursive: true });
        }

        // Caption rendering parameters
        this.CAPTION_FONT = 'Arial';
        this.CAPTION_FONTSIZE = 60;
        this.CAPTION_COLOR = 'white';
        this.CAPTION_SHADOWCOLOR = 'black';
        this.CAPTION_SHADOWX = 2;
        this.CAPTION_SHADOWY = 2;
        this.CAPTION_MARGIN = 60; // pixels from edge

        // Emphasis styling
        this.EMPHASIS_COLOR = 'gold';
        this.EMPHASIS_FONTSIZE_MULT = 1.1; // 10% larger for emphasis
    }

    /**
     * Main entry point: assemble and render video from edit-ready job
     * @param {Object} job - Job with result containing audio, captions, visuals, edit plan
     * @param {Object} options - { dryRun: boolean, preview: boolean, debug: boolean }
     * @returns {Promise<{success: boolean, videoPath?: string, error?: string, diagnostics?: Object}>}
     */
    async renderSegment({ jobId, sceneIdx, audio, captions, visuals, edit }) {
        console.log(`[Rendering] Rendering segment ${sceneIdx} for job ${jobId}...`);

        const segmentPath = path.join(this.OUTPUT_DIR, `job_${jobId}_scene_${sceneIdx}.mp4`);
        const filterGraph = this._buildFilterGraph({
            audioPath: audio.audio_path,
            editPlan: edit.plan,
            visualTimeline: visuals.timeline,
            captions: captions.timeline,
            preview: false
        });

        const filterScriptPath = path.resolve(this.OUTPUT_DIR, `filter_graph_${jobId}_scene_${sceneIdx}.ffm`);
        fs.writeFileSync(filterScriptPath, filterGraph);

        const args = this._buildFFmpegCommand({ id: `${jobId}_scene_${sceneIdx}`, outputPath: segmentPath }, {
            audio,
            visuals,
            edit
        }, filterScriptPath);

        try {
            await this._executeFFmpeg(args, `${jobId}_scene_${sceneIdx}`);
            return segmentPath;
        } finally {
            if (fs.existsSync(filterScriptPath)) fs.unlinkSync(filterScriptPath);
        }
    }

    async render(job, options = {}) {
        const { dryRun = false, preview = false, debug = false } = options;

        console.log(`[Rendering] Starting render for job ${job.id}...`);

        try {
            // Extract and validate inputs
            const { audio, captions, visuals, edit } = job.result;

            if (!audio || !captions || !visuals || !edit) {
                throw new Error('Missing required result data: audio, captions, visuals, or edit plan');
            }

            // Resolve audio file path
            const audioPath = this._resolveAssetPath(audio.audio_path);
            if (!fs.existsSync(audioPath)) {
                throw new Error(`Audio file not found: ${audioPath}`);
            }

            // Build filter graph components
            const filterGraph = this._buildFilterGraph({
                audioPath,
                editPlan: edit.plan,
                visualTimeline: visuals.timeline,
                captions: captions.timeline,
                preview
            });

            // Write filter graph to a script file to avoid Windows command line length limits
            const filterScriptPath = path.resolve(this.OUTPUT_DIR, `filter_graph_${job.id}.ffm`);
            fs.writeFileSync(filterScriptPath, filterGraph);

            // Construct FFmpeg command
            job.outputPath = path.join(this.OUTPUT_DIR, `output_${job.id}.mp4`);
            const ffmpegCmd = this._buildFFmpegCommand(job, job.result, filterScriptPath);

            if (debug || dryRun) {
                console.log('[Rendering] FFmpeg command:');
                console.log(ffmpegCmd);
            }

            if (dryRun) {
                console.log('[Rendering] Dry-run mode: command printed, not executed');
                return {
                    success: true,
                    dryRun: true,
                    command: ffmpegCmd,
                    diagnostics: { mode: 'dry-run', filterGraph }
                };
            }

            // Execute FFmpeg
            const diagnostics = {
                audioPath,
                outputPath: job.outputPath,
                filterGraph,
                command: ffmpegCmd,
                mode: preview ? 'preview' : 'full'
            };

            try {
                console.log(`[Rendering] Executing FFmpeg render...`);
                const result = await this._executeFFmpeg(ffmpegCmd, job.id);

                if (result.success) {
                    // Validate output
                    const isValid = this._validateOutput(job.outputPath);
                    if (!isValid.valid) {
                        throw new Error(`Output validation failed: ${isValid.reason}`);
                    }

                    console.log(`[Rendering] Render complete: ${job.outputPath}`);
                    return {
                        success: true,
                        videoPath: job.outputPath,
                        diagnostics
                    };
                } else {
                    // Capture error diagnostics
                    console.error("FFMPEG STDERR DUMP:", result.stderr);
                    throw new Error(`FFmpeg execution failed: ${result.error}`);
                }
            } finally {
                // Cleanup the filter script in all cases (success, failure, or exception)
                if (fs.existsSync(filterScriptPath)) {
                    console.log(`[Rendering] Cleaning up filter script: ${filterScriptPath}`);
                    fs.unlinkSync(filterScriptPath);
                }
            }

        } catch (error) {
            console.error(`[Rendering] Error: ${error.message}`);
            return {
                success: false,
                error: error.message,
                diagnostics: {
                    errorType: this._classifyError(error.message),
                    timestamp: new Date().toISOString()
                }
            };
        }
    }

    /**
     * Build the complete filter graph for all layers:
     * 1. Video layer: concatenate clips with transforms
     * 2. Audio layer: voiceover with normalization
     * 3. Caption layer: drawtext filters for each caption
     * 
     * @returns {String} FFmpeg filter_complex string
     */
    _buildFilterGraph({ audioPath, editPlan, visualTimeline, captions, preview }) {
        // Sanitize paths for FFmpeg
        visualTimeline.forEach(v => {
            if (v.file_path) v.file_path = v.file_path.replace(/\\/g, '/');
        });

        // Build video layer: concatenate clips according to edit plan
        const videoFilter = this._buildVideoLayer(editPlan, visualTimeline, preview);

        // Build caption overlay filters
        const captionFilters = this._buildCaptionFilters(captions, editPlan);

        // Compose the full filter graph
        // videoFilter -> captionFilters -> output
        const fullFilter = captionFilters.length > 0
            ? `${videoFilter};${captionFilters.join('')}`
            : `${videoFilter};[video_out]null[final_video]`;

        return fullFilter;
    }

    /**
     * Build video layer: concatenate clips with zoom/pan transforms
     * Clips are sequenced according to edit plan with timing accuracy
     * 
     * @returns {String} Video filter string
     */
    _buildVideoLayer(editPlan, visualTimeline, preview) {
        // Build input references for each unique clip
        let inputIndex = 0;
        const inputMap = {}; // clip_id -> input index
        const clipInputs = [];
        const seenClips = new Set();
        editPlan.forEach(entry => {
            if (!seenClips.has(entry.clip_id)) {
                const clip = visualTimeline.find(v => v.clip_id === entry.clip_id);
                if (clip) {
                    inputMap[entry.clip_id] = inputIndex;
                    clipInputs.push(clip);
                    seenClips.add(entry.clip_id);
                    inputIndex++;
                }
            }
        });

        let filterParts = [];

        editPlan.forEach((entry, idx) => {
            const inputIdx = inputMap[entry.clip_id];

            // Calculate segment duration with precision
            const durationMs = entry.end_ms - entry.start_ms;
            const durationSec = (durationMs / 1000).toFixed(3);

            // 1. Transform & Normalize Filter (Zoom/Pan/Scale/FPS/Format)
            // Takes [inputIdx] -> Produces [seg_idx]
            // We normalize EACH segment to target specs before it hits the concat filter.
            const normPad = `norm_${idx}`;
            const transformFilter = this._buildNormalizationChain(
                inputIdx,
                entry.zoom,
                entry.pan,
                normPad
            );
            filterParts.push(transformFilter);

            // 2. Trim Filter
            // Takes [norm_idx] -> Produces [seg_idx]
            const trimFilter = `[${normPad}]trim=duration=${durationSec},setpts=PTS-STARTPTS[seg_${idx}]`;
            filterParts.push(trimFilter);
        });

        // Concatenate all segments
        let concatInput = '';
        for (let i = 0; i < editPlan.length; i++) {
            concatInput += `[seg_${i}]`;
        }
        concatInput += `concat=n=${editPlan.length}:v=1:a=0[video_out]`;
        filterParts.push(`${concatInput}`);

        return filterParts.join(';');
    }

    /**
     * Build normalization + transform filter string for a single segment
     * [input] -> Scale -> Pad -> FPS -> Format -> [outputPad]
     */
    _buildNormalizationChain(inputIdx, zoom, pan, outputPad) {
        const tw = this.TARGET_WIDTH;
        const th = this.TARGET_HEIGHT;
        const z = zoom || 1.0;
        const fps = this.TARGET_FPS;

        // 1. Scale to cover target with zoom factor
        const scaledW = Math.floor(tw * z);
        const scaledH = Math.floor(th * z);

        let chain = `[${inputIdx}]scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase:flags=bicubic`;

        // 2. Crop/Pan
        const offsets = this._getPanOffset(pan, scaledW, scaledH, tw, th);
        chain += `,crop=${tw}:${th}:${Math.floor(offsets.x)}:${Math.floor(offsets.y)}`;

        // 3. Normalize FPS and Pixel Format (CRITICAL for concat filter stability)
        // We use fps filter to ensure constant frame rate and format for pixel format
        chain += `,fps=${fps},format=yuv420p`;

        chain += `[${outputPad}]`;
        return chain;
    }

    /**
     * Calculate pan offset
     */
    _getPanOffset(pan, currentW, currentH, targetW, targetH) {
        // Center default
        const centerX = (currentW - targetW) / 2;
        const centerY = (currentH - targetH) / 2;

        if (!pan || pan === 'none') return { x: centerX, y: centerY };

        // Simple offset logic: 
        // 'left' -> x=0
        // 'right' -> x=max
        // 'up' -> y=0
        // 'down' -> y=max

        switch (pan) {
            case 'left': return { x: 0, y: centerY };
            case 'right': return { x: currentW - targetW, y: centerY };
            case 'up': return { x: centerX, y: 0 };
            case 'down': return { x: centerX, y: currentH - targetH };
            default: return { x: centerX, y: centerY };
        }
    }

    /**
     * Build caption overlay filters
     * Returns array of filter strings to be composed
     * Uses FFmpeg drawtext filter for each caption timing
     */
    _buildCaptionFilters(captions, editPlan) {
        const filters = [];

        // Map captions by ID for quick lookup
        const captionMap = {};
        captions.forEach(cap => {
            // Generate caption ID
            const id = `cap_${captions.indexOf(cap)}`;
            captionMap[id] = cap;
        });

        // Track which captions to display
        const captionTimings = [];
        editPlan.forEach(entry => {
            if (entry.caption_id && entry.caption_id.startsWith('cap_')) {
                const caption = captionMap[entry.caption_id];
                if (caption) {
                    captionTimings.push({
                        text: caption.text,
                        startTime: (entry.start_ms / 1000).toFixed(3),
                        endTime: (entry.end_ms / 1000).toFixed(3),
                        emphasis_indices: caption.emphasis_indices || [],
                        style: caption.style || {}
                    });
                }
            }
        });

        if (captionTimings.length === 0) {
            return []; // No captions
        }

        // Build drawtext filter for each caption
        const drawTextFilters = captionTimings.map(cap => {
            const options = this._buildDrawTextOptions(cap);
            return `drawtext=${options}`;
        });

        // Join all drawtext filters with commas for a linear chain
        const filterChain = `[video_out]${drawTextFilters.join(',')}[final_video]`;

        return [filterChain];
    }

    /**
     * Build FFmpeg drawtext filter options for a caption
     */
    _buildDrawTextOptions(caption) {
        const options = [];

        // Text with escape sequences for FFmpeg
        const text = this._escapeDrawTextString(caption.text);

        options.push(`text='${text}'`);

        // Timing: enable/disable based on start/end time
        // Since we wrap in single quotes '...', strictly speaking we don't need to escape commas 
        // IF the ffmpeg parser respects the quotes for the option value.
        // Let's try standard comma: between(t,start,end)
        const enable = `between(t,${caption.startTime},${caption.endTime})`;
        options.push(`enable='${enable}'`);

        // Font and size
        // Update font path to be FFmpeg safe (forward slashes, escape drive colon)
        options.push(`fontfile='C\\:/Windows/Fonts/arial.ttf'`);
        options.push(`fontsize=${this.CAPTION_FONTSIZE}`);

        // Color
        options.push(`fontcolor=${this.CAPTION_COLOR}`);
        options.push(`shadowcolor=${this.CAPTION_SHADOWCOLOR}`);
        options.push(`shadowx=${this.CAPTION_SHADOWX}`);
        options.push(`shadowy=${this.CAPTION_SHADOWY}`);

        // Position (centered, above safe area)
        const x = `(w-text_w)/2`;
        const y = `h-text_h-${this.CAPTION_MARGIN}`;
        options.push(`x='${x}'`);
        options.push(`y='${y}'`);

        // Apply emphasis if needed (larger font for emphasized captions)
        if (caption.emphasis_indices && caption.emphasis_indices.length > 0) {
            // Overwrite defaults if emphasis is active
            const emphasisSize = Math.floor(this.CAPTION_FONTSIZE * this.EMPHASIS_FONTSIZE_MULT);
            options.find(opt => opt.startsWith('fontcolor='))
                ? options[options.findIndex(opt => opt.startsWith('fontcolor='))] = `fontcolor=${this.EMPHASIS_COLOR}`
                : options.push(`fontcolor=${this.EMPHASIS_COLOR}`);

            options.find(opt => opt.startsWith('fontsize='))
                ? options[options.findIndex(opt => opt.startsWith('fontsize='))] = `fontsize=${emphasisSize}`
                : options.push(`fontsize=${emphasisSize}`);
        }

        return options.join(':');
    }

    /**
     * Escape special characters in drawtext text parameter
     */
    _escapeDrawTextString(text) {
        if (!text) return '';
        return text
            .replace(/\\/g, '\\\\\\\\') // Double backslashes
            .replace(/'/g, "'\\\\\\''") // Single quotes
            .replace(/:/g, '\\\\:')    // Colons
            .replace(/%/g, '%%');       // Percents (crucial for Windows)
    }

    /**
     * Construct the complete FFmpeg command
     */
    _buildFFmpegCommand(job, results, filterScriptPath) {
        const audioPath = path.resolve(results.audio.audio_path);
        const outputPath = path.resolve(job.outputPath);

        // Inputs:
        // 0..N-1: Visual assets
        // N: Placeholder (if needed) - we'll skip the placeholder if we have visual assets
        // Final: Audio
        const args = ['-y'];

        // Add visual assets
        const assets = results.visuals.timeline;
        const uniqueAssetPaths = [...new Set(assets.map(a => path.resolve(a.file_path)))];
        uniqueAssetPaths.forEach(p => {
            args.push('-i', p.replace(/\\/g, '/'));
        });

        // Add audio input
        args.push('-i', audioPath.replace(/\\/g, '/'));

        // Global options
        args.push('-filter_complex_script', filterScriptPath.replace(/\\/g, '/'));
        args.push('-map', '[final_video]');
        args.push('-map', `${uniqueAssetPaths.length}:a`);

        // Video encoding
        args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18');
        args.push('-pix_fmt', 'yuv420p');

        // Audio encoding
        args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100');

        // Output options
        args.push('-s', `${this.TARGET_WIDTH}x${this.TARGET_HEIGHT}`);
        args.push('-r', `${this.TARGET_FPS}`);
        args.push('-movflags', '+faststart');

        // Explicitly specify MP4 format to prevent FFmpeg from defaulting to FFM
        args.push('-f', 'mp4');
        args.push(outputPath.replace(/\\/g, '/'));

        return args;
    }

    /**
     * Spawns FFmpeg process and handles output
     */
    async _executeFFmpeg(args, jobId) {
        return new Promise((resolve, reject) => {
            console.log(`[FFmpeg] Executing: ffmpeg ${args.join(' ')}`);

            const ffmpeg = spawn('ffmpeg', args);
            let stderr = '';

            ffmpeg.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true, stderr });
                } else {
                    resolve({ success: false, error: `Exit code ${code}`, stderr });
                }
            });

            ffmpeg.on('error', (err) => {
                resolve({ success: false, error: err.message, stderr });
            });
        });
    }

    /**
     * Validate output video file
     */
    _validateOutput(filePath) {
        if (!fs.existsSync(filePath)) {
            return { valid: false, reason: 'Output file not created' };
        }

        const stats = fs.statSync(filePath);
        if (stats.size < 10000) { // Less than 10KB
            return { valid: false, reason: 'Output file too small (likely failed encode)' };
        }

        return { valid: true };
    }

    /**
     * Classify error type for diagnostics
     */
    async concatSegments(segmentPaths, outputPath) {
        console.log(`[Rendering] Concatenating ${segmentPaths.length} segments...`);
        const listPath = outputPath.replace('.mp4', '_list.txt');
        const content = segmentPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listPath, content);

        const args = [
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', listPath.replace(/\\/g, '/'),
            '-c', 'copy',
            outputPath.replace(/\\/g, '/')
        ];

        try {
            const result = await this._executeFFmpeg(args, 'concat');
            if (result.success) {
                console.log(`[Rendering] Concatenation successful: ${outputPath}`);
                return outputPath;
            } else {
                throw new Error(`Concatenation failed: ${result.error}`);
            }
        } finally {
            if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
        }
    }

    _classifyError(message) {
        const lowerMsg = message.toLowerCase();

        if (lowerMsg.includes('audio') || lowerMsg.includes('not found')) {
            return 'ASSET_MISSING';
        }
        if (lowerMsg.includes('sync') || lowerMsg.includes('timing')) {
            return 'TIMING_MISMATCH';
        }
        if (lowerMsg.includes('codec') || lowerMsg.includes('encode')) {
            return 'CODEC_FAILURE';
        }
        if (lowerMsg.includes('memory') || lowerMsg.includes('resource')) {
            return 'RESOURCE_EXHAUSTION';
        }

        return 'UNKNOWN_ERROR';
    }

    /**
     * Resolve asset path (handles relative/absolute paths)
     */
    _resolveAssetPath(assetPath) {
        if (assetPath.startsWith('/assets/')) {
            return path.join(__dirname, '../../assets', assetPath.substring(8));
        }

        if (path.isAbsolute(assetPath)) {
            return assetPath;
        }

        return path.join(__dirname, '../../assets', assetPath);
    }
}

module.exports = new RenderingService();
