// Approximate token counts. The server counts with cl100k_base; the result is
// scaled per model family, because Claude's tokenizers aren't public.
//
// Scale factors were measured against real Claude input-token counts
// (English and Polish prose, difference in reported usage with/without the text):
//   newer tokenizer  (Opus 4.7+, Opus 5.x, Sonnet 5.x, Fable, Mythos): ×1.44–1.47 English, ×1.24–1.25 Polish → 1.35
//   older tokenizer  (Opus/Sonnet ≤4.6, Haiku 4.5):                    ×1.01–1.13                         → 1.06
// Other (OpenAI, OpenRouter non-Claude) models use the raw cl100k count.

import { getConnection } from './connection.js';
import { getRequestHeaders } from './requests.js';

export const TOKENIZER_NAME = 'cl100k_base';

const NEW_CLAUDE_TOKENIZER = /claude-(opus-(4-[7-9]|[5-9])|sonnet-[5-9]|fable|mythos)/;
const MAX_CACHE_ENTRIES = 1000;

/** Raw cl100k counts by text (most recently used last). */
const cache = new Map();

/**
 * How much to scale a cl100k count for a model.
 * @param {string} model e.g. 'claude-fable-5-1', 'anthropic/claude-opus-4.8', 'openai/gpt-5'
 */
export function getTokenMultiplier(model) {
    const id = String(model ?? '').toLowerCase().replace(/\./g, '-');
    if (NEW_CLAUDE_TOKENIZER.test(id)) return 1.35;
    if (id.includes('claude')) return 1.06;
    return 1;
}

/**
 * "≈ 1 token", "≈ 1,234 tokens".
 * @param {number} count
 */
export function formatTokenCount(count) {
    return `≈ ${count.toLocaleString()} ${count === 1 ? 'token' : 'tokens'}`;
}

/** Human-readable description of how counts are estimated, for tooltips. */
export function describeTokenizer(model = getConnection().model) {
    const multiplier = getTokenMultiplier(model);
    const scale = multiplier === 1 ? '' : ` × ${multiplier}`;
    return `Approximate: ${TOKENIZER_NAME}${scale} for ${model || 'the current model'}`;
}

/**
 * Raw cl100k counts, fetching only texts not already cached.
 * @param {string[]} texts
 * @returns {Promise<number[]>}
 */
async function getRawCounts(texts) {
    const missing = [...new Set(texts.filter(text => text && !cache.has(text)))];
    if (missing.length) {
        const response = await fetch('/api/tokenizers/count', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ texts: missing }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message ?? `Token count failed (HTTP ${response.status})`);
        missing.forEach((text, i) => cache.set(text, data.counts[i]));
        while (cache.size > MAX_CACHE_ENTRIES) {
            cache.delete(cache.keys().next().value);
        }
    }
    return texts.map((text) => {
        if (!text) return 0;
        const count = cache.get(text);
        // Refresh recency.
        cache.delete(text);
        cache.set(text, count);
        return count;
    });
}

/**
 * Approximate token counts for several texts in one request.
 * @param {string[]} texts
 * @param {string} [model] Defaults to the selected model
 * @returns {Promise<number[]>}
 */
export async function getTokenCountsAsync(texts, model = getConnection().model) {
    const multiplier = getTokenMultiplier(model);
    return (await getRawCounts(texts)).map(count => Math.round(count * multiplier));
}

/**
 * Approximate token count of a text. Same name and signature as SillyTavern's.
 * @param {string} text
 * @param {number} [padding] Added to the result
 * @returns {Promise<number>}
 */
export async function getTokenCountAsync(text, padding = 0) {
    const [count] = await getTokenCountsAsync([String(text ?? '')]);
    return count + padding;
}
