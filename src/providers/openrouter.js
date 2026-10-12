// ──────────────────────────────────────────────
// OpenRouter provider (OpenAI-compatible chat completions)
// ──────────────────────────────────────────────
//
// Streams are piped through unchanged (OpenAI SSE with `delta.content` and
// `delta.reasoning`), matching SillyTavern's `openrouter` source.

import { readSecret, SECRET_KEYS } from '../secrets.js';
import { HttpError, abortOnClientClose, forwardFetchResponse } from '../util.js';

export const id = 'openrouter';
export const name = 'OpenRouter';

const API_OPENROUTER = 'https://openrouter.ai/api/v1';
// OpenRouter uses these to attribute requests: https://openrouter.ai/docs#requests
const OPENROUTER_HEADERS = {
    'HTTP-Referer': 'http://localhost',
    'X-Title': 'MiniTalk',
};

function getApiKey() {
    const apiKey = readSecret(SECRET_KEYS.OPENROUTER);
    if (!apiKey) {
        throw new HttpError(400, 'OpenRouter API key is missing. Add "api_key_openrouter" to data/default-user/secrets.json or set OPENROUTER_API_KEY.');
    }
    return apiKey;
}

export async function listModels() {
    // The model list is public; no key needed.
    const response = await fetch(`${API_OPENROUTER}/models`, { headers: OPENROUTER_HEADERS });
    if (!response.ok) {
        throw new HttpError(response.status, `OpenRouter model list failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return (data?.data ?? [])
        .map(m => ({ id: m.id, name: m.name || m.id }))
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
        reasoning: { exclude: false },
    };
    if (Number(body.max_tokens) > 0) {
        requestBody.max_tokens = Number(body.max_tokens);
    }
    if (Array.isArray(body.stop) && body.stop.length) {
        requestBody.stop = body.stop;
    }

    const response = await fetch(`${API_OPENROUTER}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
            ...OPENROUTER_HEADERS,
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const text = await response.text();
        let message = text;
        try {
            message = JSON.parse(text)?.error?.message ?? text;
        } catch {
            // Not JSON; use the raw text.
        }
        throw new HttpError(response.status, `OpenRouter error ${response.status}: ${message}`);
    }

    if (requestBody.stream) {
        return forwardFetchResponse(response, res);
    }
    return res.json(await response.json());
}
