/**
 * Caption Service for Phase 4.
 * Handles grouping word-level timing into caption instructions.
 */
class CaptionService {
    /**
     * Groups words into captions.
     * Rules:
     * 1. Max 3 words per group.
     * 2. Max 800ms duration per group.
     * 3. Never split emphasized words if they can fit.
     * @param {Array} timestamps - Word-level timing metadata.
     * @returns {Array} List of caption instructions.
     */
    generateTimeline(timestamps) {
        const groups = [];
        let currentGroup = [];

        timestamps.forEach((item, index) => {
            const isFirstInGroup = currentGroup.length === 0;

            // Calculate potential new duration if we add this word
            let potentialStart = isFirstInGroup ? item.start_ms : currentGroup[0].start_ms;
            let potentialDuration = item.end_ms - potentialStart;

            // Grouping Logic:
            // Break BEFORE adding this word if:
            // - Adding this word exceeds 800ms (and we already have at least one word)
            // - We already have 3 words
            const wouldExceedDuration = !isFirstInGroup && potentialDuration > 800;
            const reachedMaxWords = currentGroup.length >= 3;

            if (wouldExceedDuration || reachedMaxWords) {
                this._pushGroup(groups, currentGroup);
                currentGroup = [item];
            } else {
                currentGroup.push(item);
            }

            const isLastWord = index === timestamps.length - 1;
            if (isLastWord && currentGroup.length > 0) {
                this._pushGroup(groups, currentGroup);
            }
        });

        return groups;
    }

    _pushGroup(groups, currentGroup) {
        const text = currentGroup.map(w => w.word).join(' ');
        const start_ms = currentGroup[0].start_ms;
        const end_ms = currentGroup[currentGroup.length - 1].end_ms;

        const emphasis_indices = currentGroup
            .map((w, i) => w.emphasis ? i : null)
            .filter(idx => idx !== null);

        groups.push({
            text,
            start_ms,
            end_ms,
            emphasis_indices,
            style: {
                font_size: 48,
                color: "#FFFFFF",
                emphasis_color: "#FCD34D",
                shadow: "2px 2px 4px rgba(0,0,0,0.5)"
            }
        });
    }
}

module.exports = new CaptionService();
