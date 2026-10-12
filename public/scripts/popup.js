// Modal popups built on <dialog> (Esc, focus trapping and the backdrop come for free).

/**
 * @template T
 * @typedef {{ label: string, value: T, primary?: boolean }} PopupButton
 */

/**
 * Shows a modal popup and resolves when it closes.
 * @template T
 * @param {object} options
 * @param {string} options.title
 * @param {Node|string} options.content
 * @param {PopupButton<T>[]} [options.buttons]
 * @param {boolean} [options.wide]
 * @returns {Promise<T|null>} The clicked button's value, or null if dismissed.
 */
export function showPopup({ title, content, buttons = [{ label: 'Close', value: null }], wide = false }) {
    const dialog = document.createElement('dialog');
    dialog.className = wide ? 'popup wide' : 'popup';

    const header = document.createElement('h3');
    header.className = 'popup-title';
    header.textContent = title;

    const body = document.createElement('div');
    body.className = 'popup-body';
    body.append(content);

    const controls = document.createElement('div');
    controls.className = 'popup-controls';

    /** @type {T|null} */
    let result = null;
    for (const button of buttons) {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = button.primary ? 'menu_button primary' : 'menu_button';
        element.textContent = button.label;
        element.addEventListener('click', () => {
            result = button.value;
            dialog.close();
        });
        controls.append(element);
    }

    dialog.append(header, body, controls);
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    dialog.showModal();

    return new Promise((resolve) => {
        dialog.addEventListener('close', () => {
            dialog.remove();
            resolve(result);
        });
    });
}

/**
 * Asks a yes/no question.
 * @param {string} title
 * @param {string} text
 * @param {string} [confirmLabel]
 * @returns {Promise<boolean>}
 */
export async function confirmPopup(title, text, confirmLabel = 'OK') {
    const result = await showPopup({
        title,
        content: text,
        buttons: [
            { label: 'Cancel', value: false },
            { label: confirmLabel, value: true, primary: true },
        ],
    });
    return result === true;
}
