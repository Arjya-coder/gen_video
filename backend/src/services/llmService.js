const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");
require('dotenv').config();

class LLMService {
    constructor() {
        // Support multiple keys: GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3...
        this.apiKeys = [];
        const masterKey = process.env.GEMINI_API_KEY;
        if (masterKey) this.apiKeys.push(masterKey);

        for (let i = 2; i <= 5; i++) {
            const key = process.env[`GEMINI_API_KEY_${i}`];
            if (key) this.apiKeys.push(key);
        }

        if (this.apiKeys.length === 0) {
            console.error("[LLM] CRITICAL: No Gemini API keys found in .env");
        } else {
            console.log(`[LLM] Loaded ${this.apiKeys.length} API keys for rotation.`);
        }

        this.currentKeyIdx = 0;
        this._updateModel();

        // Initialize Groq
        this.groqKey = process.env.GROQ_API_KEY;
        if (this.groqKey) {
            this.groq = new Groq({ apiKey: this.groqKey });
            console.log("[LLM] Groq service initialized.");
        }

        // Enable/disable real calls
        this.enabled = (process.env.GEMINI_ENABLED || 'true').toLowerCase() !== 'false';

        // Simple in-process rate control
        this._lastCallTs = 0;
        this._minIntervalMs = parseInt(process.env.GEMINI_MIN_INTERVAL_MS || '1000', 10);
    }

    _updateModel() {
        if (this.apiKeys.length === 0) return;
        const key = this.apiKeys[this.currentKeyIdx];
        this.genAI = new GoogleGenerativeAI(key);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        console.log(`[LLM] Switched to API Key ${this.currentKeyIdx + 1} (${key.substring(0, 4)}...${key.substring(key.length - 4)})`);
    }

    _rotateKey() {
        if (this.apiKeys.length <= 1) return false;
        this.currentKeyIdx = (this.currentKeyIdx + 1) % this.apiKeys.length;
        this._updateModel();
        return true;
    }

    async _throttleIfNeeded() {
        const now = Date.now();
        const elapsed = now - this._lastCallTs;
        if (elapsed < this._minIntervalMs) {
            const wait = this._minIntervalMs - elapsed + Math.floor(Math.random() * 200);
            await new Promise(r => setTimeout(r, wait));
        }
        this._lastCallTs = Date.now();
    }

    /**
     * Call Groq for ultra-fast generation.
     */
    async _callGroq(prompt, { model = "llama-3.3-70b-versatile" } = {}) {
        if (!this.groq) throw new Error("Groq not initialized");

        try {
            await this._throttleIfNeeded();
            const completion = await this.groq.chat.completions.create({
                messages: [{ role: "user", content: prompt }],
                model: model,
                temperature: 0.7,
                response_format: { type: "json_object" }
            });
            return completion.choices[0].message.content;
        } catch (error) {
            console.warn(`[LLM] Groq call failed: ${error.message}. Falling back to Gemini.`);
            throw error; // Let caller handle fallback
        }
    }

    async _callModel(prompt, { retries = 3, baseDelay = 2000 } = {}) {
        let lastError = null;
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                await this._throttleIfNeeded();
                const result = await this.model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                return text;
            } catch (error) {
                lastError = error;
                const status = error && (error.status || error.code || (error.response && error.response.status) || error.statusCode);

                // Non-retryable 4xx (except 429)
                if (status && status >= 400 && status < 500 && status !== 429) {
                    console.error(`[LLM] Non-retryable HTTP ${status} from Gemini.`);
                    throw error;
                }

                // Retryable errors: 429, 503, network issues
                if (status === 429 || status === 503 || !status) {
                    if (status === 429) {
                        const rotated = this._rotateKey();
                        if (rotated) {
                            console.warn(`[LLM] Quota hit (429). Rotated to next key.`);
                            // Optional: Reset attempt counter or decr to retry immediately with new key
                            attempt--;
                            continue;
                        }
                    }
                    const jitter = Math.floor(Math.random() * 500);
                    const delay = baseDelay * Math.pow(2, attempt) + jitter;
                    console.warn(`[LLM] Retryable error (status=${status}). Backing off ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${retries}).`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }

                // Other cases: rethrow
                throw error;
            }
        }
        throw lastError;
    }

    async generateScript({ topic, duration_seconds, tone }) {
        console.log(`[LLM] DEDICATED: Generating script using Groq...`);

        const prompt = `
            You are the SCRIPT INTELLIGENCE module of a Central Conductor video system.
            Topic: "${topic}", Duration: ${duration_seconds}s, Tone: "${tone}".
            Your job is to generate a script that forces attention and escalates curiosity.

            STRICT RULES:
            1. Return ONLY raw JSON.
            2. Split the script into exactly 7 "scenes":
               - Scene 1: Hook (max 12 words). MUST follow one of these logical patterns:
                 * Belief Reversal: "Most people think X, but Y"
                 * Suppressed Truth: "Nobody tells you this about X"
                 * Counterintuitive Claim: "This sounds wrong, but X is true"
                 * Brutal Honesty: "X isn't the problem. Y is."
               - Scene 2-6: Body. Escalate tension/curiosity. Do NOT explain everything.
               - Scene 7: Ending (max 8 words). STOP abruptly. No summaries. No generic CTAs.
            3. Keywords: 2-3 CONCRETE physical objects/actions per scene. NO abstract concepts or adjectives alone.
            4. Tone: Opinionated, not generic. Respect viewer intelligence.

            JSON Structure:
            {
              "scenes": [
                { "type": "hook", "text": "...", "keywords": ["word1", "word2"] },
                ...
                { "type": "ending", "text": "...", "keywords": ["word13", "word14"] }
              ]
            }
        `;

        if (!this.enabled) return this._generateScriptFallback({ topic, duration_seconds, tone });

        try {
            if (this.groq) {
                const text = await this._callGroq(prompt);
                return JSON.parse(text);
            }
            throw new Error("Groq not initialized/available");
        } catch (err) {
            console.error('[LLM] Groq Scripting failed:', err.message);
            // Even in strict mode, we use fallback to prevent job crash
            return this._generateScriptFallback({ topic, duration_seconds, tone });
        }
    }

    _generateScriptFallback({ topic, duration_seconds, tone }) {
        const scenes = [
            { type: 'hook', text: `Here's ${topic} in ${duration_seconds}s`, keywords: [topic, 'fast'] },
            { type: 'body_1', text: `First, you need to know about ${topic}.`, keywords: [topic, 'knowledge'] },
            { type: 'body_2', text: `This is why it's so important.`, keywords: ['important', 'focus'] },
            { type: 'body_3', text: `Most people miss this secret.`, keywords: ['secret', 'hidden'] },
            { type: 'body_4', text: `But once you see it, everything changes.`, keywords: ['change', 'impact'] },
            { type: 'body_5', text: `That's the power of ${topic}.`, keywords: [topic, 'power'] },
            { type: 'ending', text: `Follow for more ${topic} secrets!`, keywords: ['subscribe', 'more'] }
        ];
        return { scenes };
    }

    async extractKeywords(script) {
        // Compatibility wrapper for old flow
        if (script.scenes) {
            return [...new Set(script.scenes.flatMap(s => s.keywords))];
        }

        console.log(`[LLM] DEDICATED: Extracting keywords using Gemini...`);
        // ... (legacy logic remains for fallback)
        const scriptText = `${script.hook} ${script.body.join(" ")} ${script.ending}`;
        const prompt = `
            Extract 8-10 CONCRETE visual keywords for stock footage search from: "${scriptText}"
            Return ONLY a JSON array of strings.
        `;

        if (!this.enabled) return ["technology", "business", "nature", "abstract"];

        try {
            const text = await this._callModel(prompt, { retries: 3, baseDelay: 3000 });
            const cleanedText = (text || '').replace(/```json|```/gi, "").trim();
            return JSON.parse(cleanedText);
        } catch (err) {
            console.error('[LLM] Gemini Keyword Extraction failed:', err.message);
            return ["technology", "business", "nature", "abstract"];
        }
    }
}

module.exports = new LLMService();
