// Loads the extensions in extensions/ (listed by /api/extensions) once the
// app is set up: each one's stylesheet, then its JS module, one extension at a
// time in loading_order. An extension that fails is reported and skipped; the
// rest still load.
//
// Extensions import core modules by absolute URL, e.g.
//   import { ExtensionStorage } from '/scripts/extension-storage.js';

import { showToast } from './toast.js';

/**
 * @typedef {{ name: string, displayName: string, version: string, loadingOrder: number, js: string|null, css: string|null, error: string|null }} ExtensionInfo
 * @typedef {ExtensionInfo & { status: 'loaded'|'failed', message?: string }} ExtensionResult
 */

/** @type {ExtensionResult[]} */
const results = [];

/**
 * URL of a file inside an extension's folder.
 * @param {ExtensionInfo} extension
 * @param {string} file
 */
function fileUrl(extension, file) {
    return `/extensions/${encodeURIComponent(extension.name)}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * @param {string} href
 * @returns {Promise<void>}
 */
function loadStylesheet(href) {
    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.addEventListener('load', () => resolve());
        link.addEventListener('error', () => reject(new Error(`Couldn't load ${href}`)));
        document.head.append(link);
    });
}

/** @param {ExtensionInfo} extension */
async function loadExtension(extension) {
    if (extension.error) throw new Error(extension.error);
    if (extension.css) await loadStylesheet(fileUrl(extension, extension.css));
    if (extension.js) await import(fileUrl(extension, extension.js));
}

/**
 * Loads every extension. Call once, after the core is initialised.
 * @returns {Promise<ExtensionResult[]>}
 */
export async function loadExtensions() {
    let extensions;
    try {
        const response = await fetch('/api/extensions');
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
        extensions = /** @type {ExtensionInfo[]} */ (data.extensions ?? []);
    } catch (err) {
        console.error('[extensions] Couldn\'t list extensions:', err);
        showToast(`Couldn't list extensions: ${err.message}`, 'error');
        return results;
    }

    for (const extension of extensions) {
        try {
            await loadExtension(extension);
            results.push({ ...extension, status: 'loaded' });
            console.info(`[extensions] Loaded ${extension.displayName}${extension.version ? ` ${extension.version}` : ''}`);
        } catch (err) {
            results.push({ ...extension, status: 'failed', message: err.message });
            console.error(`[extensions] ${extension.displayName} failed to load:`, err);
            showToast(`Extension "${extension.displayName}" failed to load: ${err.message}`, 'error', 10000);
        }
    }
    return results;
}

/**
 * What happened to each extension, in load order.
 * @returns {ExtensionResult[]}
 */
export function getExtensions() {
    return results.map(result => ({ ...result }));
}
