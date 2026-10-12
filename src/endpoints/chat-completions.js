// ──────────────────────────────────────────────
// /api/backends/chat-completions — same URLs and body shape as SillyTavern
// ──────────────────────────────────────────────
//
// POST /generate { chat_completion_source, model, messages, stream, max_tokens?, stop? }
//   Each provider answers in its native wire format (see src/providers/*),
//   exactly as SillyTavern does, so extensions that observe this request
//   (token panels etc.) see the responses they expect.
// POST /status { chat_completion_source } → { data: [{ id, name }] }

import express from 'express';

import * as claude from '../providers/claude.js';
import * as openai from '../providers/openai.js';
import * as openrouter from '../providers/openrouter.js';
import { sendError } from '../util.js';

export const PROVIDERS = Object.fromEntries([claude, openai, openrouter].map(p => [p.id, p]));

export const router = express.Router();

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function getProvider(req, res) {
    const source = req.body?.chat_completion_source;
    const provider = PROVIDERS[source];
    if (!provider) {
        sendError(res, 400, `Unknown chat_completion_source: ${source}`);
    }
    return provider;
}

router.post('/status', async (req, res) => {
    const provider = getProvider(req, res);
    if (!provider) return;
    try {
        const models = await provider.listModels();
        return res.json({ data: models });
    } catch (err) {
        console.warn(`[${provider.id}] model list failed:`, err.message);
        return sendError(res, err.status, err.message);
    }
});

router.post('/generate', async (req, res) => {
    const provider = getProvider(req, res);
    if (!provider) return;

    const { model, messages } = req.body;
    if (!model || !Array.isArray(messages) || messages.length === 0) {
        return sendError(res, 400, 'model and a non-empty messages[] are required');
    }

    try {
        await provider.generate(req, res);
    } catch (err) {
        if (err.name === 'AbortError' || err.name === 'APIUserAbortError') {
            return res.end(); // client went away
        }
        console.error(`[${provider.id}] generation failed:`, err.message);
        return sendError(res, err.status, err.message);
    }
});
