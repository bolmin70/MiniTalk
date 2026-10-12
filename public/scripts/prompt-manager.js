// Prompt manager (the Prompt tab): a list of prompts, each injected into the
// request as a user message at its depth (0 = after the last chat message,
// 1 = before the last message, …). Prompts at the same depth are sent in list
// order. The list itself (collapse, drag, edit) is prompt-list.js.

import { assistant } from './assistant.js';
import { createPromptList, makePromptItem, restorePromptItems } from './prompt-list.js';
import { describeTokenizer, formatTokenCount } from './tokenizers.js';

// Saved per browser.
const STORAGE_KEY = 'MiniTalk_prompts';
// The single system prompt saved by earlier versions; becomes the first prompt.
const LEGACY_STORAGE_KEY = 'MiniTalk_system_prompt';

const total = document.getElementById('prompt_total');

/** @type {ReturnType<typeof createPromptList>} */
let promptList;

/** @returns {import('./prompt-list.js').PromptItem[]} */
function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        if (Array.isArray(saved)) return restorePromptItems(saved);
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy !== null) return [makePromptItem({ name: 'System prompt', content: legacy })];
    } catch {
        // Storage unavailable or corrupt; use the default.
    }
    return [makePromptItem({ name: 'System prompt', content: assistant.system_prompt })];
}

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(promptList.items));
    } catch {
        // Not critical; the prompts still apply for this session.
    }
}

/**
 * The enabled, non-empty prompts in list order, for building the request.
 * @returns {{ id: string, name: string, content: string, depth: number }[]}
 */
export function getPromptInjections() {
    return (promptList?.items ?? [])
        .filter(p => p.enabled && p.content.trim())
        .map(({ id, name, content, depth }) => ({ id, name, content: content.trim(), depth }));
}

/**
 * Inserts prompts into chat messages by depth. Depth d goes before the last d
 * messages (deeper than the chat → at the very start); prompts sharing a
 * depth keep their order.
 * @template T
 * @param {T[]} messages
 * @param {{ depth: number }[]} injections
 * @param {(injection: any) => T} toMessage
 * @returns {{ messages: T[], positions: Map<number, any> }} Combined list, and which injection sits at each inserted index
 */
export function injectAtDepth(messages, injections, toMessage) {
    const count = messages.length;
    /** @type {Map<number, any[]>} */
    const byPosition = new Map();
    for (const injection of injections) {
        const at = Math.max(0, count - injection.depth);
        if (!byPosition.has(at)) byPosition.set(at, []);
        byPosition.get(at).push(injection);
    }
    const result = [];
    const positions = new Map();
    for (let i = 0; i <= count; i++) {
        for (const injection of byPosition.get(i) ?? []) {
            positions.set(result.length, injection);
            result.push(toMessage(injection));
        }
        if (i < count) result.push(messages[i]);
    }
    return { messages: result, positions };
}

/** @param {{ items: import('./prompt-list.js').PromptItem[], counts: number[]|null, error?: Error }} summary */
function showTotal({ items, counts, error }) {
    if (!counts) {
        total.textContent = 'Token count unavailable';
        total.title = error?.message ?? '';
        return;
    }
    const sum = items.reduce((acc, p, i) => acc + (p.enabled ? counts[i] : 0), 0);
    const active = items.filter(p => p.enabled && p.content.trim()).length;
    total.textContent = `${active} of ${items.length} prompts sent · ${formatTokenCount(sum)}`;
    total.title = describeTokenizer();
}

export function initPromptManager() {
    promptList = createPromptList({
        list: document.getElementById('prompt_list'),
        page: document.getElementById('panel_prompt'),
        noun: 'prompt',
        onChange: save,
        onCounts: showTotal,
    });
    promptList.setItems(load());
    document.getElementById('prompt_add').addEventListener('click', () => promptList.addItem());
}
