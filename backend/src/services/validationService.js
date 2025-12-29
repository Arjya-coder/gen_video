/**
 * Validation Service for Script Gate.
 * Implements deterministic rules for rejecting/accepting scripts.
 */
class ValidationService {
    validate(script, { duration_seconds }) {
        const errors = [];

        // 1. Hook length (Max 12 words)
        const hookWords = script.hook.split(/\s+/).length;
        if (hookWords > 12) {
            errors.push(`Hook too long: ${hookWords} words (Max 12)`);
        }

        // 2. Forbidden Phrases in Hook
        const forbidden = ["did you know", "in this video", "let's talk about"];
        const hookLower = script.hook.toLowerCase();
        forbidden.forEach(phrase => {
            if (hookLower.includes(phrase)) {
                errors.push(`Hook contains forbidden phrase: "${phrase}"`);
            }
        });

        // 3. Word Count vs Duration (Assuming 150 words per minute / 2.5 words per sec)
        const totalWords = [script.hook, ...script.body, script.ending]
            .join(' ')
            .split(/\s+/)
            .length;

        const maxWords = Math.ceil(duration_seconds * 3.0);
        if (totalWords > maxWords) {
            errors.push(`Script too long for ${duration_seconds}s: ${totalWords} words (Max ${maxWords})`);
        }

        // 4. Body Sentence Count (3-7 sentences)
        if (script.body.length < 3 || script.body.length > 7) {
            errors.push(`Body must have 3-7 sentences (Current: ${script.body.length})`);
        }

        // 5. Sentence Structure (No long/compound sentences - Proxy: Max 15 words per sentence)
        const allSentences = [script.hook, ...script.body, script.ending];
        allSentences.forEach((s, idx) => {
            const words = s.split(/\s+/).length;
            if (words > 25) {
                errors.push(`Sentence ${idx + 1} is too long/complex: ${words} words (Max 25)`);
            }
        });

        // 6. Repetition Check
        const sentences = [script.hook, ...script.body, script.ending].map(s => s.toLowerCase().trim());
        const uniqueSentences = new Set(sentences);
        if (uniqueSentences.size !== sentences.length) {
            errors.push(`Duplicate sentences detected.`);
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = new ValidationService();
