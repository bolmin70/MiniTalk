// Reading generation streams. Each provider streams in its native format
// (the server passes them through, like SillyTavern does):
//   Claude API  → Anthropic SSE events (content_block_delta, message_delta, …)
//   OpenAI      → OpenAI chunks
//   OpenRouter  → OpenAI chunks, thinking in delta.reasoning

/**
 * Yields each JSON payload from a server-sent events response.
 * @param {Response} response
 * @returns {AsyncGenerator<any>}
 */
export async function* readSseStream(response) {
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const event of events) {
            const data = event
                .split(/\r?\n/)
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trimStart())
                .join('\n');
            if (!data) continue; // comments / keep-alives
            if (data === '[DONE]') return;
            try {
                yield JSON.parse(data);
            } catch {
                console.warn('Unparseable stream event:', data);
            }
        }
    }
}

/**
 * Normalises one stream payload from any provider.
 * @param {any} payload
 * @returns {{ text: string, reasoning: string, error?: string, stopReason?: string }}
 */
export function parseStreamPayload(payload) {
    const result = { text: '', reasoning: '' };

    if (payload?.error) {
        result.error = payload.error.message ?? String(payload.error);
        return result;
    }

    // Anthropic Messages API events
    if (typeof payload?.type === 'string') {
        if (payload.type === 'content_block_delta') {
            if (payload.delta?.type === 'text_delta') result.text = payload.delta.text ?? '';
            if (payload.delta?.type === 'thinking_delta') result.reasoning = payload.delta.thinking ?? '';
        } else if (payload.type === 'message_delta' && payload.delta?.stop_reason) {
            result.stopReason = payload.delta.stop_reason;
        }
        return result;
    }

    // OpenAI-style chunks
    const choice = payload?.choices?.[0];
    result.text = choice?.delta?.content ?? '';
    result.reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? '';
    if (choice?.finish_reason) result.stopReason = choice.finish_reason;
    return result;
}

/**
 * Extracts a readable error message from a failed response.
 * @param {Response} response
 */
export async function readErrorMessage(response) {
    const text = await response.text();
    try {
        const json = JSON.parse(text);
        return json?.error?.message ?? (typeof json?.error === 'string' ? json.error : text);
    } catch {
        return text || `${response.status} ${response.statusText}`;
    }
}
