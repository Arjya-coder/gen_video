/**
 * Visual Validator (Phase 5 Strict)
 * Enforces Phase 5 constraints:
 * - Clip Duration 0.8s - 3.0s (inclusive)
 * - No overlaps
 * - No gaps > 100ms tolerance
 * - No clip reuse
 * - Visual variety (frequency)
 */
class VisualValidator {
    validate(timeline, totalDurationMs) {
        const errors = [];

        if (!timeline || !Array.isArray(timeline) || timeline.length === 0) {
            return { isValid: false, errors: ["Visual timeline is empty or invalid."] };
        }

        const usedIds = new Set();
        let expectedStart = 0;

        timeline.forEach((clip, idx) => {
            // 1. Structure Check
            if (!clip.clip_id || !clip.file_path || typeof clip.start_ms !== 'number') {
                errors.push(`Clip ${idx} malformed structure.`);
                return;
            }

            const duration = clip.end_ms - clip.start_ms;

            // 2. Duration Limits
            // Rules: Min 0.8s == 800ms, Max 3.0s == 3000ms
            if (duration < 800) {
                errors.push(`Clip ${idx} duration ${duration}ms too short (Min 800ms)`);
            }
            if (duration > 3000) {
                // Allow +1ms tolerance for rounding
                if (duration > 3001) errors.push(`Clip ${idx} duration ${duration}ms too long (Max 3000ms)`);
            }

            // 3. Gap / Overlap Check
            if (Math.abs(clip.start_ms - expectedStart) > 20) { // 20ms tolerance for JS math
                errors.push(`Gap/Overlap at clip ${idx}: Expected ${expectedStart}ms, Got ${clip.start_ms}ms`);
            }

            // 4. Clip Reuse (STRICT)
            if (usedIds.has(clip.clip_id)) {
                errors.push(`Strict Rule Violation: Clip reuse detected for '${clip.clip_id}' at index ${idx}.`);
            }
            usedIds.add(clip.clip_id);

            expectedStart = clip.end_ms;
        });

        // 5. Total Duration Check
        if (Math.abs(expectedStart - totalDurationMs) > 200) { // 200ms tolerance for end
            errors.push(`Timeline end mismatch. Expected ${totalDurationMs}ms, Got ${expectedStart}ms`);
        }

        // 6. Visual Frequency check (Approximation)
        // If average clip length > 4s, something is wrong with pacing
        const avgDuration = expectedStart / timeline.length;
        if (avgDuration > 4000) {
            errors.push(`Pacing too slow. Average clip duration: ${Math.round(avgDuration)}ms`);
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = new VisualValidator();
