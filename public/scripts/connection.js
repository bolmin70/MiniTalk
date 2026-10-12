// API provider + model selection.

import { getRequestHeaders } from './requests.js';

export const SOURCES = [
    { id: 'claude', name: 'Claude API' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'openrouter', name: 'OpenRouter' },
];

// Remembers the last provider and the last model per provider (per browser).
const STORAGE_KEY = 'MiniTalk_connection';

const sourceSelect = /** @type {HTMLSelectElement} */ (document.getElementById('chat_completion_source'));
const modelSelect = /** @type {HTMLSelectElement} */ (document.getElementById('model_select'));
const refreshButton = /** @type {HTMLButtonElement} */ (document.getElementById('refresh_models'));
const statusDots = document.querySelectorAll('[data-connection-status]');
const statusText = document.getElementById('connection_status_text');
const panelToggle = document.getElementById('control_panel_toggle');

const state = {
    source: SOURCES[0].id,
    /** @type {Record<string, string>} */
    models: {},
    ready: false,
    error: '',
};

let loadToken = 0;

function loadSaved() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        if (SOURCES.some(s => s.id === saved.source)) state.source = saved.source;
        if (saved.models && typeof saved.models === 'object') state.models = saved.models;
    } catch {
        // Storage unavailable or corrupt; use defaults.
    }
}

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ source: state.source, models: state.models }));
    } catch {
        // Not critical.
    }
}

/**
 * @param {'idle'|'loading'|'ready'|'error'} status
 * @param {string} [message]
 */
function setStatus(status, message = '') {
    state.ready = status === 'ready';
    state.error = status === 'error' ? message : '';
    const text = message || { idle: '', loading: 'Loading models…', ready: 'Ready', error: 'Error' }[status];
    for (const dot of statusDots) {
        /** @type {HTMLElement} */ (dot).dataset.state = status;
    }
    statusText.textContent = text;
    statusText.dataset.state = status;
    refreshButton.disabled = status === 'loading';
    updateSummary();
    notifyChange();
}

/**
 * Fires 'change' whenever the provider, model or connection status changes.
 * `event.detail` is the same object getConnection() returns.
 */
export const connectionEvents = new EventTarget();

function notifyChange() {
    connectionEvents.dispatchEvent(new CustomEvent('change', { detail: getConnection() }));
}

/** Connection summary in the panel toggle's tooltip: provider · model, or what's wrong. */
function updateSummary() {
    const sourceName = SOURCES.find(s => s.id === state.source)?.name ?? state.source;
    const modelName = modelSelect.selectedOptions[0]?.textContent ?? '';
    let summary = sourceName;
    if (state.ready && modelName) summary += ` · ${modelName}`;
    else if (state.error) summary += ` · not connected: ${state.error}`;
    else summary += ' · loading…';
    panelToggle.title = `Control panel: ${summary}`;
}

/** @param {string} label */
function setPlaceholder(label) {
    modelSelect.replaceChildren(new Option(label, ''));
    modelSelect.disabled = true;
}

async function loadModels() {
    const token = ++loadToken;
    const source = state.source;
    setStatus('loading');
    setPlaceholder('Loading models…');

    let error = '';
    let models = [];
    try {
        const response = await fetch('/api/backends/chat-completions/status', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ chat_completion_source: source }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
        models = data.data ?? [];
    } catch (err) {
        error = err.message;
    }

    if (token !== loadToken) return; // the provider changed while loading

    if (error || models.length === 0) {
        setPlaceholder('No models available');
        setStatus('error', error || 'No models returned.');
        return;
    }

    modelSelect.replaceChildren(...models.map(m => new Option(m.name, m.id)));
    modelSelect.disabled = false;
    const remembered = state.models[source];
    modelSelect.value = models.some(m => m.id === remembered) ? remembered : models[0].id;
    state.models[source] = modelSelect.value;
    save();
    setStatus('ready', `${SOURCES.find(s => s.id === source)?.name}: ready`);
}

export function initConnection() {
    loadSaved();
    sourceSelect.replaceChildren(...SOURCES.map(s => new Option(s.name, s.id)));
    sourceSelect.value = state.source;

    sourceSelect.addEventListener('change', () => {
        state.source = sourceSelect.value;
        save();
        loadModels();
    });
    modelSelect.addEventListener('change', () => {
        state.models[state.source] = modelSelect.value;
        save();
        updateSummary();
        notifyChange();
    });
    refreshButton.addEventListener('click', () => loadModels());

    return loadModels();
}

/**
 * The current provider and model, and whether they are usable.
 */
export function getConnection() {
    return {
        source: state.source,
        model: state.models[state.source] ?? '',
        ready: state.ready,
        error: state.error,
    };
}
