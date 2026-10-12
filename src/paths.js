import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(APP_ROOT, 'public');
export const DATA_DIR = path.join(APP_ROOT, 'data');
export const USER_DIR = path.join(DATA_DIR, 'default-user');
// Each extension is a folder here with a manifest.json; served at /extensions/<folder>/.
// MINITALK_EXTENSIONS_DIR points it elsewhere (e.g. an empty folder for tests).
export const EXTENSIONS_DIR = path.resolve(process.env.MINITALK_EXTENSIONS_DIR || path.join(APP_ROOT, 'extensions'));
export const SECRETS_FILE = path.join(USER_DIR, 'secrets.json');

/**
 * Resolves a path relative to the app root, refusing anything that escapes it.
 * @param {string} relPath
 * @returns {string|null} Absolute path, or null if outside the app root.
 */
export function resolveInsideRoot(relPath) {
    const absolute = path.resolve(APP_ROOT, String(relPath).replace(/\\/g, '/'));
    if (absolute !== APP_ROOT && !absolute.startsWith(APP_ROOT + path.sep)) {
        return null;
    }
    return absolute;
}
