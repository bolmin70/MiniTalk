// Token counting with the cl100k_base BPE encoding (js-tiktoken, pure JS).
// Claude's tokenizers aren't public; the frontend scales these counts per
// model family (see public/scripts/tokenizers.js) to approximate them.

import express from 'express';
import { Tiktoken } from 'js-tiktoken/lite';

export const TOKENIZER_NAME = 'cl100k_base';

export const router = express.Router();

/** @type {Promise<Tiktoken> | null} */
let encoderPromise = null;

/** Loads the encoding on first use (~150 ms, ~10 MB in memory). */
function getEncoder() {
    encoderPromise ??= import('js-tiktoken/ranks/cl100k_base').then(({ default: ranks }) => new Tiktoken(ranks));
    return encoderPromise;
}

// POST /count  { texts: string[] } → { tokenizer, counts: number[] }
router.post('/count', async (req, res) => {
    const texts = req.body?.texts;
    if (!Array.isArray(texts) || texts.some(text => typeof text !== 'string')) {
        return res.status(400).json({ error: { message: '"texts" must be an array of strings.' } });
    }
    try {
        const encoder = await getEncoder();
        // Special-token markers like <|endoftext|> are counted as plain text.
        const counts = texts.map(text => (text ? encoder.encode(text, [], []).length : 0));
        return res.json({ tokenizer: TOKENIZER_NAME, counts });
    } catch (err) {
        console.error('[tokenizers] count failed:', err);
        return res.status(500).json({ error: { message: err.message } });
    }
});
