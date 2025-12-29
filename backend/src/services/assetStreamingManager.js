/**
 * PHASE 7: Asset Streaming and Performance Optimization
 * 
 * Handles:
 * - Streaming audio/video input (no full memory load)
 * - Temp file management and cleanup
 * - Asset caching for repeated renders
 * - Bitrate optimization to avoid re-encoding
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class AssetStreamingManager {
    constructor() {
        this.TEMP_DIR = path.join(__dirname, '../../temp_render');
        this.MAX_TEMP_SIZE_MB = 2000; // 2GB max temp storage
        this.CACHE_DIR = path.join(__dirname, '../../cache_render');
        
        if (!fs.existsSync(this.TEMP_DIR)) {
            fs.mkdirSync(this.TEMP_DIR, { recursive: true });
        }
        if (!fs.existsSync(this.CACHE_DIR)) {
            fs.mkdirSync(this.CACHE_DIR, { recursive: true });
        }
    }

    /**
     * Get video clip metadata without loading entire file into memory
     * Uses FFprobe to extract timing, codec, resolution
     */
    getClipMetadata(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }
            
            // Use ffprobe to get metadata (stream only, no decode)
            const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,duration -of default=noprint_wrappers=1:nokey=1:noescaping=1 "${filePath}"`;
            const output = execSync(cmd, { encoding: 'utf-8' });
            
            const lines = output.trim().split('\n');
            return {
                width: parseInt(lines[0]) || 1920,
                height: parseInt(lines[1]) || 1080,
                fps: lines[2] || '30/1',
                duration: parseFloat(lines[3]) || 0
            };
        } catch (error) {
            console.warn(`[AssetStreaming] Failed to get metadata for ${filePath}: ${error.message}`);
            return null;
        }
    }

    /**
     * Check if re-encoding is needed
     * Returns true if source codec is compatible (H.264, AAC)
     */
    canAvoidReencoding(clipPath, audioPath) {
        try {
            const videoCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${clipPath}"`;
            const audioCmd = `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
            
            const videoCodec = execSync(videoCmd, { encoding: 'utf-8' }).trim();
            const audioCodec = execSync(audioCmd, { encoding: 'utf-8' }).trim();
            
            // Can use -c:v copy -c:a copy if already H.264 and AAC
            return videoCodec === 'h264' && audioCodec === 'aac';
        } catch (error) {
            return false; // Default to re-encoding for safety
        }
    }

    /**
     * Stream large audio file in chunks
     * Returns file path for FFmpeg input (no actual streaming needed for local files,
     * but could be extended for remote sources)
     */
    streamAudio(audioPath) {
        // For local files, FFmpeg handles streaming internally
        // In production, this could handle S3/HTTP streaming
        if (fs.existsSync(audioPath)) {
            return audioPath;
        }
        throw new Error(`Audio file not found: ${audioPath}`);
    }

    /**
     * Create temporary render workspace
     * Returns path for this render's temp files
     */
    createRenderWorkspace(jobId) {
        const workspacePath = path.join(this.TEMP_DIR, `render_${jobId}`);
        if (!fs.existsSync(workspacePath)) {
            fs.mkdirSync(workspacePath, { recursive: true });
        }
        return workspacePath;
    }

    /**
     * Clean up temporary render files after completion
     */
    cleanupRenderWorkspace(jobId) {
        const workspacePath = path.join(this.TEMP_DIR, `render_${jobId}`);
        try {
            if (fs.existsSync(workspacePath)) {
                this._removeDirectoryRecursive(workspacePath);
                console.log(`[AssetStreaming] Cleaned up temp workspace: ${workspacePath}`);
            }
        } catch (error) {
            console.warn(`[AssetStreaming] Failed to clean up ${workspacePath}: ${error.message}`);
        }
    }

    /**
     * Check total temp usage and clean old renders if needed
     */
    manageTempStorage() {
        try {
            const files = fs.readdirSync(this.TEMP_DIR);
            let totalSize = 0;
            const renderFolders = [];
            
            files.forEach(file => {
                const filePath = path.join(this.TEMP_DIR, file);
                const stats = fs.statSync(filePath);
                totalSize += stats.size;
                
                if (file.startsWith('render_')) {
                    renderFolders.push({
                        path: filePath,
                        time: stats.mtime,
                        size: stats.size
                    });
                }
            });
            
            const totalSizeMB = totalSize / (1024 * 1024);
            
            if (totalSizeMB > this.MAX_TEMP_SIZE_MB) {
                console.log(`[AssetStreaming] Temp storage (${totalSizeMB.toFixed(1)}MB) exceeds limit. Cleaning old renders...`);
                
                // Sort by modification time and delete oldest
                renderFolders.sort((a, b) => a.time - b.time);
                
                for (const folder of renderFolders) {
                    this._removeDirectoryRecursive(folder.path);
                    totalSizeMB -= folder.size / (1024 * 1024);
                    
                    if (totalSizeMB < this.MAX_TEMP_SIZE_MB * 0.8) {
                        break;
                    }
                }
            }
        } catch (error) {
            console.warn(`[AssetStreaming] Error managing temp storage: ${error.message}`);
        }
    }

    /**
     * Cache frequently-used clips or renders
     */
    getCachedRender(jobId) {
        const cachePath = path.join(this.CACHE_DIR, `output_${jobId}.mp4`);
        if (fs.existsSync(cachePath)) {
            return cachePath;
        }
        return null;
    }

    /**
     * Store render in cache
     */
    cacheRender(jobId, sourcePath) {
        try {
            const cachePath = path.join(this.CACHE_DIR, `output_${jobId}.mp4`);
            fs.copyFileSync(sourcePath, cachePath);
            console.log(`[AssetStreaming] Cached render: ${cachePath}`);
            return cachePath;
        } catch (error) {
            console.warn(`[AssetStreaming] Failed to cache render: ${error.message}`);
            return sourcePath;
        }
    }

    /**
     * Recursive directory removal
     */
    _removeDirectoryRecursive(dirPath) {
        if (!fs.existsSync(dirPath)) return;
        
        fs.readdirSync(dirPath).forEach(file => {
            const filePath = path.join(dirPath, file);
            if (fs.lstatSync(filePath).isDirectory()) {
                this._removeDirectoryRecursive(filePath);
            } else {
                fs.unlinkSync(filePath);
            }
        });
        fs.rmdirSync(dirPath);
    }

    /**
     * Get optimal bitrate based on duration and platform
     */
    getOptimalBitrate(durationSeconds) {
        // Adaptive bitrate for vertical shorts
        if (durationSeconds <= 15) return '3000k'; // Shorter clips can use lower bitrate
        if (durationSeconds <= 30) return '5000k'; // Standard short-form
        return '6000k'; // Longer content
    }

    /**
     * Estimate render time based on file sizes and target resolution
     */
    estimateRenderTime(audioSize, clipCount, previewMode = false) {
        // Very rough estimate: FFmpeg typically encodes at 2-10x realtime depending on preset
        const estimatedDuration = audioSize / 128000; // seconds (assuming 128kbps audio)
        const encodeMultiplier = previewMode ? 0.5 : 3;
        const secondsPerFrame = 1 / 30;
        
        return Math.ceil(estimatedDuration * encodeMultiplier);
    }
}

module.exports = new AssetStreamingManager();
