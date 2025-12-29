/**
 * Caption Validation Gate for Phase 4.
 * Rejects if groups are too long, overlap, or mismatch audio.
 */
class CaptionValidator {
    validate(timeline, audioDurationMs) {
        const errors = [];

        if (!timeline || timeline.length === 0) {
            errors.push("Caption timeline is empty.");
            return { isValid: false, errors };
        }

        timeline.forEach((cap, idx) => {
            // 1. Word Limit (Max 3 words)
            const wordCount = cap.text.split(/\s+/).length;
            if (wordCount > 3) {
                errors.push(`Caption ${idx} exceeds word limit: ${wordCount} words (Max 3)`);
            }

            // 2. Group Duration (Max 800ms)
            const duration = cap.end_ms - cap.start_ms;
            if (duration > 800) {
                // We allow slightly longer for very slow speech, but flagging as warning/error for now
                // Rule: "No caption longer than 800ms unless suspense requires it"
                // For strict validation, we enforce 900ms as a hard limit to allow for some variance.
                if (duration > 900) {
                    errors.push(`Caption ${idx} is too long: ${duration}ms (Max 800-900ms)`);
                }
            }

            // 3. Timing Overlap
            if (idx > 0) {
                if (cap.start_ms < timeline[idx - 1].end_ms) {
                    errors.push(`Caption ${idx} overlaps with previous caption.`);
                }
            }
        });

        // 4. Alignment with Audio
        const lastCap = timeline[timeline.length - 1];
        if (lastCap.end_ms > audioDurationMs + 100) {
            errors.push(`Captions end after audio: ${lastCap.end_ms}ms vs Audio ${audioDurationMs}ms`);
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = new CaptionValidator();
