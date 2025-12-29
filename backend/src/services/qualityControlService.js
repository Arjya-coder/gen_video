/**
 * Quality Control System (QCS)
 * Enforces strict retention-based rules for script, audio, visuals, and editing.
 */
class QualityControlService {
    constructor() {
        this.BANNED_HOOK_PHRASES = ["did you know", "in this video", "let's talk about", "you won't believe"];
        this.HOOK_PATTERNS = [
            /(most|many|some) (people|thinkers|experts) think .+, but .+/i, // Belief Reversal
            /nobody (tells|told|is telling) you this about .+/i, // Suppressed Truth
            /this sounds wrong, but .+/i, // Counterintuitive Claim
            /.+ (isn't|is not) the problem\. .+ is\./i // Brutal Honesty
        ];
    }

    /**
     * Step 2: Script Quality Gate
     */
    validateScript(script) {
        const errors = [];
        const hook = script.hook || (script.scenes && script.scenes[0]?.text);
        if (!hook) return { isValid: false, errors: ["No hook found"] };

        const hookLower = hook.toLowerCase();
        const hookWords = hook.split(/\s+/).length;

        // 1. Hook length (Step 1: ≤ 12 words)
        if (hookWords > 12) {
            errors.push(`Hook too long (${hookWords} words). Max 12.`);
        }

        // 2. Banned Phrases
        this.BANNED_HOOK_PHRASES.forEach(phrase => {
            if (hookLower.includes(phrase)) {
                errors.push(`Hook contains banned phrase: "${phrase}"`);
            }
        });

        // 3. Pattern Match (Step 2 structure)
        const matchesPattern = this.HOOK_PATTERNS.some(pattern => pattern.test(hook));
        if (!matchesPattern) {
            errors.push("Hook lacks required curiosity structure (Belief Reversal, etc.)");
        }

        // 4. Ending length (Step 1: ≤ 8 words)
        const ending = script.ending || (script.scenes && script.scenes[script.scenes.length - 1]?.text);
        if (ending) {
            const endingWords = ending.split(/\s+/).length;
            if (endingWords > 8) {
                errors.push(`Ending too long (${endingWords} words). Max 8.`);
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Step 3: Keyword Sanity Filter
     */
    validateKeywords(keywords) {
        const abstractWords = ["success", "mindset", "future", "discipline", "fast", "beautiful", "powerful", "amazing", "great", "best"];
        const rejected = keywords.filter(kw => abstractWords.includes(kw.toLowerCase()));

        if (rejected.length > 0) {
            return {
                isValid: false,
                errors: [`Abstract keywords rejected: ${rejected.join(', ')}`]
            };
        }

        // Enforce concrete intelligence: human behavior, objects, places
        return { isValid: true, errors: [] };
    }

    /**
     * Step 4: Pacing & Timing
     */
    validatePacing(audioMetadata) {
        const errors = [];
        const { duration_ms, timestamps, metadata } = audioMetadata;

        const hookTime = 4000;
        const hookWordsCount = timestamps.filter(t => t.start_ms < hookTime).length;
        const hookWPS = hookWordsCount / (hookTime / 1000);

        // Hook MUST be fast (Step 4)
        if (hookWPS < 2.8) {
            errors.push(`Hook pacing too slow (${hookWPS.toFixed(1)} WPS). Need > 2.8.`);
        }

        // Silence > 600ms (Step 4)
        for (let i = 0; i < timestamps.length - 1; i++) {
            const gap = timestamps[i + 1].start_ms - timestamps[i].end_ms;
            if (gap > 600) {
                errors.push(`Dead air detected: ${gap}ms gap.`);
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Step 6: Visual Asset Selection
     */
    validateVisuals(visualTimeline) {
        const errors = [];

        visualTimeline.forEach((clip, idx) => {
            // Step 6: 0.8s - 2.5s per clip
            if (clip.durationMs > 2500) {
                errors.push(`Clip ${idx + 1} too long (${clip.durationMs}ms). Max 2.5s.`);
            }
            if (clip.durationMs < 800) {
                errors.push(`Clip ${idx + 1} too short (${clip.durationMs}ms). Min 0.8s.`);
            }
        });

        // Change frequency (2-3s average)
        const avgFreq = visualTimeline.length > 0 ? (visualTimeline[visualTimeline.length - 1].endTimeMs / visualTimeline.length) : 0;
        if (avgFreq > 3000) {
            errors.push(`Visual energy too low. Change freq: ${Math.round(avgFreq)}ms. Max 3s.`);
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Step 7/8: Edit Plan Validation
     */
    validateEditPlan(editPlan) {
        const errors = [];

        if (!editPlan || editPlan.length === 0) {
            errors.push("Edit plan is empty.");
        }

        // Basic sanity check: ensure no gaps/overlaps in the plan
        let lastEnd = 0;
        editPlan.forEach((seg, idx) => {
            if (Math.abs(seg.start_ms - lastEnd) > 50) {
                errors.push(`Gap/Overlap detected at segment ${idx}: ${lastEnd}ms vs ${seg.start_ms}ms`);
            }
            lastEnd = seg.end_ms;
        });

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Step 9: Final Quality Auditor (GO/NO-GO)
     */
    auditFinalVideo(data) {
        const { script, audio, visuals, edit } = data;
        const hook = script.scenes?.[0]?.text || script.hook;

        // 1. Hook Attention Grab (0-2s)
        const hookLower = hook.toLowerCase();
        const attentionGrabbers = ["but", "wrong", "lie", "secret", "nobody", "stop", "failed"];
        const hasAttentionGrabber = attentionGrabbers.some(word => hookLower.includes(word));

        if (!hasAttentionGrabber && !this.HOOK_PATTERNS.some(p => p.test(hook))) {
            return { decision: "NO-GO", reason: "First 2 seconds feel skippable (No cognitive grab)" };
        }

        // 2. Uniform Pacing Check (Step 4: >4s uniform)
        const timestamps = audio.timestamps;
        let uniformDuration = 0;
        let lastWPS = -1;

        for (let i = 0; i < timestamps.length - 10; i += 5) {
            const chunk = timestamps.slice(i, i + 5);
            const duration = (chunk[4].end_ms - chunk[0].start_ms) / 1000;
            const wps = 5 / duration;

            if (lastWPS !== -1 && Math.abs(wps - lastWPS) < 0.2) {
                uniformDuration += duration;
            } else {
                uniformDuration = 0;
            }
            lastWPS = wps;

            if (uniformDuration > 4) {
                return { decision: "NO-GO", reason: "Pacing feels uniform for more than 4 seconds" };
            }
        }

        // 3. Emotional Signal / Stance
        const stanceWords = ["isnt", "is not", "problem", "truth", "lies", "failed", "shouldnt"];
        const scriptText = [hook, ...script.scenes.map(s => s.text)].join(' ').toLowerCase();
        const hasStance = stanceWords.some(w => scriptText.includes(w));

        if (!hasStance) {
            return { decision: "NO-GO", reason: "Video feels neutral and safe (No stance taken)" };
        }

        // 4. Incomplete/Sharp Ending (Step 5)
        const ending = script.scenes[script.scenes.length - 1].text.toLowerCase();
        const completionWords = ["summary", "conclude", "in conclusion", "thank you", "follow for more"];
        const feelsComplete = completionWords.some(w => ending.includes(w));

        if (feelsComplete) {
            return { decision: "NO-GO", reason: "Video feels complete/polite instead of intentionally unfinished" };
        }

        return { decision: "GO" };
    }
}

module.exports = new QualityControlService();
