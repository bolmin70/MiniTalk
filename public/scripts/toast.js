const container = document.getElementById('toast-container');

/**
 * Shows a small dismissable notification.
 * @param {string} message
 * @param {'error'|'warning'|'info'} [type]
 * @param {number} [timeout] ms before it disappears
 */
export function showToast(message, type = 'info', timeout = 6000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toast.addEventListener('click', () => toast.remove());
    container.append(toast);
    setTimeout(() => toast.remove(), timeout);
}
