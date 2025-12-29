const axios = require('axios');
require('dotenv').config();

const MOCK_DB = [
    // Finance / Business
    { id: 'mock_fin_1', tags: ['finance', 'money', 'growth', 'chart'], url: 'http://mock.com/fin1.mp4', provider: 'MockStock' },
    { id: 'mock_fin_2', tags: ['finance', 'business', 'office', 'meeting'], url: 'http://mock.com/fin2.mp4', provider: 'MockStock' },
    { id: 'mock_fin_3', tags: ['money', 'cash', 'wealth'], url: 'http://mock.com/fin3.mp4', provider: 'MockStock' },
    { id: 'mock_fin_4', tags: ['finance', 'market', 'stock'], url: 'http://mock.com/fin4.mp4', provider: 'MockStock' },
    { id: 'mock_fin_5', tags: ['business', 'handshake', 'deal'], url: 'http://mock.com/fin5.mp4', provider: 'MockStock' },
    // Tech
    { id: 'mock_tech_1', tags: ['technology', 'computer', 'code', 'hacker'], url: 'http://mock.com/tech1.mp4', provider: 'MockStock' },
    { id: 'mock_tech_2', tags: ['future', 'robot', 'ai', 'cyber'], url: 'http://mock.com/tech2.mp4', provider: 'MockStock' },
    { id: 'mock_tech_3', tags: ['code', 'screen', 'software'], url: 'http://mock.com/tech3.mp4', provider: 'MockStock' },
    { id: 'mock_tech_4', tags: ['server', 'data', 'cloud'], url: 'http://mock.com/tech4.mp4', provider: 'MockStock' },
    { id: 'mock_tech_5', tags: ['mobile', 'app', 'phone'], url: 'http://mock.com/tech5.mp4', provider: 'MockStock' },
    // Nature
    { id: 'mock_nat_1', tags: ['nature', 'forest', 'calm', 'green'], url: 'http://mock.com/nat1.mp4', provider: 'MockStock' },
    { id: 'mock_nat_2', tags: ['water', 'ocean', 'blue', 'relax'], url: 'http://mock.com/nat2.mp4', provider: 'MockStock' },
    { id: 'mock_nat_3', tags: ['mountain', 'sky', 'clouds'], url: 'http://mock.com/nat3.mp4', provider: 'MockStock' },
    { id: 'mock_nat_4', tags: ['flowers', 'spring', 'bloom'], url: 'http://mock.com/nat4.mp4', provider: 'MockStock' },
    { id: 'mock_nat_5', tags: ['sunset', 'sun', 'evening'], url: 'http://mock.com/nat5.mp4', provider: 'MockStock' },
    // Generic
    { id: 'mock_broll_1', tags: ['people', 'walking', 'city'], url: 'http://mock.com/gen1.mp4', provider: 'MockStock' },
    { id: 'mock_broll_2', tags: ['street', 'traffic', 'night'], url: 'http://mock.com/gen2.mp4', provider: 'MockStock' },
    { id: 'mock_broll_3', tags: ['abstract', 'lights', 'blur'], url: 'http://mock.com/gen3.mp4', provider: 'MockStock' }
];

class StockProvider {
    constructor() {
        this.apiKey = process.env.PEXELS_API_KEY;
        this.baseUrl = 'https://api.pexels.com/videos';
    }

    async search(query) {
        if (!this.apiKey) {
            console.warn('[StockProvider] No PEXELS_API_KEY found. Using MOCK data.');
            return this._mockSearch(query);
        }

        try {
            console.log(`[StockProvider] Searching Pexels for: ${query}`);
            const response = await axios.get(`${this.baseUrl}/search`, {
                params: { query, per_page: 5, orientation: 'portrait' },
                headers: { 'Authorization': this.apiKey }
            });

            if (response.data?.videos?.length > 0) {
                return response.data.videos.map(video => ({
                    id: `pexels_${video.id}`,
                    tags: [query],
                    url: video.video_files.find(f => f.file_type === 'video/mp4' && f.width >= 1080)?.link || video.video_files[0].link,
                    provider: 'Pexels'
                }));
            }
            return this._mockSearch(query);
        } catch (error) {
            console.error('[StockProvider] Pexels search error:', error.message);
            return this._mockSearch(query);
        }
    }

    _mockSearch(query) {
        if (!query) return [];
        const terms = query.toLowerCase().split(' ');
        return MOCK_DB.filter(asset =>
            asset.tags.some(tag => terms.some(term => tag.includes(term) || term.includes(tag)))
        );
    }

    async getFallbacks() {
        return MOCK_DB;
    }

    async getAllUnusedAssets(usedIds) {
        return MOCK_DB.filter(asset => !usedIds.has(asset.id));
    }
}

module.exports = new StockProvider();
