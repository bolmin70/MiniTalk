// ──────────────────────────────────────────────
// Claude API provider (Anthropic Messages API, API-key billing)
// ──────────────────────────────────────────────
//
// Wire behaviour matches SillyTavern's `claude` source so V2 extensions that
// observe /api/backends/chat-completions/generate keep working:
//   • stream: the raw Anthropic SSE stream is piped through unchanged
//     (message_start / content_block_delta / message_delta …).
//   • non-stream: { choices: [{ message: { content } }], content, usage }.

import Anthropic from '@anthropic-ai/sdk';

import { readSecret, SECRET_KEYS } from '../secrets.js';
import { HttpError, abortOnClientClose, forwardFetchResponse } from '../util.js';

export const id = 'claude';
export const name = 'Claude API';

const DEFAULT_MAX_TOKENS = 64000;
const DATA_URL_RE = /^data:(image\/[^;]+);base64,(.+)$/;

function getClient() {
    const apiKey = readSecret(SECRET_KEYS.CLAUDE);
    if (!apiKey) {
        throw new HttpError(400, 'Claude API key is missing. Add "api_key_claude" to data/default-user/secrets.json or set ANTHROPIC_API_KEY.');
    }
    return new Anthropic({ apiKey });
}

/**
 * Adaptive thinking exists from the 4.6 generation onwards; Haiku 4.5 and
 * older models predate it.
 * @param {string} model
 */
function supportsAdaptiveThinking(model) {
    return /^claude-(opus-4-[6-9]|sonnet-4-6|opus-[5-9]|sonnet-[5-9]|fable|mythos)/.test(model);
}

/** @param {any} content OpenAI message content */
function textOf(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.filter(p => p?.type === 'text').map(p => p.text).join('\n');
    }
    return '';
}

/** @param {any} content OpenAI message content → Anthropic content */
function convertContent(content) {
    if (!Array.isArray(content)) return textOf(content);
    const blocks = [];
    for (const part of content) {
        if (part?.type === 'text' && part.text) {
            blocks.push({ type: 'text', text: part.text });
        } else if (part?.type === 'image_url') {
            const url = part.image_url?.url ?? '';
            const match = url.match(DATA_URL_RE);
            blocks.push(match
                ? { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
                : { type: 'image', source: { type: 'url', url } });
        }
    }
    return blocks;
}

/**
 * Converts OpenAI-style chat messages to a Messages API system + messages pair.
 * @param {any[]} messages
 */
export function convertMessages(messages) {
    const system = [];
    const converted = [];
    for (const message of messages) {
        if (message?.role === 'system') {
            const text = textOf(message.content);
            if (text) system.push(text);
            continue;
        }
        const content = convertContent(message?.content);
        if (!content || content.length === 0) continue;
        converted.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content });
    }
    // The first turn must come from the user (e.g. when the chat opens with a greeting).
    if (converted[0]?.role !== 'user') {
        converted.unshift({ role: 'user', content: '[Start a new chat]' });
    }
    return { system: system.join('\n\n'), messages: converted };
}

/** @param {any} body ST-style generate request body */
function buildParams(body) {
    const { system, messages } = convertMessages(body.messages);
    const params = {
        model: body.model,
        max_tokens: Number(body.max_tokens) > 0 ? Number(body.max_tokens) : DEFAULT_MAX_TOKENS,
        messages,
        stream: Boolean(body.stream),
        // Automatic prompt caching of the growing conversation prefix.
        cache_control: { type: 'ephemeral' },
    };
    if (system) {
        params.system = system;
    }
    if (Array.isArray(body.stop) && body.stop.length) {
        params.stop_sequences = body.stop.filter(s => typeof s === 'string' && s.length > 0);
    }
    if (supportsAdaptiveThinking(body.model)) {
        // `summarized` so reasoning text is actually returned (newer models default to omitting it).
        params.thinking = { type: 'adaptive', display: 'summarized' };
    }
    return params;
}

export async function listModels() {
    const client = getClient();
    const models = [];
    for await (const model of client.models.list({ limit: 1000 })) {
        models.push({ id: model.id, name: model.display_name || model.id });
    }
    return models;
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function generate(req, res) {
    const client = getClient();
    const params = buildParams(req.body);
    const controller = abortOnClientClose(res);

    try {
        if (params.stream) {
            const response = await client.messages.create(params, { signal: controller.signal }).asResponse();
            return forwardFetchResponse(response, res);
        }

        const message = await client.messages.create(params, { signal: controller.signal });
        const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
        const reasoning = message.content.filter(b => b.type === 'thinking').map(b => b.thinking).join('\n\n');
        const reply = {
            choices: [{ message: { content: text, reasoning_content: reasoning || undefined } }],
            content: message.content,
            usage: message.usage,
            stop_reason: message.stop_reason,
        };
        return res.json(reply);
    } catch (err) {
        if (err instanceof Anthropic.APIError && err.status) {
            throw new HttpError(err.status, `Claude API error ${err.status}: ${err.message}`);
        }
        throw err;
    }
}
