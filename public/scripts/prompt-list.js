// A list of collapsible prompt-like items (the Prompt tab).
// Each item has a name, depth, text and an on/off switch. Items reorder by
// dragging the handle (or ↑/↓ on it), and can be added, removed and edited.
// The caller owns storage: it gets onChange() after every edit.

import { connectionEvents } from './connection.js';
import { confirmPopup } from './popup.js';
import { formatTokenCount, getTokenCountsAsync } from './tokenizers.js';
import { autoSize, makeResizable } from './resizable-textarea.js';

/**
 * @typedef {{ id: string, name: string, content: string, depth: number, enabled: boolean, collapsed: boolean }} PromptItem
 */

// Wait this long after typing stops before counting tokens.
const COUNT_DELAY_MS = 300;

/** crypto.randomUUID needs a secure context, which plain-http LAN access isn't. */
export function newId() {
    return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** @param {any} value */
export function normalizeDepth(value) {
    const depth = Math.floor(Number(value));
    return Number.isFinite(depth) && depth >= 0 ? depth : 0;
}

/**
 * @param {Partial<PromptItem>} fields
 * @param {string} [noun]
 * @returns {PromptItem}
 */
export function makePromptItem(fields = {}, noun = 'prompt') {
    return { id: newId(), name: `New ${noun}`, content: '', depth: 0, enabled: true, collapsed: false, ...fields };
}

/**
 * Rebuilds saved items, dropping anything malformed.
 * @param {any} saved
 * @returns {PromptItem[]}
 */
export function restorePromptItems(saved) {
    if (!Array.isArray(saved)) return [];
    return saved
        .filter(p => p && typeof p === 'object')
        .map(p => makePromptItem({
            id: typeof p.id === 'string' ? p.id : newId(),
            name: String(p.name ?? ''),
            content: String(p.content ?? ''),
            depth: normalizeDepth(p.depth),
            enabled: p.enabled !== false,
            collapsed: p.collapsed === true,
        }));
}

/**
 * @typedef {object} PromptListOptions
 * @property {HTMLElement} list The <ol> to render into
 * @property {HTMLElement} page The scrolling page holding the list (scrolled while dragging)
 * @property {string} [noun] What an item is called in labels ('prompt', 'entry')
 * @property {() => void} [onChange] After any edit, add, removal or reorder
 * @property {(summary: { items: PromptItem[], counts: number[]|null, error?: Error }) => void} [onCounts]
 *   After token counts update; counts is null when counting failed
 */

/**
 * @param {PromptListOptions} options
 */
export function createPromptList({ list, page, noun = 'prompt', onChange = () => {}, onCounts = () => {} }) {
    /** @type {PromptItem[]} */
    let items = [];
    const untitled = `Untitled ${noun}`;
    const nameOf = (/** @type {PromptItem} */ item) => item.name.trim() || untitled;

    const changed = () => onChange();

    /** @param {PromptItem} prompt */
    function renderItem(prompt) {
        const item = document.createElement('li');
        item.className = 'prompt-item';
        item.dataset.id = prompt.id;
        item.innerHTML = `
            <div class="prompt-item-header">
                <button type="button" class="prompt-drag fa-solid fa-grip-vertical" title="Drag to reorder (or focus and press ↑/↓)" aria-label="Reorder"></button>
                <button type="button" class="prompt-toggle"><i class="fa-solid fa-chevron-right"></i><span class="prompt-item-name"></span></button>
                <span class="prompt-depth-badge"></span>
                <span class="prompt-item-tokens"></span>
                <label class="prompt-enabled-label"><input type="checkbox" class="prompt-enabled"></label>
                <button type="button" class="prompt-delete fa-solid fa-trash-can"></button>
            </div>
            <div class="prompt-item-body">
                <div class="prompt-fields">
                    <label>Name <input type="text" class="prompt-name" autocomplete="off"></label>
                    <label>Depth <input type="number" class="prompt-depth" min="0" step="1" inputmode="numeric"></label>
                </div>
                <textarea class="prompt-content" spellcheck="true"></textarea>
            </div>`;

        const q = (/** @type {string} */ selector) => /** @type {any} */ (item.querySelector(selector));
        const toggle = q('.prompt-toggle');
        const body = q('.prompt-item-body');
        const nameInput = q('.prompt-name');
        const depthInput = q('.prompt-depth');
        const content = q('.prompt-content');
        const enabled = q('.prompt-enabled');
        const remove = q('.prompt-delete');
        makeResizable(content);

        q('.prompt-enabled-label').title = `Use this ${noun}`;
        remove.title = `Remove ${noun}`;
        remove.setAttribute('aria-label', `Remove ${noun}`);
        content.setAttribute('aria-label', `${noun[0].toUpperCase()}${noun.slice(1)} text`);

        const refreshHeader = () => {
            q('.prompt-item-name').textContent = nameOf(prompt);
            q('.prompt-depth-badge').textContent = `depth ${prompt.depth}`;
            item.classList.toggle('disabled', !prompt.enabled);
            toggle.setAttribute('aria-expanded', String(!prompt.collapsed));
            body.hidden = prompt.collapsed;
            enabled.setAttribute('aria-label', `Use "${nameOf(prompt)}"`);
        };

        nameInput.value = prompt.name;
        depthInput.value = String(prompt.depth);
        content.value = prompt.content;
        enabled.checked = prompt.enabled;
        refreshHeader();

        toggle.addEventListener('click', () => {
            prompt.collapsed = !prompt.collapsed;
            refreshHeader();
            if (!prompt.collapsed) autoSize(content);
            changed();
        });
        nameInput.addEventListener('input', () => {
            prompt.name = nameInput.value;
            refreshHeader();
            changed();
        });
        depthInput.addEventListener('input', () => {
            if (depthInput.value === '') return; // mid-edit; keep the old depth
            prompt.depth = normalizeDepth(depthInput.value);
            refreshHeader();
            changed();
        });
        depthInput.addEventListener('change', () => {
            prompt.depth = normalizeDepth(depthInput.value);
            depthInput.value = String(prompt.depth);
            refreshHeader();
            changed();
        });
        content.addEventListener('input', () => {
            prompt.content = content.value;
            autoSize(content);
            changed();
            scheduleCount();
        });
        enabled.addEventListener('change', () => {
            prompt.enabled = enabled.checked;
            refreshHeader();
            changed();
            scheduleCount();
        });
        remove.addEventListener('click', () => removeItem(prompt));
        setUpReorder(item, q('.prompt-drag'));
        return item;
    }

    /** Textareas can only measure themselves while visible. */
    function sizeVisibleEditors() {
        if (list.closest('[hidden]')) return;
        list.querySelectorAll('.prompt-item-body:not([hidden]) .prompt-content').forEach(autoSize);
    }

    /**
     * Shows these items. The array is edited in place from then on.
     * @param {PromptItem[]} next
     */
    function setItems(next) {
        items = next;
        list.replaceChildren(...items.map(renderItem));
        sizeVisibleEditors();
        scheduleCount();
    }

    /** Appends a new, expanded item and focuses its name. */
    function addItem() {
        const prompt = makePromptItem({}, noun);
        items.push(prompt);
        changed();
        const item = renderItem(prompt);
        list.append(item);
        autoSize(item.querySelector('.prompt-content'));
        item.scrollIntoView({ block: 'nearest' });
        const name = /** @type {HTMLInputElement} */ (item.querySelector('.prompt-name'));
        name.focus();
        name.select();
        scheduleCount();
        return prompt;
    }

    /** @param {PromptItem} prompt */
    async function removeItem(prompt) {
        if (prompt.content.trim()) {
            const confirmed = await confirmPopup(`Remove ${noun}?`, `"${nameOf(prompt)}" and its text will be deleted.`, 'Remove');
            if (!confirmed) return;
        }
        const index = items.indexOf(prompt);
        if (index === -1) return; // the list was replaced meanwhile
        items.splice(index, 1);
        changed();
        list.querySelector(`[data-id="${CSS.escape(prompt.id)}"]`)?.remove();
        // Keep keyboard focus nearby.
        /** @type {HTMLElement|null} */ (list.children[Math.min(index, list.children.length - 1)]?.querySelector('.prompt-toggle'))?.focus();
        scheduleCount();
    }

    // ── Reordering ──

    /** Makes the on-screen order the stored order (in place, so the caller's array follows). */
    function syncOrderFromDom() {
        const byId = new Map(items.map(p => [p.id, p]));
        const ordered = [...list.children].map(item => byId.get(/** @type {HTMLElement} */ (item).dataset.id)).filter(Boolean);
        items.splice(0, items.length, ...ordered);
        changed();
    }

    /**
     * Drag with the handle (pointer events, so mouse and touch both work), or
     * focus the handle and use ↑/↓.
     * @param {HTMLElement} item
     * @param {HTMLElement} handle
     */
    function setUpReorder(item, handle) {
        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            const pointerId = event.pointerId;
            item.classList.add('dragging');
            list.classList.add('reordering');

            // Listened for on the window: the pointer is usually over another item
            // when it moves or is released.
            const onMove = (/** @type {PointerEvent} */ moveEvent) => {
                if (moveEvent.pointerId !== pointerId) return;
                const y = moveEvent.clientY;
                // Scroll the tab when dragging near its top or bottom edge.
                const bounds = page.getBoundingClientRect();
                if (y < bounds.top + 40) page.scrollTop -= 12;
                else if (y > bounds.bottom - 40) page.scrollTop += 12;

                const others = [...list.children].filter(child => child !== item);
                const before = others.find(child => {
                    const rect = child.getBoundingClientRect();
                    return y < rect.top + rect.height / 2;
                });
                if (before) {
                    if (item.nextElementSibling !== before) list.insertBefore(item, before);
                } else if (list.lastElementChild !== item) {
                    list.append(item);
                }
            };
            const onEnd = (/** @type {PointerEvent} */ endEvent) => {
                if (endEvent.pointerId !== pointerId) return;
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onEnd);
                window.removeEventListener('pointercancel', onEnd);
                item.classList.remove('dragging');
                list.classList.remove('reordering');
                syncOrderFromDom();
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onEnd);
            window.addEventListener('pointercancel', onEnd);
        });

        handle.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowUp' && item.previousElementSibling) {
                list.insertBefore(item, item.previousElementSibling);
            } else if (event.key === 'ArrowDown' && item.nextElementSibling) {
                list.insertBefore(item.nextElementSibling, item);
            } else {
                return;
            }
            event.preventDefault();
            handle.focus();
            syncOrderFromDom();
        });
    }

    // ── Token counts ──

    let countTimer = 0;
    let countToken = 0;

    function scheduleCount() {
        clearTimeout(countTimer);
        countTimer = setTimeout(updateCounts, COUNT_DELAY_MS);
    }

    async function updateCounts() {
        const token = ++countToken;
        const shown = [...items];
        const labelOf = (/** @type {PromptItem} */ prompt) => list.querySelector(`[data-id="${CSS.escape(prompt.id)}"] .prompt-item-tokens`);
        try {
            const counts = await getTokenCountsAsync(shown.map(p => p.content.trim()));
            if (token !== countToken) return;
            shown.forEach((prompt, i) => {
                const label = labelOf(prompt);
                if (label) label.textContent = formatTokenCount(counts[i]);
            });
            onCounts({ items: shown, counts });
        } catch (err) {
            if (token !== countToken) return;
            // Fall back to character counts.
            for (const prompt of shown) {
                const label = labelOf(prompt);
                if (label) label.textContent = `${prompt.content.trim().length.toLocaleString()} characters`;
            }
            onCounts({ items: shown, counts: null, error: err });
        }
    }

    // Sizes depend on layout, which only exists once the page is visible.
    // (A group fires it when re-shown with this sub-tab already selected.)
    page.addEventListener('panel:show', sizeVisibleEditors);
    page.closest('.panel-group')?.addEventListener('panel:show', sizeVisibleEditors);
    // The estimate depends on the model's tokenizer.
    connectionEvents.addEventListener('change', scheduleCount);

    return {
        setItems,
        addItem,
        sizeVisibleEditors,
        get items() { return items; },
    };
}
