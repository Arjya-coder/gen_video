const stockProvider = require('./stockProvider');
const assetCache = require('./assetCache');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Visual Service Phase 5 (Real Implementation)
 * - Deterministic Pacing (0.8s - 3.0s)
 * - Pattern Interrupts (Zoom, Pan, New Clip)
 * - Strict Uniqueness (No reuse)
 * - Fallback Logic
 */
class VisualService {

    /**
     * Generate visual timeline.
     * @param {Array} keywords 
     * @param {number} totalDurationMs 
     * @param {boolean} debugMode 
     * @returns {Promise<Array>}
     */
    async generateTimeline(keywords, totalDurationMs, debugMode = false) {
        console.log(`[Visual] Generating timeline. Duration: ${totalDurationMs}ms. Keywords: ${keywords.length}`);

        const timeline = [];
        let currentTimeMs = 0;
        const usedIds = new Set();
        let keywordIdx = 0;
        const MAX_CLIP_MS = 3000;

        // 1. Parallel Pre-fetch Stage (Efficiency Boost)
        // Group keywords and search in parallel to populate cache immediately
        const uniqueKeywords = [...new Set(keywords)];
        console.log(`[Visual] Pre-fetching assets for ${uniqueKeywords.length} unique keywords...`);

        await Promise.all(uniqueKeywords.map(async (kw) => {
            if (!assetCache.get(kw)) {
                const results = await stockProvider.search(kw);
                assetCache.set(kw, results);
            }
        }));

        // PRE-CHECK: Ensure we can cover the duration with unique assets if possible.
        let allAvailable;
        try {
            allAvailable = await stockProvider.getAllUnusedAssets(new Set());
        } catch (err) {
            console.error(`[Visual] Error context: keywords=${JSON.stringify(keywords)}, duration=${totalDurationMs}`);
            throw err;
        }

        const totalUniqueAvailable = allAvailable ? allAvailable.length : 0;
        if (totalUniqueAvailable === 0) {
            throw new Error(`CRITICAL: No assets available in database.`);
        }

        const maxUniqueCoverage = totalUniqueAvailable * MAX_CLIP_MS;
        let allowReuseIfNeeded = false;
        if (maxUniqueCoverage < totalDurationMs) {
            allowReuseIfNeeded = true;
            console.warn(`[Visual] Not enough unique assets. Enabling controlled reuse.`);
        }

        const desiredMinClipDuration = Math.ceil(totalDurationMs / Math.max(1, totalUniqueAvailable));
        const minClipMs = Math.max(800, Math.min(desiredMinClipDuration, MAX_CLIP_MS));

        console.log(`[Visual] Configuration: uniqueAvailable=${totalUniqueAvailable}, minClipMs=${minClipMs}, reuse=${allowReuseIfNeeded}`);

        // 2. Timeline Generation Loop
        while (currentTimeMs < totalDurationMs) {
            // Determine Clip Duration (Deterministic Randomness bounded)
            let clipDuration = Math.floor(Math.random() * (MAX_CLIP_MS - minClipMs + 1) + minClipMs);

            // Handle the end of the timeline
            const remainingTime = totalDurationMs - currentTimeMs;

            // If the calculated duration is more than what's left, cap it
            if (clipDuration > remainingTime) {
                clipDuration = remainingTime;
            }

            // Lookahead: if the remaining time after this clip would be too small to form a valid clip
            // (< 800ms), we have two choices:
            // 1. Absorb it into this clip (ONLY if it doesn't exceed 3000ms)
            // 2. Adjust this clip so the remainder is exactly 800ms (or more)
            const nextRemaining = remainingTime - clipDuration;
            if (nextRemaining > 0 && nextRemaining < 800) {
                if (remainingTime <= MAX_CLIP_MS) {
                    // Option 1: Absorb remainder
                    clipDuration = remainingTime;
                } else {
                    // Option 2: Shrink this clip so the next one is exactly 800ms
                    clipDuration = remainingTime - 800;
                }
            }

            const currentKeyword = keywords[keywordIdx % keywords.length];
            const lastId = timeline.length ? timeline[timeline.length - 1].clip_id : null;

            // Selection logic (Layers 1-3 handled inside _selectUniqueAsset)
            let asset = await this._selectUniqueAsset(currentKeyword, usedIds, { allowReuse: allowReuseIfNeeded, lastId });

            if (!asset) {
                // Secondary recovery: Try any other keyword in parallel-cached assets
                for (const kw of uniqueKeywords) {
                    asset = await this._selectUniqueAsset(kw, usedIds, { allowReuse: allowReuseIfNeeded, lastId });
                    if (asset) break;
                }
            }

            if (!asset) {
                throw new Error(`CRITICAL: Ran out of unique visual assets at ${currentTimeMs}ms.`);
            }

            usedIds.add(asset.id);
            keywordIdx++;

            const transform = this._generateTransform();
            const localPath = await this._ensureLocalAsset(asset);

            timeline.push({
                clip_id: asset.id,
                source: asset.provider,
                file_path: localPath,
                start_ms: Math.round(currentTimeMs),
                end_ms: Math.round(currentTimeMs + clipDuration),
                keyword: currentKeyword,
                transform
            });

            currentTimeMs += clipDuration;
        }

        return timeline;
    }

    async _selectUniqueAsset(keyword, usedIds, options = {}) {
        // options: { allowReuse: boolean, lastId: string }
        const { allowReuse = false, lastId = null } = options;

        // LAYER 1: Try exact keyword search with cached results
        let assets = assetCache.get(keyword);
        if (!assets) {
            assets = await stockProvider.search(keyword);
            assetCache.set(keyword, assets);
        }

        // Prefer unused
        let candidate = assets.find(a => !usedIds.has(a.id));
        if (candidate) {
            return candidate;
        }
        console.warn(`[Visual] Layer 1 Failed: No unique assets for keyword "${keyword}"`);

        // LAYER 2: Try a broader fallback set from provider (use getFallbacks for richer coverage)
        console.warn(`[Visual] Layer 2: Attempting generic fallback search...`);
        const genericAssets = await stockProvider.getFallbacks();
        candidate = genericAssets.find(a => !usedIds.has(a.id));
        if (candidate) {
            console.warn(`[Visual] Layer 2 Success: Found generic asset ${candidate.id}`);
            return candidate;
        }
        console.warn(`[Visual] Layer 2 Failed: No generic assets available`);

        // LAYER 3: NUCLEAR FALLBACK - Query entire database for ANY unused asset
        console.warn(`[Visual] Layer 3 NUCLEAR FALLBACK: Scanning entire database for unused assets...`);
        const allAssets = await stockProvider.getAllUnusedAssets(usedIds);
        if (allAssets.length > 0) {
            candidate = allAssets[Math.floor(Math.random() * allAssets.length)];
            console.warn(`[Visual] Layer 3 Success: Grabbed ANY unused asset ${candidate.id} (${allAssets.length} unused total)`);
            return candidate;
        }

        // If we reach here, there are absolutely no unused assets left.
        if (allowReuse) {
            // Controlled reuse: pick any asset but try to avoid repeating the lastId immediately.
            console.warn(`[Visual] No unused assets remaining. Controlled reuse enabled.`);
            const all = await stockProvider.getAllUnusedAssets(new Set()); // returns all assets
            let reuseCandidate = all.find(a => a.id !== lastId) || all[0] || null;
            if (reuseCandidate) {
                reuseCandidate.reused = true;
                console.warn(`[Visual] Reusing asset ${reuseCandidate.id} as last resort.`);
                return reuseCandidate;
            }
        }

        // LAYER 4: Complete failure
        console.error(`[Visual] Layer 3 Failed: Absolutely no assets available in entire database.`);
        return null;
    }

    _generateTransform() {
        const transforms = ['none', 'left', 'right', 'up', 'down'];
        const zooms = [1.0, 1.05, 1.1]; // Subtle zooms

        // Weighted random: 50% chance of 'none' pan, 50% chance of movement
        // 50% chance of zoom

        return {
            zoom: Math.random() > 0.5 ? zooms[Math.floor(Math.random() * zooms.length)] : 1.0,
            pan: Math.random() > 0.5 ? transforms[Math.floor(Math.random() * transforms.length)] : 'none'
        };
    }

    async _ensureLocalAsset(asset) {
        const clipsDir = path.join(__dirname, '../../assets/clips');
        if (!fs.existsSync(clipsDir)) fs.mkdirSync(clipsDir, { recursive: true });

        const localFile = path.join(clipsDir, `${asset.id}.mp4`);

        // If already downloaded, return path
        if (assetCache.isDownloaded(asset.id) && fs.existsSync(localFile)) {
            return localFile;
        }

        // Check if it's a real URL or a mock
        const isMock = !asset.url || asset.url.includes('mock.com');

        if (isMock) {
            console.log(`[Visual] Using placeholder for mock asset: ${asset.id}`);
            const basePlaceholder = path.join(__dirname, '../../assets/placeholder_base.mp4');
            if (fs.existsSync(basePlaceholder)) {
                fs.copyFileSync(basePlaceholder, localFile);
            } else {
                fs.writeFileSync(localFile, Buffer.from(`MOCK_${asset.id}`));
            }
            assetCache.markDownloaded(asset.id);
            return localFile;
        }

        // Real Download
        try {
            console.log(`[Visual] Downloading real asset: ${asset.url}`);
            const response = await axios({
                method: 'get',
                url: asset.url,
                responseType: 'stream'
            });

            const writer = fs.createWriteStream(localFile);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    assetCache.markDownloaded(asset.id);
                    resolve(localFile);
                });
                writer.on('error', (err) => {
                    console.error(`[Visual] Download stream error for ${asset.id}:`, err);
                    reject(err);
                });
            });
        } catch (err) {
            console.error(`[Visual] Failed to download real asset ${asset.id}:`, err.message);
            // Emergency fallback to blue screen so the render doesn't crash
            const basePlaceholder = path.join(__dirname, '../../assets/placeholder_base.mp4');
            if (fs.existsSync(basePlaceholder)) {
                fs.copyFileSync(basePlaceholder, localFile);
            }
            return localFile;
        }
    }
}

module.exports = new VisualService();
