// MiniTalk — main frontend module.
//
// `chat` uses SillyTavern's message shape ({ name, is_user, is_system,
// send_date, mes, extra }) and the DOM uses ST's ids/classes (#chat, .mes,
// .mes_text, #send_textarea, …) so V2-era code can be bridged in later.

import { assistant, user } from './scripts/assistant.js';
import { initSlashCommandAutocomplete } from './scripts/autocomplete.js';
import { getConnection, initConnection } from './scripts/connection.js';
import { formatMessage } from './scripts/formatting.js';
import { confirmPopup } from './scripts/popup.js';
import { inspectPrompt } from './scripts/prompt-inspector.js';
import { getRequestHeaders } from './scripts/requests.js';
import { initSidePanel, openPanel } from './scripts/side-panel.js';
import { executeSlashCommandsWithOptions, initDefaultSlashCommands, isSlashCommand } from './scripts/slash-commands.js';
import { parseStreamPayload, readErrorMessage, readSseStream } from './scripts/streaming.js';
import { getPromptInjections, initPromptManager, injectAtDepth } from './scripts/prompt-manager.js';
import { loadExtensions } from './scripts/extensions.js';
import { showToast } from './scripts/toast.js';
import { copyText } from './scripts/utils.js';

export { getRequestHeaders };

/** @typedef {{ name: string, is_user: boolean, is_system: boolean, send_date: number, mes: string, extra: { reasoning?: string, reasoning_duration?: number, api?: string, model?: string } }} ChatMessage */

/** @type {ChatMessage[]} */
export const chat = [];

const chatElement = document.getElementById('chat');
const sendForm = document.getElementById('send_form');
const textarea = /** @type {HTMLTextAreaElement} */ (document.getElementById('send_textarea'));
const sendButton = document.getElementById('send_but');
const stopButton = document.getElementById('mes_stop');

/** @type {AbortController|null} */
let abortController = null;

export function isGenerating() {
    return abortController !== null;
}

/**
 * @param {Partial<ChatMessage> & { name: string, mes: string }} fields
 * @returns {ChatMessage}
 */
function createMessage(fields) {
    return { is_user: false, is_system: false, send_date: Date.now(), extra: {}, ...fields };
}

/** @param {number} mesId */
function getMessageElement(mesId) {
    return chatElement.querySelector(`.mes[mesid="${mesId}"]`);
}

/** Keeps the view pinned to the bottom unless the user has scrolled up. */
function isNearBottom() {
    return chatElement.scrollHeight - chatElement.scrollTop - chatElement.clientHeight < 80;
}

function scrollToBottom() {
    chatElement.scrollTop = chatElement.scrollHeight;
}

/** @param {number} timestamp */
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Renders (or re-renders) one message's content.
 * @param {number} mesId
 */
function updateMessageElement(mesId) {
    const message = chat[mesId];
    const element = getMessageElement(mesId);
    if (!message || !element) return;

    element.querySelector('.mes_text').innerHTML = formatMessage(message.mes);

    const details = /** @type {HTMLDetailsElement} */ (element.querySelector('.mes_reasoning_details'));
    const reasoning = message.extra.reasoning ?? '';
    details.hidden = !reasoning;
    element.querySelector('.mes_reasoning').textContent = reasoning;
    const duration = message.extra.reasoning_duration;
    element.querySelector('.mes_reasoning_summary').textContent = duration === undefined
        ? 'Thinking…'
        : `Thought for ${duration < 1 ? 'a moment' : `${Math.round(duration)} second${Math.round(duration) === 1 ? '' : 's'}`}`;
}

/**
 * Appends a message to the chat and the DOM.
 * @param {ChatMessage} message
 * @returns {number} The message id (index in `chat`)
 */
function addMessage(message) {
    const mesId = chat.push(message) - 1;
    const stickToBottom = isNearBottom();

    const element = document.createElement('div');
    element.className = 'mes';
    element.setAttribute('mesid', String(mesId));
    element.setAttribute('ch_name', message.name);
    element.setAttribute('is_user', String(message.is_user));
    element.setAttribute('is_system', String(message.is_system));
    element.innerHTML = `
        <div class="mesAvatarWrapper"><div class="avatar"></div></div>
        <div class="mes_block">
            <div class="ch_name">
                <span class="name_text"></span><small class="timestamp"></small>
                <div class="mes_buttons">
                    <button type="button" class="mes_button mes_copy fa-solid fa-copy" title="Copy" aria-label="Copy message"></button>
                    <button type="button" class="mes_button mes_edit fa-solid fa-pencil" title="Edit" aria-label="Edit message"></button>
                </div>
                <div class="mes_edit_buttons">
                    <button type="button" class="mes_button mes_edit_done fa-solid fa-check" title="Save (Ctrl+Enter)" aria-label="Save edit"></button>
                    <button type="button" class="mes_button mes_edit_cancel fa-solid fa-xmark" title="Cancel (Esc)" aria-label="Cancel edit"></button>
                </div>
                <input type="checkbox" class="del_checkbox" tabindex="-1" aria-label="Selected for deletion">
            </div>
            <details class="mes_reasoning_details" hidden>
                <summary class="mes_reasoning_summary"></summary>
                <div class="mes_reasoning"></div>
            </details>
            <div class="mes_text"></div>
        </div>`;
    element.querySelector('.avatar').textContent = message.name.charAt(0).toUpperCase();
    element.querySelector('.name_text').textContent = message.name;
    element.querySelector('.timestamp').textContent = formatTime(message.send_date);
    chatElement.append(element);

    updateMessageElement(mesId);
    if (stickToBottom || message.is_user) scrollToBottom();
    return mesId;
}

/** @param {number} mesId */
function removeMessage(mesId) {
    getMessageElement(mesId)?.remove();
    chat.splice(mesId, 1);
}

/**
 * Builds the /generate request body: the chat as an OpenAI-style prompt,
 * which the server converts per provider. Send and the prompt inspector both
 * use this, so what you inspect is exactly what gets sent.
 * The prompts (the Prompt tab) go in as user messages at their depths; the
 * pending text counts as the newest chat message.
 * @param {string} [pendingText] Not-yet-sent user text to append (the input box)
 * @returns {{ request: { chat_completion_source: string, model: string, messages: { role: string, content: string }[], stream: boolean }, pendingIndex: number, promptLabels: Record<number, string> }}
 *   The request, the position of the pending text (-1 if none), and a label for each injected prompt by position
 */
function buildGenerateRequest(pendingText = '') {
    const { source, model } = getConnection();
    const chatMessages = [];
    for (const message of chat) {
        if (message.is_system || !message.mes) continue;
        chatMessages.push({ role: message.is_user ? 'user' : 'assistant', content: message.mes });
    }
    /** @type {{ role: string, content: string }|null} */
    const pending = pendingText ? { role: 'user', content: pendingText } : null;
    if (pending) chatMessages.push(pending);

    const { messages, positions } = injectAtDepth(chatMessages, getPromptInjections(), p => ({ role: 'user', content: p.content }));
    /** @type {Record<number, string>} */
    const promptLabels = {};
    for (const [index, prompt] of positions) {
        promptLabels[index] = `${prompt.name.trim() || 'Untitled prompt'} · depth ${prompt.depth}`;
    }
    return {
        request: { chat_completion_source: source, model, messages, stream: true },
        pendingIndex: pending ? messages.indexOf(pending) : -1,
        promptLabels,
    };
}

/** @param {boolean} generating */
function setGeneratingUi(generating) {
    sendButton.hidden = generating;
    stopButton.hidden = !generating;
}

/** Generates the assistant's reply to the current chat. */
async function generate() {
    const { request } = buildGenerateRequest();
    const startedAt = Date.now();
    const message = createMessage({ name: assistant.name, mes: '', extra: { api: request.chat_completion_source, model: request.model } });
    const mesId = addMessage(message);
    const element = getMessageElement(mesId);
    element.classList.add('generating');

    abortController = new AbortController();
    setGeneratingUi(true);

    let renderQueued = false;
    const queueRender = () => {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            const stick = isNearBottom();
            updateMessageElement(mesId);
            if (stick) scrollToBottom();
        });
    };

    let stopReason = '';
    try {
        const response = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(request),
            signal: abortController.signal,
        });
        if (!response.ok) {
            throw new Error(await readErrorMessage(response));
        }

        for await (const payload of readSseStream(response)) {
            const delta = parseStreamPayload(payload);
            if (delta.error) throw new Error(delta.error);
            if (delta.stopReason) stopReason = delta.stopReason;
            if (delta.reasoning) {
                message.extra.reasoning = (message.extra.reasoning ?? '') + delta.reasoning;
            }
            if (delta.text) {
                if (message.extra.reasoning && message.extra.reasoning_duration === undefined) {
                    message.extra.reasoning_duration = (Date.now() - startedAt) / 1000;
                }
                message.mes += delta.text;
            }
            queueRender();
        }

        if (stopReason === 'refusal') {
            showToast('The model declined to respond to this request.', 'warning');
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Generation failed:', err);
            showToast(err.message || 'Generation failed.', 'error', 10000);
        }
    } finally {
        abortController = null;
        setGeneratingUi(false);
        element.classList.remove('generating');
        // Skip if the chat was cleared mid-generation.
        if (chat[mesId] === message) {
            finalizeMessage(mesId, startedAt);
        }
    }
}

/**
 * @param {number} mesId
 * @param {number} startedAt
 */
function finalizeMessage(mesId, startedAt) {
    const message = chat[mesId];
    if (message.extra.reasoning && message.extra.reasoning_duration === undefined) {
        message.extra.reasoning_duration = (Date.now() - startedAt) / 1000;
    }
    message.mes = message.mes.trim();
    if (!message.mes && !message.extra.reasoning) {
        removeMessage(mesId);
    } else {
        updateMessageElement(mesId);
    }
}

function stopGeneration() {
    abortController?.abort();
}

async function sendMessage() {
    const text = textarea.value.trim();
    if (!text) return;

    if (isSlashCommand(text)) {
        await runCommandsFromInput(text);
        return;
    }
    if (isGenerating()) return;

    const connection = getConnection();
    if (!connection.ready) {
        showToast(connection.error || 'Pick a provider and model first.', 'warning');
        openPanel('api');
        return;
    }

    textarea.value = '';
    autoResize(textarea);
    addMessage(createMessage({ name: user.name, is_user: true, mes: text }));
    await generate();
}

/**
 * Runs slash commands typed into the input box. The input is cleared on
 * success and kept on error so the command can be fixed.
 * @param {string} text
 */
async function runCommandsFromInput(text) {
    const result = await executeSlashCommandsWithOptions(text, { handleParserErrors: true, handleExecutionErrors: true });
    if (!result.isError && textarea.value.trim() === text) {
        textarea.value = '';
        autoResize(textarea);
    }
}

function newChat() {
    if (isGenerating()) stopGeneration();
    exitDeleteMode();
    chat.length = 0;
    chatElement.replaceChildren();
    if (assistant.first_mes) {
        addMessage(createMessage({ name: assistant.name, mes: assistant.first_mes }));
    }
    textarea.focus();
}

/** Menu action. Chats aren't saved yet, so confirm before throwing one away. */
async function startNewChat() {
    if (chat.some(message => message.is_user)) {
        const confirmed = await confirmPopup('Start new chat?', 'The current conversation will be lost.', 'Start new chat');
        if (!confirmed) return;
    }
    newChat();
}

/** @param {HTMLTextAreaElement} element */
function autoResize(element) {
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
}

// ── Message buttons: copy / edit ─────────────

/** @param {number} mesId */
async function copyMessage(mesId) {
    try {
        await copyText(chat[mesId].mes);
        showToast('Message copied.', 'info', 2000);
    } catch (err) {
        showToast(err.message || 'Could not copy the message.', 'error');
    }
}

/** @param {number} mesId */
function startEdit(mesId) {
    const element = getMessageElement(mesId);
    if (!element || element.classList.contains('editing')) return;

    const editor = document.createElement('textarea');
    editor.className = 'edit_textarea';
    editor.rows = 1; // autoResize grows it to fit the content
    editor.value = chat[mesId].mes;
    editor.setAttribute('aria-label', 'Edit message');
    editor.addEventListener('input', () => autoResize(editor));
    editor.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation(); // don't also trigger the page-level Esc handling
            finishEdit(mesId, false);
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            finishEdit(mesId, true);
        }
    });

    element.querySelector('.mes_text').after(editor);
    element.classList.add('editing');
    autoResize(editor);
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
}

/**
 * @param {number} mesId
 * @param {boolean} save Keep the edited text (otherwise discard it)
 */
function finishEdit(mesId, save) {
    const element = getMessageElement(mesId);
    const editor = /** @type {HTMLTextAreaElement|null} */ (element?.querySelector('.edit_textarea'));
    if (!editor) return;
    if (save) {
        chat[mesId].mes = editor.value.trim();
    }
    editor.remove();
    element.classList.remove('editing');
    updateMessageElement(mesId);
}

function cancelAllEdits() {
    for (const element of chatElement.querySelectorAll('.mes.editing')) {
        finishEdit(Number(element.getAttribute('mesid')), false);
    }
}

/** @type {Record<string, (mesId: number) => void>} */
const messageButtonActions = {
    mes_copy: copyMessage,
    mes_edit: startEdit,
    mes_edit_done: mesId => finishEdit(mesId, true),
    mes_edit_cancel: mesId => finishEdit(mesId, false),
};

chatElement.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('.mes_button');
    if (!button || isDeleteMode()) return;
    const mesId = Number(button.closest('.mes').getAttribute('mesid'));
    const action = Object.keys(messageButtonActions).find(name => button.classList.contains(name));
    messageButtonActions[action]?.(mesId);
});

// ── Delete messages ──────────────────────────
// As in SillyTavern: clicking a message selects it and everything after it.

const deleteBar = document.getElementById('dialogue_del_mes');
const deleteHint = document.getElementById('dialogue_del_mes_hint');
const deleteConfirmButton = /** @type {HTMLButtonElement} */ (document.getElementById('dialogue_del_mes_ok'));

/** @type {number|null} First selected message, or null when nothing is selected. */
let deleteFrom = null;

function isDeleteMode() {
    return document.body.classList.contains('delete-mode');
}

/** @param {number|null} mesId */
function setDeleteFrom(mesId) {
    deleteFrom = mesId;
    for (const element of chatElement.querySelectorAll('.mes')) {
        const selected = mesId !== null && Number(element.getAttribute('mesid')) >= mesId;
        element.classList.toggle('selected', selected);
        /** @type {HTMLInputElement} */ (element.querySelector('.del_checkbox')).checked = selected;
    }
    const count = mesId === null ? 0 : chat.length - mesId;
    deleteConfirmButton.disabled = count === 0;
    deleteConfirmButton.textContent = count ? `Delete ${count}` : 'Delete';
    deleteHint.textContent = count
        ? `${count} message${count === 1 ? '' : 's'} selected`
        : 'Click a message to delete it and everything after it.';
}

function enterDeleteMode() {
    if (isGenerating()) {
        showToast('Wait for the reply to finish (or stop it) first.', 'warning');
        return;
    }
    if (chat.length === 0) {
        showToast('There are no messages to delete.', 'info');
        return;
    }
    cancelAllEdits();
    document.body.classList.add('delete-mode');
    sendForm.hidden = true;
    deleteBar.hidden = false;
    setDeleteFrom(null);
}

function exitDeleteMode() {
    if (!isDeleteMode()) return;
    setDeleteFrom(null);
    document.body.classList.remove('delete-mode');
    deleteBar.hidden = true;
    sendForm.hidden = false;
}

function deleteSelectedMessages() {
    if (deleteFrom === null) return;
    for (const element of chatElement.querySelectorAll('.mes')) {
        if (Number(element.getAttribute('mesid')) >= deleteFrom) element.remove();
    }
    chat.splice(deleteFrom);
    exitDeleteMode();
    textarea.focus();
}

chatElement.addEventListener('click', (event) => {
    if (!isDeleteMode()) return;
    const element = /** @type {HTMLElement} */ (event.target).closest('.mes');
    if (!element) return;
    event.preventDefault(); // e.g. don't toggle the reasoning block
    const mesId = Number(element.getAttribute('mesid'));
    setDeleteFrom(mesId === deleteFrom ? null : mesId);
});
deleteConfirmButton.addEventListener('click', deleteSelectedMessages);
document.getElementById('dialogue_del_mes_cancel').addEventListener('click', exitDeleteMode);

// ── Options menu ─────────────────────────────

const optionsButton = document.getElementById('options_button');
const optionsMenu = document.getElementById('options');

/** @param {boolean} open */
function setOptionsOpen(open) {
    optionsMenu.hidden = !open;
    optionsButton.setAttribute('aria-expanded', String(open));
}

optionsButton.addEventListener('click', () => setOptionsOpen(optionsMenu.hidden));
document.addEventListener('click', (event) => {
    const target = /** @type {Node} */ (event.target);
    if (!optionsMenu.hidden && !optionsMenu.contains(target) && !optionsButton.contains(target)) {
        setOptionsOpen(false);
    }
});

/** @type {Record<string, () => void>} */
const optionActions = {
    option_start_new_chat: startNewChat,
    option_delete_mes: enterDeleteMode,
    option_inspect_prompt: () => {
        // A slash command in the input box is run on Send, not sent to the model.
        const inputText = textarea.value.trim();
        const isCommand = isSlashCommand(inputText);
        const pendingText = isCommand ? '' : inputText;
        const { request, pendingIndex, promptLabels } = buildGenerateRequest(pendingText);
        inspectPrompt(request, { pendingIndex, promptLabels, inputIsCommand: isCommand });
    },
};
for (const [id, action] of Object.entries(optionActions)) {
    document.getElementById(id).addEventListener('click', () => {
        setOptionsOpen(false);
        action();
    });
}

document.addEventListener('keydown', (event) => {
    // Open popups handle their own Esc.
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (!optionsMenu.hidden) {
        setOptionsOpen(false);
        optionsButton.focus();
    } else if (isDeleteMode()) {
        exitDeleteMode();
    }
});

// ── Send form ────────────────────────────────

sendForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage();
});
stopButton.addEventListener('click', stopGeneration);
textarea.addEventListener('input', () => autoResize(textarea));
// Registered before the Enter handler so it can claim Enter/Tab/arrows while open.
initSlashCommandAutocomplete(textarea, document.getElementById('form_sheld'));
textarea.addEventListener('keydown', (event) => {
    // Enter sends, Shift+Enter inserts a newline (not while composing IME text).
    if (event.defaultPrevented) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendMessage();
    }
});

initSidePanel();
initPromptManager();
initDefaultSlashCommands();
newChat();
initConnection();
// Last, so extensions find the app fully set up.
loadExtensions();
