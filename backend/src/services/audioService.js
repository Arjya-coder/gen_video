const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

/**
 * Audio Service for Phase 3.
 * Handles deterministic timing metadata, emphasis, and pacing.
 */
const { execSync } = require('child_process');

class AudioService {
    async _synthesizeElevenLabs(text, outPath) {
        if (!this.elevenLabsKey) throw new Error("ElevenLabs key missing");

        const response = await axios({
            method: 'post',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
            data: {
                text: text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: { stability: 0.5, similarity_boost: 0.5 }
            },
            headers: {
                'xi-api-key': this.elevenLabsKey,
                'Content-Type': 'application/json',
                'accept': 'audio/mpeg'
            },
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(outPath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }

    constructor() {
        this.audioDir = path.join(__dirname, '../../assets/audio');
        this.ttsScript = path.join(__dirname, 'tts.ps1');
        this.elevenLabsKey = process.env.ELEVENLABS_API_KEY;
        this.voiceId = 'pNInz6obpgueM0WZtG5L'; // Default "Adam" voice

        console.log(`[Audio] ElevenLabs Key present: ${!!this.elevenLabsKey}`);

        if (!fs.existsSync(this.audioDir)) {
            fs.mkdirSync(this.audioDir, { recursive: true });
        }
    }

    /**
     * Generates word-level timestamps and simulates/synthesizes audio.
     * @param {Object} script - { hook, body: [], ending }
     * @param {Boolean} dryRun - If true, skip actual synthesis.
     */
    async generateVoiceover(scriptData, dryRun = true) {
        console.log(`[Audio] Generating voiceover (Dry-run: ${dryRun})...`);

        let allText;
        if (typeof scriptData === 'string') {
            allText = [scriptData];
        } else {
            allText = [scriptData.hook, ...(scriptData.body || []), scriptData.ending].filter(Boolean);
        }
        const fullScript = allText.join(' ');

        // Pacing Model: duration_multiplier
        // 0.8 = 20% faster (shorter word duration)
        // 1.0 = normal speed
        // 1.2 = 20% slower (longer word duration)
        // This model makes timing explicit: duration = base_duration * duration_multiplier.

        let currentTimeMs = 0;
        const timestamps = [];

        allText.forEach((section, sectionIdx) => {
            const words = section.split(/\s+/);
            const isHook = sectionIdx === 0;
            const isEnding = sectionIdx === allText.length - 1;

            // Apply duration_multiplier based on section
            let duration_multiplier = 1.0;
            if (isHook) duration_multiplier = 0.8;
            if (isEnding) duration_multiplier = 1.2;

            let sectionDurationMs = 0;

            words.forEach((word) => {
                // Deterministic Emphasis (Numbers/Verbs/Contrast)
                const isEmphasis = this._checkEmphasis(word);

                // Base duration per word: 300ms
                let wordDuration = 300 * duration_multiplier;
                if (isEmphasis) wordDuration *= 1.15; // Slight stretch for emphasis

                const cleanWord = word.replace(/[^\w]/g, '');

                timestamps.push({
                    word: cleanWord,
                    start_ms: Math.round(currentTimeMs),
                    end_ms: Math.round(currentTimeMs + wordDuration),
                    emphasis: isEmphasis
                });

                currentTimeMs += wordDuration;
                sectionDurationMs += wordDuration;
            });

            // Issue 2: Proportional Micro-pauses
            // pause = clamp(section_duration * 0.15, 150, 450)
            if (sectionIdx < allText.length - 1) {
                const pause = Math.min(Math.max(sectionDurationMs * 0.15, 150), 450);
                currentTimeMs += pause;
            }
        });

        const totalDurationMs = currentTimeMs;
        const fileName = `job_${Date.now()}_voice.wav`;
        const audioPath = path.join(this.audioDir, fileName);

        if (!dryRun) {
            try {
                // Try ElevenLabs First (Premium)
                if (this.elevenLabsKey) {
                    console.log(`[Audio] Synthesizing premium voice using ElevenLabs...`);
                    // Use .mp3 for ElevenLabs, FFmpeg handles it fine
                    const premiumPath = audioPath.replace('.wav', '.mp3');
                    await this._synthesizeElevenLabs(fullScript, premiumPath);
                    console.log(`[Audio] Success: Premium voice saved to ${premiumPath}`);
                    return { ...this._buildResult(premiumPath, timestamps, totalDurationMs) };
                }
                throw new Error("No premium key");
            } catch (err) {
                console.error('[Audio] Premium TTS skipped/failed:', err.response ? JSON.stringify(err.response.data) : err.message);
                try {
                    // Fallback to Native Windows (No Cost)
                    console.log(`[Audio] Using Native Windows SAPI fallback...`);
                    const cmd = `PowerShell -File "${this.ttsScript}" -text "${fullScript.replace(/"/g, '\"')}" -outPath "${audioPath}"`;
                    execSync(cmd);
                    return { ...this._buildResult(audioPath, timestamps, totalDurationMs) };
                } catch (fallbackErr) {
                    console.error('[Audio] Native fallback failed:', fallbackErr.message);
                    this._writeSilentWav(audioPath, Math.round(totalDurationMs));
                }
            }
        } else {
            this._writeSilentWav(audioPath, Math.round(totalDurationMs));
        }

        return { ...this._buildResult(audioPath, timestamps, totalDurationMs) };
    }

    _buildResult(audioPath, timestamps, durationMs) {
        return {
            audio_path: audioPath,
            timestamps,
            duration_ms: Math.round(durationMs),
            metadata: {
                word_count: timestamps.length,
                pacing: { hook_multiplier: 0.8, body_multiplier: 1.0, ending_multiplier: 1.2 }
            }
        };
    }

    _writeSilentWav(filePath, durationMs, sampleRate = 16000) {
        const numChannels = 1;
        const bytesPerSample = 2; // 16-bit
        const numSamples = Math.max(1, Math.floor((durationMs / 1000) * sampleRate));

        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const subchunk2Size = numSamples * blockAlign;
        const chunkSize = 36 + subchunk2Size;

        const buffer = Buffer.alloc(44 + subchunk2Size);

        // RIFF header
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(chunkSize, 4);
        buffer.write('WAVE', 8);

        // fmt subchunk
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16); // Subchunk1Size
        buffer.writeUInt16LE(1, 20); // AudioFormat PCM
        buffer.writeUInt16LE(numChannels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(byteRate, 28);
        buffer.writeUInt16LE(blockAlign, 32);
        buffer.writeUInt16LE(bytesPerSample * 8, 34);

        // data subchunk
        buffer.write('data', 36);
        buffer.writeUInt32LE(subchunk2Size, 40);

        // Silence (zeros) already present in alloc buffer

        fs.writeFileSync(filePath, buffer);
    }

    _checkEmphasis(word) {
        const clean = word.toLowerCase().replace(/[^\w]/g, '');
        // Numbers
        if (/\d+/.test(clean)) return true;

        // Emphasis triggers
        const catalysts = [
            'but', 'however', 'instead', 'secret', 'hidden', 'mastery',
            'always', 'never', 'must', 'only', 'stop', 'start', 'limit'
        ];

        return catalysts.includes(clean);
    }
}

module.exports = new AudioService();
