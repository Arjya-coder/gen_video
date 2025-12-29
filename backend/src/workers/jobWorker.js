const queue = require('../queue/inMemoryQueue');
const llmService = require('../services/llmService');
const validationService = require('../services/validationService');
const audioService = require('../services/audioService');
const audioValidator = require('../services/audioValidator');
const captionService = require('../services/captionService');
const captionValidator = require('../services/captionValidator');
const visualService = require('../services/visualService');
const visualValidator = require('../services/visualValidator');
const editingService = require('../services/editingService');
const renderingService = require('../services/renderingService');
const assetStreamingManager = require('../services/assetStreamingManager');
const fs = require('fs');
const path = require('path');

class JobWorker {
    constructor() {
        this.activeJobs = 0;
        this.MAX_CONCURRENT_JOBS = 3;
    }

    start() {
        console.log('[Worker] Worker started.');
        setInterval(() => this.processNext(), 2000);
    }

    async processNext() {
        if (this.activeJobs >= this.MAX_CONCURRENT_JOBS) return;

        const job = queue.getNextJob();
        if (!job) return;

        this.activeJobs++;

        // Check if job is EDIT_READY (Phase 7 render)
        if (job.status === 'EDIT_READY') {
            console.log(`[Worker] Started Phase 7 Render for job ${job.id}: "${job.topic}"`);
            await this._renderPhase7(job);
            this.activeJobs--;
            return;
        }

        console.log(`[Worker] Started Phase 5 Flow for job ${job.id}: "${job.topic}"`);
        const totalPhases = 7;
        const phaseEstTime = 10; // 10s per phase average

        queue.updateJobStatus(job.id, 'PROCESSING', null, 5, totalPhases * phaseEstTime);

        try {
            // --- NEW PHASE: Scene-Based Modular Flow ---
            queue.updateJobStatus(job.id, 'PROCESSING', null, 10, 60);

            // 1. Script Generation (Improved with integrated keywords)
            let script = job.result?.script;
            const qualityControlService = require('../services/qualityControlService');

            if (!script) {
                let attempts = 0;
                let scriptValid = false;
                while (attempts < 3 && !scriptValid) {
                    attempts++;
                    script = await llmService.generateScript({
                        topic: job.topic,
                        duration_seconds: job.duration_seconds || 30,
                        tone: job.tone || 'neutral'
                    });

                    const qcResult = qualityControlService.validateScript(script);
                    if (qcResult.isValid) {
                        scriptValid = true;
                    } else {
                        console.warn(`[QCS] Script attempt ${attempts} rejected: ${qcResult.errors.join('; ')}`);
                        if (attempts === 3) throw new Error(`QCS Rejected Script: ${qcResult.errors[0]}`);
                    }
                }

                // --- Brainstorming / Dry-Run Support ---
                if (job.dry_run) {
                    console.log(`[Worker] Brainstorming complete for job ${job.id}`);
                    queue.updateJobStatus(job.id, 'COMPLETED', { script }, 100, 0);
                    this.activeJobs--;
                    return;
                }
            }

            const scenes = script.scenes;
            const segmentPaths = [];
            const sceneService = require('../services/sceneService');

            const sceneMetadata = { audio: { timestamps: [] }, visuals: { timeline: [] }, edit: { plan: [] } };

            // 2. Process all scenes in parallel
            console.log(`[Worker] Mapping ${scenes.length} scenes for parallel processing.`);
            const scenePromises = scenes.map((scene, i) => {
                return sceneService.processScene({
                    text: scene.text,
                    keywords: scene.keywords,
                    sceneIdx: i + 1,
                    jobId: job.id,
                    onMetadata: (m) => {
                        // Aggregate metadata for final audit (synchronous aggregation is fine here)
                        if (m.audio?.timestamps) sceneMetadata.audio.timestamps.push(...m.audio.timestamps);
                        if (m.visuals?.timeline) sceneMetadata.visuals.timeline.push(...m.visuals.timeline);
                        if (m.edit?.plan) sceneMetadata.edit.plan.push(...m.edit.plan);
                    }
                });
            });

            const segmentPathsResults = await Promise.all(scenePromises);
            segmentPaths.push(...segmentPathsResults);

            // 3. Final Assembly
            queue.updateJobStatus(job.id, 'MERGING', 'Assembling final video...', 90, 5);
            const finalVideoPath = path.join(__dirname, `../../temp_output/final_${job.id}.mp4`);
            await renderingService.concatSegments(segmentPaths, finalVideoPath);

            // --- STEP 9: FINAL QUALITY AUDIT ---
            queue.updateJobStatus(job.id, 'AUDITING', 'Final Attention Audit...', 98, 2);
            const auditResult = qualityControlService.auditFinalVideo({
                script,
                audio: sceneMetadata.audio,
                visuals: sceneMetadata.visuals,
                edit: sceneMetadata.edit.plan
            });

            if (auditResult.decision === 'NO-GO') {
                console.error(`[Auditor] NO-GO: ${auditResult.reason}`);
                throw new Error(`Quality Audit Failed: ${auditResult.reason}`);
            }

            console.log(`[Worker] FINAL AUDITOR: GO!`);

            // 4. Cleanup and Success
            queue.updateJobStatus(job.id, 'COMPLETED', {
                video_path: `/cache/output_${job.id}.mp4`,
                full_path: finalVideoPath,
                duration_ms: sceneMetadata.audio.timestamps.length * 300 // Approx from timestamps
            }, 100, 0);

            // Move final video to cache for streaming
            const assetStreamingManager = require('../services/assetStreamingManager');
            assetStreamingManager.cacheRender(job.id, finalVideoPath);

        } catch (error) {
            console.error(`[Worker] Critical error processing job ${job.id}:`, error);
            queue.updateJobStatus(job.id, 'FAILED', { error: error.message });
        } finally {
            this.activeJobs--;
        }
    }

    /**
     * PHASE 7: Render the final video
     * Input: EDIT_READY job with all assets prepared
     * Output: Final MP4 file, job status COMPLETED or FAILED
     */
    async _renderPhase7(job) {
        try {
            console.log(`[Worker] Phase 7 starting render for job ${job.id}...`);

            // Validate required data
            if (!job.result || !job.result.audio || !job.result.captions || !job.result.visuals || !job.result.edit) {
                throw new Error('Job missing required result data (audio, captions, visuals, or edit plan)');
            }

            // Check for dry-run mode
            const isDryRun = job.dry_run === true || job.render_mode === 'dry-run';
            const isPreview = job.render_mode === 'preview';

            console.log(`[Worker] Render mode: ${isDryRun ? 'dry-run' : isPreview ? 'preview' : 'full'}`);

            // Manage temp storage before render
            assetStreamingManager.manageTempStorage();

            // Execute render
            const renderResult = await renderingService.render(job, {
                dryRun: isDryRun,
                preview: isPreview,
                debug: job.debug === true
            });

            if (!renderResult.success) {
                // Render failed
                const errorDetails = {
                    error: renderResult.error,
                    errorType: renderResult.diagnostics?.errorType || 'UNKNOWN_ERROR',
                    diagnostics: renderResult.diagnostics
                };

                console.error(`[Worker] Phase 7 render failed: ${renderResult.error}`);
                queue.updateJobStatus(job.id, 'FAILED', errorDetails);
                return;
            }

            if (isDryRun) {
                // For dry-run, mark as COMPLETED but don't persist video
                console.log(`[Worker] Dry-run completed for job ${job.id}`);
                queue.updateJobStatus(job.id, 'COMPLETED', {
                    dryRun: true,
                    command: renderResult.command,
                    filterGraph: renderResult.diagnostics?.filterGraph
                }, 100, 0);
                return;
            }

            // Success: video rendered
            const videoPath = renderResult.videoPath;

            // Cache the render for potential reuse
            const cachedPath = assetStreamingManager.cacheRender(job.id, videoPath);

            console.log(`[Worker] Phase 7 completed successfully for job ${job.id}`);
            console.log(`[Worker] Output video: ${cachedPath}`);

            // Update job to COMPLETED with final video path
            const relativeVideoPath = `/cache/output_${job.id}.mp4`;
            queue.updateJobStatus(job.id, 'COMPLETED', {
                video_path: relativeVideoPath,
                full_path: cachedPath,
                file_size: fs.statSync(cachedPath).size,
                duration_ms: job.result.audio.duration_ms,
                diagnostics: renderResult.diagnostics
            }, 100, 0);

            // Clean up temp render workspace
            assetStreamingManager.cleanupRenderWorkspace(job.id);

        } catch (error) {
            console.error(`[Worker] Phase 7 critical error for job ${job.id}:`, error);
            queue.updateJobStatus(job.id, 'FAILED', {
                error: error.message,
                errorType: 'RENDERING_ERROR',
                timestamp: new Date().toISOString()
            });
        }
    }
}

module.exports = new JobWorker();
