/**
 * PHASE 6 Editing Rules Engine
 * - Deterministic conversion of audio timestamps + captions + visual timeline
 *   into an edit plan following the locked rules from the user.
 * - Does NOT render, call FFmpeg, or add music.
 */
const fs = require('fs');
const path = require('path');

class EditingService {
    constructor() {
        this.MAX_SEGMENT_MS = 3000; // no segment longer than 3000ms
        this.PATTERN_INTERVAL_MS = 2500; // deterministic pattern interrupt interval (within 2000-3000)
        this.BASE_ZOOM = 1.0;
        this.EMPHASIS_ZOOM = 1.05; // deterministic within allowed range
        this.PANS = ['none', 'left', 'right', 'up', 'down'];
    }

    /**
     * Main entry: build and validate edit plan.
     * @param {{audio:Object,captions:Object,visuals:Object}} inputs
     * @param {boolean} debug
     * @returns {{isValid:boolean,plan?:Array,errors?:Array,debug?:Array}}
     */
    generateEditPlan(inputs, debug = false) {
        const { audio, captions, visuals } = inputs;
        const dbg = [];

        // Basic presence checks
        if (!audio || !Array.isArray(audio.timestamps)) return { isValid: false, errors: ['Missing audio timestamps'] };
        if (!captions || !Array.isArray(captions.timeline)) return { isValid: false, errors: ['Missing captions timeline'] };
        if (!visuals || !Array.isArray(visuals.timeline)) return { isValid: false, errors: ['Missing visuals timeline'] };

        const totalDuration = audio.duration_ms;

        // Start with caption groups as base segments
        let segments = captions.timeline.map((c, i) => ({
            start_ms: c.start_ms,
            end_ms: c.end_ms,
            caption_id: `cap_${i}`,
            caption: c
        }));

        // Split long segments at word boundaries (never cut mid-word)
        segments = this._splitAtWordBoundaries(segments, audio.timestamps, dbg);

        // Isolate emphasized words into their own segments
        segments = this._isolateEmphasis(segments, audio.timestamps, dbg);

        // Ensure segments cover full duration without gaps by filling silent gaps deterministically
        segments = this._fillGapsDeterministically(segments, visuals.timeline, totalDuration, dbg);

        // Map segments to visuals, attach default transforms
        const planEntries = segments.map(s => {
            const clip = this._findVisualForTime(visuals.timeline, s.start_ms);
            if (!clip) throw new Error(`No visual clip covers time ${s.start_ms}ms`);
            return {
                start_ms: s.start_ms,
                end_ms: s.end_ms,
                clip_id: clip.clip_id,
                zoom: this.BASE_ZOOM,
                pan: 'none',
                caption_id: s.caption_id,
                reason: 'cut',
                _words: s.words || [],
                _caption: s.caption
            };
        });

        // Apply emphasis zooms where allowed (must be exact word segments)
        for (const e of planEntries) {
            if ((e._words || []).length === 1 && e._words[0].emphasis) {
                e.zoom = this.EMPHASIS_ZOOM;
                e.reason = 'emphasis';
                dbg.push({ type: 'emphasis_applied', clip_id: e.clip_id, start: e.start_ms });
            }
            // If caption has emphasis indices, require visual reflect it
            if (e._caption && e._caption.emphasis_indices && e._caption.emphasis_indices.length > 0) {
                // Ensure at least zoom OR pan changed; per rules, emphasis -> visual must reflect
                if (e.zoom === this.BASE_ZOOM) {
                    // apply zoom deterministically
                    e.zoom = this.EMPHASIS_ZOOM;
                    e.reason = 'emphasis';
                    dbg.push({ type: 'caption_emphasis_applied_zoom', clip_id: e.clip_id, start: e.start_ms });
                }
            }
        }

        // Pattern interrupts: ensure one in every PATTERN_INTERVAL_MS window
        for (let windowStart = 0; windowStart < totalDuration; windowStart += this.PATTERN_INTERVAL_MS) {
            const windowEnd = Math.min(windowStart + this.PATTERN_INTERVAL_MS, totalDuration);
            // Find a non-emphasis segment that intersects the window
            const candidate = planEntries.find(p => p.start_ms < windowEnd && p.end_ms > windowStart && p.reason !== 'emphasis');
            if (!candidate) {
                return { isValid: false, errors: [`Pattern interrupt missing or conflicts with emphasis in window ${windowStart}-${windowEnd}ms`] };
            }
            // Apply deterministic pan on that candidate
            candidate.pan = this._deterministicPan(candidate.clip_id);
            candidate.reason = 'pattern_interrupt';
            dbg.push({ type: 'pattern_interrupt', window: `${windowStart}-${windowEnd}`, clip_id: candidate.clip_id, pan: candidate.pan });
        }

        // Final validation: segment lengths, overlaps/gaps, zoom without emphasis
        const validation = this._validate(planEntries, totalDuration);
        if (!validation.isValid) return { isValid: false, errors: validation.errors, debug: debug ? dbg : undefined };

        // Prepare final plan adhering to strict schema
        const finalPlan = planEntries.map(p => ({
            start_ms: p.start_ms,
            end_ms: p.end_ms,
            clip_id: p.clip_id,
            zoom: p.zoom,
            pan: p.pan,
            caption_id: p.caption_id,
            reason: p.reason
        }));

        return { isValid: true, plan: finalPlan, debug: debug ? dbg : undefined };
    }

    _splitAtWordBoundaries(segments, words, dbg) {
        const out = [];
        for (const s of segments) {
            let dur = s.end_ms - s.start_ms;
            if (dur <= this.MAX_SEGMENT_MS) {
                s.words = this._wordsInRange(words, s.start_ms, s.end_ms);
                out.push(s);
                continue;
            }
            // split deterministically into chunks <= MAX_SEGMENT_MS at prior word boundaries
            let cursor = s.start_ms;
            while (cursor < s.end_ms) {
                const target = Math.min(cursor + this.MAX_SEGMENT_MS, s.end_ms);
                const candidate = this._wordsInRange(words, cursor, target + 1);
                let sliceEnd = target;
                if (candidate.length > 0) sliceEnd = Math.min(candidate[candidate.length-1].end_ms, s.end_ms);
                if (sliceEnd <= cursor) throw new Error(`Cannot split without cutting mid-word between ${cursor} and ${s.end_ms}`);
                const seg = { start_ms: cursor, end_ms: sliceEnd, caption_id: s.caption_id, caption: s.caption };
                seg.words = this._wordsInRange(words, seg.start_ms, seg.end_ms);
                out.push(seg);
                dbg.push({ type: 'split', original: s.caption?.text, created: `${seg.start_ms}-${seg.end_ms}` });
                cursor = sliceEnd;
            }
        }
        return out;
    }

    _isolateEmphasis(segments, words, dbg) {
        const out = [];
        for (const s of segments) {
            const emphasisWords = (s.words||[]).filter(w => w.emphasis);
            if (emphasisWords.length === 0) { out.push(s); continue; }
            let cursor = s.start_ms;
            for (const w of s.words) {
                if (w.emphasis) {
                    if (w.start_ms > cursor) out.push({ start_ms: cursor, end_ms: w.start_ms, caption_id: s.caption_id, caption: s.caption, words: this._wordsInRange(words, cursor, w.start_ms) });
                    out.push({ start_ms: w.start_ms, end_ms: w.end_ms, caption_id: s.caption_id, caption: s.caption, words: [w] });
                    cursor = w.end_ms;
                }
            }
            if (cursor < s.end_ms) out.push({ start_ms: cursor, end_ms: s.end_ms, caption_id: s.caption_id, caption: s.caption, words: this._wordsInRange(words, cursor, s.end_ms) });
            dbg.push({ type: 'isolate_emphasis', caption: s.caption?.text });
        }
        return out;
    }

    _fillGapsDeterministically(segments, visualsTimeline, totalDuration, dbg) {
        // Ensure segments are sorted
        segments.sort((a,b) => a.start_ms - b.start_ms);
        const out = [];
        let expected = 0;
        let silenceIdx = 0;

        for (const s of segments) {
            if (s.start_ms > expected + 20) {
                // Create a filler segment covering [expected, s.start_ms)
                let gapStart = expected;
                let gapEnd = s.start_ms;
                // Possibly split into multiple chunks <= MAX_SEGMENT_MS
                while (gapStart < gapEnd) {
                    const chunkEnd = Math.min(gapStart + this.MAX_SEGMENT_MS, gapEnd);
                    const coveringClip = this._findVisualForTime(visualsTimeline, gapStart);
                    if (!coveringClip) throw new Error(`No visual to cover silent gap at ${gapStart}ms`);
                    const filler = { start_ms: gapStart, end_ms: chunkEnd, caption_id: `silence_${silenceIdx++}`, caption: null, words: [] };
                    out.push(filler);
                    dbg.push({ type: 'fill_silence', start: filler.start_ms, end: filler.end_ms, clip_id: coveringClip.clip_id });
                    gapStart = chunkEnd;
                }
            } else if (s.start_ms < expected - 20) {
                // Overlap beyond tolerance -> conflict
                throw new Error(`Overlap detected at ${s.start_ms}ms (expected ${expected}ms)`);
            }

            out.push(s);
            expected = s.end_ms;
        }

        if (expected < totalDuration - 20) {
            // trailing silence
            let gapStart = expected;
            const gapEnd = totalDuration;
            let silenceIdx2 = 0;
            while (gapStart < gapEnd) {
                const chunkEnd = Math.min(gapStart + this.MAX_SEGMENT_MS, gapEnd);
                const coveringClip = this._findVisualForTime(visualsTimeline, gapStart);
                if (!coveringClip) throw new Error(`No visual to cover trailing silence at ${gapStart}ms`);
                const filler = { start_ms: gapStart, end_ms: chunkEnd, caption_id: `silence_tail_${silenceIdx2++}`, caption: null, words: [] };
                out.push(filler);
                dbg.push({ type: 'fill_trailing_silence', start: filler.start_ms, end: filler.end_ms, clip_id: coveringClip.clip_id });
                gapStart = chunkEnd;
            }
            expected = gapEnd;
        }

        return out;
    }

    _wordsInRange(words, start, end) { return words.filter(w => w.start_ms >= start && w.end_ms <= end); }

    _findVisualForTime(visuals, t) { return visuals.find(v => v.start_ms <= t && v.end_ms > t); }

    _deterministicPan(clipId) {
        let s = 0; for (let i=0;i<clipId.length;i++) s += clipId.charCodeAt(i);
        // choose index 1..4 to avoid 'none' as first
        const idx = (s % (this.PANS.length-1)) + 1;
        return this.PANS[idx];
    }

    _validate(plan, totalDuration) {
        const errors = [];
        // length check
        for (const p of plan) {
            if (p.end_ms - p.start_ms > this.MAX_SEGMENT_MS) errors.push(`Segment ${p.clip_id} ${p.start_ms}-${p.end_ms}ms too long`);
            if (![this.BASE_ZOOM, this.EMPHASIS_ZOOM].includes(p.zoom)) errors.push(`Invalid zoom ${p.zoom} on ${p.clip_id}`);
        }
        // overlaps/gaps
        plan.sort((a,b)=>a.start_ms-b.start_ms);
        let expected = 0;
        for (const p of plan) {
            if (Math.abs(p.start_ms - expected) > 20) errors.push(`Gap/Overlap at ${p.start_ms}ms (expected ${expected}ms)`);
            expected = p.end_ms;
        }
        if (Math.abs(expected - totalDuration) > 200) errors.push(`Timeline end mismatch. Expected ${totalDuration}ms, got ${expected}ms`);
        // pattern interrupts already enforced earlier; also ensure zoom applied only when reason=emphasis
        for (const p of plan) {
            if (p.zoom !== this.BASE_ZOOM && p.reason !== 'emphasis') errors.push(`Zoom applied without emphasis at ${p.start_ms}ms`);
        }
        return { isValid: errors.length===0, errors };
    }
}

module.exports = new EditingService();
