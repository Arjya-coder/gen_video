/**
 * Audio Validation Gate for Phase 3.
 * Rejects audio/timing if it violates pacing or duration constraints.
 */
class AudioValidator {
    validate(audioResult, { target_duration }) {
        const errors = [];
        const { duration_ms, timestamps } = audioResult;

        // 1. Total Duration Limit (Target + 10%)
        const targetMs = target_duration * 1000;
        if (duration_ms > targetMs * 1.1) {
            errors.push(`Audio duration too long: ${duration_ms}ms (Max ${targetMs * 1.1}ms)`);
        }

        // 2. Timestamps Integrity
        if (!timestamps || timestamps.length === 0) {
            errors.push("Missing timestamp metadata.");
        } else {
            for (let i = 1; i < timestamps.length; i++) {
                if (timestamps[i].start_ms < timestamps[i - 1].end_ms) {
                    errors.push(`Invalid timestamp order at word index ${i}.`);
                    break;
                }
            }
        }

        // 3. Silence Check (Single gap > 600ms)
        // Note: We check gaps between words.
        for (let i = 1; i < timestamps.length; i++) {
            const gap = timestamps[i].start_ms - timestamps[i - 1].end_ms;
            if (gap > 600) {
                errors.push(`Massive silence gap detected: ${gap}ms (Max 600ms)`);
                break;
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = new AudioValidator();
