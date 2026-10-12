// Text boxes that grow to fit their text until the user drags the corner
// handle to pick a height themselves; from then on that height is kept
// (longer text scrolls inside).

/** Text boxes the user has resized by hand. */
const userSized = new WeakSet();

/**
 * Fits the height to the text, unless the user has chosen a height.
 * @param {HTMLTextAreaElement} textarea
 */
export function autoSize(textarea) {
    if (userSized.has(textarea)) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
}

/**
 * Lets the user drag the text box taller or shorter.
 * @param {HTMLTextAreaElement} textarea
 */
export function makeResizable(textarea) {
    textarea.classList.add('resizable-textarea');
    // Typing can't happen mid-drag, so a height change between pointer down
    // and up is the user resizing (by the handle).
    textarea.addEventListener('pointerdown', (event) => {
        const pointerId = event.pointerId;
        const before = textarea.offsetHeight;
        const onUp = (/** @type {PointerEvent} */ upEvent) => {
            if (upEvent.pointerId !== pointerId) return;
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            if (textarea.offsetHeight !== before) userSized.add(textarea);
        };
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    });
    // Double-clicking the handle area goes back to fitting the text.
    textarea.addEventListener('dblclick', (event) => {
        const rect = textarea.getBoundingClientRect();
        if (event.clientX < rect.right - 20 || event.clientY < rect.bottom - 20) return;
        userSized.delete(textarea);
        autoSize(textarea);
    });
}
