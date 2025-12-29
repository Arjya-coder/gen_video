const fs = require('fs');
const path = require('path');
const audioService = require('./audioService');
const visualService = require('./visualService');
const editingService = require('./editingService');
const captionService = require('./captionService');

/**
 * SceneService: Manages the lifecycle of individual video segments.
 */
class SceneService {
    constructor() {
        this.tempDir = path.join(__dirname, '../../temp_render/scenes');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Process a single scene (Sentence/Hook/Ending)
     * @param {Object} sceneData - { text, keywords, sceneIdx, jobId }
     * @returns {Promise<String>} - Path to the rendered segment .mp4
     */
    async processScene(sceneData) {
        const { text, keywords, sceneIdx, jobId, onMetadata } = sceneData;
        const qcs = require('./qualityControlService');
        console.log(`[SceneService] Processing Scene ${sceneIdx}: "${text.substring(0, 30)}..."`);

        // 1. Keyword QC
        const kwQC = qcs.validateKeywords(keywords);
        if (!kwQC.isValid) {
            console.warn(`[QCS] Scene ${sceneIdx} keywords rejected: ${kwQC.errors.join('; ')}`);
        }

        // 2. Generate Audio
        const audioResult = await audioService.generateVoiceover(text, false);
        const durationMs = audioResult.duration_ms;

        // 3. Pacing QC
        const pacingQC = qcs.validatePacing(audioResult);
        if (!pacingQC.isValid) {
            console.warn(`[QCS] Scene ${sceneIdx} pacing warning: ${pacingQC.errors.join('; ')}`);
        }

        // 4. Generate Visuals (with QCS Retry)
        let visualTimeline;
        let attempts = 0;
        let visualsValid = false;

        while (attempts < 2 && !visualsValid) {
            attempts++;
            visualTimeline = await visualService.generateTimeline(keywords, durationMs);
            const visualQC = qcs.validateVisuals(visualTimeline);

            if (visualQC.isValid) {
                visualsValid = true;
            } else {
                console.warn(`[QCS] Scene ${sceneIdx} visuals rejected (Attempt ${attempts}): ${visualQC.errors.join('; ')}`);
                if (attempts === 2) {
                    throw new Error(`[QCS] Final rejection: Scene ${sceneIdx} visuals failed QC after 2 attempts. ${visualQC.errors[0]}`);
                }
            }
        }

        // 6. Generate Captions
        const captionsTimeline = captionService.generateTimeline(audioResult.timestamps);
        const captions = { timeline: captionsTimeline };

        // 7. Generate local Edit Plan
        const editResult = editingService.generateEditPlan({
            audio: audioResult,
            captions: captions,
            visuals: { timeline: visualTimeline }
        });

        // 8. Editing QC
        const editQC = qcs.validateEditPlan(editResult.plan || []);
        if (!editQC.isValid) {
            throw new Error(`[QCS] Edit plan failed for Scene ${sceneIdx}: ${editQC.errors.join(', ')}`);
        }

        const renderingService = require('./renderingService');

        // 9. Render the segment
        const segmentPath = await renderingService.renderSegment({
            jobId,
            sceneIdx,
            audio: audioResult,
            captions,
            visuals: { timeline: visualTimeline },
            edit: editResult
        });

        // Export metadata for final audit if callback provided
        if (onMetadata) {
            onMetadata({
                audio: audioResult,
                visuals: { timeline: visualTimeline },
                edit: editResult
            });
        }

        return segmentPath;
    }

    async cleanup(jobId) {
        // Cleanup logic for segment files
    }
}

module.exports = new SceneService();
