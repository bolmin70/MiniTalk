// ──────────────────────────────────────────────
// OpenAI provider (Chat Completions API)
// ──────────────────────────────────────────────
//
// Streams are piped through unchanged (OpenAI SSE with `delta.content`),
// matching SillyTavern's `openai` source.

import { readSecret, SECRET_KEYS } from '../secrets.js';
import { HttpError, abortOnClientClose, forwardFetchResponse } from '../util.js';

export const id = 'openai';
export const name = 'OpenAI';

const API_OPENAI = 'https://api.openai.com/v1';
// /models also lists embedding, audio, image and moderation models; these can't chat.
const NON_CHAT_MODEL = /embedding|whisper|tts|transcribe|dall-e|gpt-image|moderation|realtime|audio|search|davinci|babbage|codex|computer-use/;

function getApiKey() {
    const apiKey = readSecret(SECRET_KEYS.OPENAI);
    if (!apiKey) {
        throw new HttpError(400, 'OpenAI API key is missing. Add "api_key_openai" to data/default-user/secrets.json or set OPENAI_API_KEY.');
    }
    return apiKey;
}

/**
 * @param {Response} response
 * @param {string} what e.g. 'model list'
 */
async function readError(response, what) {
    const text = await response.text();
    let message = text;
    try {
        message = JSON.parse(text)?.error?.message ?? text;
    } catch {
        // Not JSON; use the raw text.
    }
    return new HttpError(response.status, `OpenAI ${what} failed: ${response.status} ${message}`);
}

export async function listModels() {
    const response = await fetch(`${API_OPENAI}/models`, {
        headers: { 'Authorization': `Bearer ${getApiKey()}` },
    });
    if (!response.ok) {
        throw await readError(response, 'model list');
    }
    const data = await response.json();
    return (data?.data ?? [])
        .filter(m => !NON_CHAT_MODEL.test(m.id))
        .map(m => ({ id: m.id, name: m.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function generate(req, res) {
    const apiKey = getApiKey();
    const body = req.body;
    const controller = abortOnClientClose(res);

    const requestBody = {
        model: body.model,
        messages: body.messages,
        stream: Boolean(body.stream),
    };
    // Newer models (o-series, GPT-5) reject the older `max_tokens`.
    if (Number(body.max_tokens) > 0) {
        requestBody.max_completion_tokens = Number(body.max_tokens);
    }
    if (Array.isArray(body.stop) && body.stop.length) {
        requestBody.stop = body.stop;
    }

    const response = await fetch(`${API_OPENAI}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        throw await readError(response, 'request');
    }

    if (requestBody.stream) {
        return forwardFetchResponse(response, res);
    }
    return res.json(await response.json());
}
