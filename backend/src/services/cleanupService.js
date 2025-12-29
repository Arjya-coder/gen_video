const fs = require('fs');
const path = require('path');

/**
 * Cleanup Service
 * Automatically deletes assets older than 7 days unless marked as 'kept'.
 */
class CleanupService {
    constructor() {
        this.RETENTION_DAYS = 7;
        this.MARK_FILE = path.join(__dirname, '../../marked_assets.json');
        this.DIRECTORIES = [
            path.join(__dirname, '../../assets/audio'),
            path.join(__dirname, '../../assets/clips'),
            path.join(__dirname, '../../temp_output'),
            path.join(__dirname, '../../cache_render')
        ];

        // Ensure directories exist
        this.DIRECTORIES.forEach(dir => {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        });

        // Load marked assets
        this.markedJobs = this._loadMarks();
    }

    /**
     * Start the automated cleanup process.
     */
    init() {
        console.log('[Cleanup] Initializing Auto-Cleanup Service.');
        this.runCleanup();

        // Run every 24 hours
        setInterval(() => this.runCleanup(), 24 * 60 * 60 * 1000);
    }

    /**
     * Scan directories and delete old files.
     */
    runCleanup() {
        console.log('[Cleanup] Starting routine scan...');
        const now = Date.now();
        const maxAgeMs = this.RETENTION_DAYS * 24 * 60 * 60 * 1000;

        let deletedCount = 0;

        this.DIRECTORIES.forEach(dir => {
            if (!fs.existsSync(dir)) return;

            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filePath = path.join(dir, file);
                const stats = fs.statSync(filePath);

                // Skip directories
                if (stats.isDirectory()) return;

                const ageMs = now - stats.mtimeMs;
                if (ageMs > maxAgeMs) {
                    // Check if this file is related to a marked job
                    if (this._isMarked(file)) {
                        console.log(`[Cleanup] Skipping marked file: ${file}`);
                        return;
                    }

                    try {
                        fs.unlinkSync(filePath);
                        deletedCount++;
                        console.log(`[Cleanup] Deleted old asset: ${file}`);
                    } catch (err) {
                        console.error(`[Cleanup] Error deleting ${file}:`, err.message);
                    }
                }
            });
        });

        console.log(`[Cleanup] Routine complete. Deleted ${deletedCount} files.`);
    }

    /**
     * Mark a job ID as 'kept'.
     */
    markJob(jobId) {
        if (!this.markedJobs.includes(jobId)) {
            this.markedJobs.push(jobId);
            this._saveMarks();
            console.log(`[Cleanup] Marked Job ${jobId} as KEPT.`);
            return true;
        }
        return false;
    }

    /**
     * Unmark a job ID.
     */
    unmarkJob(jobId) {
        const index = this.markedJobs.indexOf(jobId);
        if (index > -1) {
            this.markedJobs.splice(index, 1);
            this._saveMarks();
            console.log(`[Cleanup] Unmarked Job ${jobId}.`);
            return true;
        }
        return false;
    }

    /**
     * Check if a job is marked.
     */
    isJobMarked(jobId) {
        return this.markedJobs.includes(jobId);
    }

    /**
     * Internal check if a file belongs to a marked job.
     */
    _isMarked(filename) {
        // Filenames usually contain the Job ID (e.g., job_ID_voice.wav, output_ID.mp4)
        return this.markedJobs.some(jobId => filename.includes(jobId));
    }

    _loadMarks() {
        try {
            if (fs.existsSync(this.MARK_FILE)) {
                const data = fs.readFileSync(this.MARK_FILE, 'utf-8');
                return JSON.parse(data);
            }
        } catch (err) {
            console.error('[Cleanup] Error loading marked_assets.json:', err.message);
        }
        return [];
    }

    _saveMarks() {
        try {
            fs.writeFileSync(this.MARK_FILE, JSON.stringify(this.markedJobs, null, 2));
        } catch (err) {
            console.error('[Cleanup] Error saving marked_assets.json:', err.message);
        }
    }
}

module.exports = new CleanupService();
