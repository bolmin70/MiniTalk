// The right-side control panel: slide in/out and tab switching.
//
// Tabs can nest: a top-level tab may show a group page with its own sub-tab
// bar. Every tab id is unique across levels, so selecting a sub-tab also
// selects its group.

// Remembers whether the panel is open and which tab each tab bar shows (per browser).
const STORAGE_KEY = 'MiniTalk_panel';
// Below this width the panel covers the chat instead of sitting beside it.
const WIDE_SCREEN = window.matchMedia('(min-width: 1001px)');

const panel = document.getElementById('control_panel');
const toggleButton = document.getElementById('control_panel_toggle');
const tablists = /** @type {HTMLElement[]} */ ([...panel.querySelectorAll('[role="tablist"]')]);

const state = {
    open: WIDE_SCREEN.matches,
    /**
     * Selected tab id per tab bar, keyed by the bar's group page id ('main' for the top bar).
     * @type {Record<string, string>}
     */
    selected: {},
};

/** @param {HTMLElement} tablist */
function tabsOf(tablist) {
    return /** @type {HTMLButtonElement[]} */ ([...tablist.querySelectorAll(':scope > [role="tab"]')]);
}

/** @param {HTMLElement} tablist */
function keyOf(tablist) {
    return tablist.closest('[role="tabpanel"]')?.id ?? 'main';
}

/** @param {string} id */
function findTab(id) {
    return /** @type {HTMLButtonElement|null} */ (panel.querySelector(`[role="tab"][data-tab="${CSS.escape(id)}"]`));
}

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Not critical.
    }
}

/** @returns {string[]} Tab ids to select, in order */
function load() {
    let toSelect = [];
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        if (typeof saved.open === 'boolean') state.open = saved.open;
        if (saved.selected && typeof saved.selected === 'object') {
            toSelect = Object.values(saved.selected).filter(id => typeof id === 'string');
        } else if (typeof saved.tab === 'string') {
            toSelect = [saved.tab]; // older format: a single tab id
        }
    } catch {
        // Storage unavailable or corrupt; use defaults.
    }
    // On small screens the panel covers the chat, so never start with it open.
    if (!WIDE_SCREEN.matches) state.open = false;
    return toSelect;
}

export function isPanelOpen() {
    return state.open;
}

/** @param {boolean} open */
export function setPanelOpen(open) {
    state.open = open;
    document.body.classList.toggle('panel-open', open);
    panel.inert = !open;
    toggleButton.setAttribute('aria-expanded', String(open));
    toggleButton.classList.toggle('active', open);
    save();
}

/**
 * Shows a tab, and the group tab containing it if it's a sub-tab.
 * A page that becomes visible receives a 'panel:show' event (e.g. to load its data lazily).
 * @param {string} id e.g. 'api', 'prompt'
 */
export function selectTab(id) {
    const target = findTab(id);
    if (!target || target.disabled) return;
    const tablist = /** @type {HTMLElement} */ (target.closest('[role="tablist"]'));
    for (const tab of tabsOf(tablist)) {
        const selected = tab === target;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        const page = document.getElementById(tab.getAttribute('aria-controls') ?? '');
        if (!page) continue;
        const wasHidden = page.hidden;
        page.hidden = !selected;
        if (selected && wasHidden) page.dispatchEvent(new CustomEvent('panel:show'));
    }
    state.selected[keyOf(tablist)] = id;

    const group = tablist.closest('[role="tabpanel"]');
    const groupTab = group && panel.querySelector(`[role="tab"][aria-controls="${CSS.escape(group.id)}"]`);
    if (groupTab instanceof HTMLElement && groupTab.getAttribute('aria-selected') !== 'true') {
        selectTab(groupTab.dataset.tab);
    }
    save();
}

/**
 * Opens the panel on a tab.
 * @param {string} [tab]
 */
export function openPanel(tab) {
    if (tab) selectTab(tab);
    setPanelOpen(true);
}

export function initSidePanel() {
    const saved = load();
    // Every tab bar starts on its first enabled tab (innermost first, so the
    // top bar decides which group is visible), then the saved choices apply.
    for (const tablist of [...tablists].reverse()) {
        const first = tabsOf(tablist).find(tab => !tab.disabled);
        if (first) selectTab(first.dataset.tab);
    }
    for (const id of saved) {
        selectTab(id);
    }
    // Apply the initial state without the slide animation.
    document.body.classList.add('no-transition');
    setPanelOpen(state.open);
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('no-transition')));

    toggleButton.addEventListener('click', () => setPanelOpen(!state.open));
    // On small screens the open panel covers the toggle, so it has its own close button.
    document.getElementById('control_panel_close').addEventListener('click', () => {
        setPanelOpen(false);
        toggleButton.focus();
    });

    for (const tablist of tablists) {
        for (const tab of tabsOf(tablist)) {
            tab.addEventListener('click', () => selectTab(tab.dataset.tab));
        }
        // Arrow keys move between this bar's tabs (standard tablist behaviour).
        tablist.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const enabled = tabsOf(tablist).filter(tab => !tab.disabled);
            if (!enabled.length) return;
            const index = enabled.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
            const next = {
                ArrowLeft: enabled[(index - 1 + enabled.length) % enabled.length],
                ArrowRight: enabled[(index + 1) % enabled.length],
                Home: enabled[0],
                End: enabled[enabled.length - 1],
            }[event.key];
            event.preventDefault();
            selectTab(next.dataset.tab);
            next.focus();
        });
    }

    // Esc closes the panel when focus is inside it.
    panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
            setPanelOpen(false);
            toggleButton.focus();
        }
    });

    // Going from wide to narrow, close it rather than suddenly covering the chat.
    WIDE_SCREEN.addEventListener('change', () => {
        if (!WIDE_SCREEN.matches && state.open) setPanelOpen(false);
    });
}
