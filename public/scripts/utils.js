/**
 * Copies text to the clipboard. Falls back to execCommand where the Clipboard
 * API is unavailable (it needs a secure context, so e.g. plain-http LAN access).
 * Same name and location as SillyTavern's helper.
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    // Outside an open modal <dialog> the page is inert, so attach it there.
    (document.querySelector('dialog[open]') ?? document.body).append(helper);
    helper.select();
    const copied = document.execCommand('copy');
    helper.remove();
    if (!copied) {
        throw new Error('Copy to clipboard failed.');
    }
}
