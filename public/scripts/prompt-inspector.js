// "Inspect prompt": shows the exact request body that Send would post.

import { SOURCES } from './connection.js';
import { showPopup } from './popup.js';
import { describeTokenizer, formatTokenCount, getTokenCountsAsync } from './tokenizers.js';
import { copyText } from './utils.js';

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 */
function element(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

/** @param {any} content OpenAI message content */
function contentToText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => part?.type === 'text' ? part.text : `[${part?.type ?? 'unknown'}]`).join('\n');
    }
    return String(content ?? '');
}

/**
 * @param {object} request The /generate request body
 * @param {{ pendingIndex: number, promptLabels?: Record<number, string>, inputIsCommand?: boolean }} info
 *   Position of the message taken from the input box (or -1), a label for each
 *   injected prompt by position, and whether the input box holds a slash command instead
 */
export function inspectPrompt(request, { pendingIndex, promptLabels = {}, inputIsCommand = false }) {
    const container = element('div', 'prompt-inspector');

    const sourceName = SOURCES.find(s => s.id === request.chat_completion_source)?.name ?? request.chat_completion_source;
    const texts = request.messages.map(m => contentToText(m.content));
    const totalTokens = element('span', 'prompt-total-tokens', '… tokens');
    totalTokens.title = describeTokenizer(request.model);
    const summaryLine = element('div', 'prompt-summary',
        `${sourceName} · ${request.model || 'no model selected'} · ${request.messages.length} messages · `);
    summaryLine.append(totalTokens);
    container.append(
        summaryLine,
        element('div', 'prompt-note', inputIsCommand
            ? 'The input box holds a slash command, which Send runs instead of messaging the model, so this is the chat as it stands.'
            : pendingIndex === -1
                ? 'The input box is empty, so this is the chat as it stands. Anything you type there is added as a new user message.'
                : 'Includes the text currently in the input box as a new user message.'),
    );

    const messageTokens = request.messages.map((message, index) => {
        const item = element('div', 'prompt-message');
        item.dataset.role = message.role;
        const header = element('div', 'prompt-message-header');
        header.append(element('span', 'prompt-role', message.role));
        if (index === pendingIndex) {
            header.append(element('span', 'prompt-tag', 'from input box'));
        } else if (Object.hasOwn(promptLabels, index)) {
            header.append(element('span', 'prompt-tag', `prompt: ${promptLabels[index]}`));
        }
        const tokens = element('span', 'prompt-tokens', '…');
        header.append(tokens);
        item.append(header, element('div', 'prompt-content', texts[index]));
        container.append(item);
        return tokens;
    });

    // Counted after the popup opens so it shows instantly; one request for all messages.
    getTokenCountsAsync(texts, request.model).then((counts) => {
        counts.forEach((count, i) => messageTokens[i].textContent = formatTokenCount(count));
        const total = counts.reduce((sum, count) => sum + count, 0);
        totalTokens.textContent = formatTokenCount(total);
    }).catch((err) => {
        const totalChars = texts.reduce((sum, text) => sum + text.length, 0);
        texts.forEach((text, i) => messageTokens[i].textContent = `${text.length.toLocaleString()} characters`);
        totalTokens.textContent = `${totalChars.toLocaleString()} characters`;
        totalTokens.title = `Token count unavailable: ${err.message}`;
    });

    const json = JSON.stringify(request, null, 2);
    const raw = element('details', 'prompt-raw');
    const summary = element('summary', '', 'Raw request body');
    const copyButton = element('button', 'menu_button prompt-copy', 'Copy JSON');
    copyButton.type = 'button';
    // Feedback goes on the button: toasts render underneath a modal dialog.
    copyButton.addEventListener('click', async () => {
        try {
            await copyText(json);
            copyButton.textContent = 'Copied!';
        } catch {
            copyButton.textContent = 'Copy failed';
        }
        setTimeout(() => copyButton.textContent = 'Copy JSON', 2000);
    });
    raw.append(
        summary,
        element('div', 'prompt-note', 'Sent to the server as-is; the server adapts it to each provider’s format.'),
        copyButton,
        element('pre', 'prompt-json', json),
    );
    container.append(raw);

    return showPopup({ title: 'Prompt inspector', content: container, wide: true });
}
