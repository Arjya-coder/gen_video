/**
 * Asset Cache Service
 * Manages metadata caching for visual assets to avoid redundant lookups.
 * In a real production system, this would be Redis. For now, in-memory is sufficient.
 */

class AssetCache {
    constructor() {
        this.cache = new Map();
        // Simulate "downloaded" assets
        this.localAssets = new Set();
    }

    /**
     * Get cached assets for a keyword.
     * @param {string} keyword 
     * @returns {Array|null} List of asset objects or null
     */
    get(keyword) {
        if (!keyword) return null;
        return this.cache.get(keyword.toLowerCase());
    }

    /**
     * Set cached assets for a keyword.
     * @param {string} keyword 
     * @param {Array} assets 
     */
    set(keyword, assets) {
        if (!keyword || !assets) return;
        this.cache.set(keyword.toLowerCase(), assets);
    }

    /**
     * Mark an asset as "downloaded" (locally available).
     * @param {string} assetId 
     */
    markDownloaded(assetId) {
        this.localAssets.add(assetId);
    }

    /**
     * Check if asset is downloaded.
     * @param {string} assetId 
     * @returns {boolean}
     */
    isDownloaded(assetId) {
        return this.localAssets.has(assetId);
    }

    /**
     * Clear cache (useful for testing)
     */
    clear() {
        this.cache.clear();
        this.localAssets.clear();
    }
}

module.exports = new AssetCache();
