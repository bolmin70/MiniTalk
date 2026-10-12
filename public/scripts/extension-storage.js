/**
 * ExtensionStorage — client for the core storage API (/api/plugins/extension-storage).
 *
 * Same interface as the st-extension-storage helper that V2 extensions bundle,
 * plus the raw (any file type) operations. All paths are relative to the
 * MiniTalk root, e.g. 'extensions/MyExt/data.json'.
 *
 *   import { ExtensionStorage } from '/scripts/extension-storage.js';
 *   const store = new ExtensionStorage();
 *   await store.save('extensions/MyExt/data.json', { key: 'value' });
 *   const data = await store.get('extensions/MyExt/data.json');
 *   await store.update('extensions/MyExt/data.json', { 'nested.key': 42 });
 */

import { getRequestHeaders } from './requests.js';

const API_BASE = '/api/plugins/extension-storage';

/**
 * @param {string} endpoint
 * @param {object} body
 */
async function post(endpoint, body) {
    return fetch(`${API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(body),
    });
}

/**
 * @param {Response} resp
 * @param {string} operation
 */
async function ensureOk(resp, operation) {
    if (!resp.ok) throw new Error(`ExtensionStorage.${operation} failed: ${await resp.text()}`);
}

export class ExtensionStorage {
    /**
     * Read a JSON file.
     * @param {string} filePath
     * @returns {Promise<any>} Parsed JSON, or null if the file doesn't exist.
     */
    async get(filePath) {
        const resp = await post('get', { filePath });
        if (resp.status === 404) return null;
        await ensureOk(resp, 'get');
        return resp.json();
    }

    /**
     * Create or overwrite a JSON file. Directories are created automatically.
     * @param {string} filePath
     * @param {any} data Any JSON-serializable value
     */
    async save(filePath, data) {
        await ensureOk(await post('save', { filePath, data }), 'save');
    }

    /**
     * Merge keys into a JSON file (dot-notation sets nested values: { 'a.b.c': 42 }).
     * Creates the file if it doesn't exist.
     * @param {string} filePath
     * @param {object} updates
     * @returns {Promise<any>} The merged data
     */
    async update(filePath, updates) {
        const resp = await post('update', { filePath, updates });
        await ensureOk(resp, 'update');
        return (await resp.json()).data;
    }

    /** @param {string} filePath */
    async delete(filePath) {
        await ensureOk(await post('delete', { filePath }), 'delete');
    }

    /**
     * @param {string} filePath
     * @returns {Promise<boolean>}
     */
    async exists(filePath) {
        const resp = await post('exists', { filePath });
        await ensureOk(resp, 'exists');
        return (await resp.json()).exists;
    }

    /**
     * List the .json files in a directory.
     * @param {string} dirPath
     * @returns {Promise<string[]>}
     */
    async list(dirPath) {
        const resp = await post('list', { dirPath });
        await ensureOk(resp, 'list');
        return (await resp.json()).files;
    }

    /**
     * List all files in a directory, optionally filtered by extension (e.g. '.png').
     * @param {string} dirPath
     * @param {string} [extension]
     * @returns {Promise<string[]>}
     */
    async listAll(dirPath, extension) {
        const resp = await post('list-all', { dirPath, extension });
        await ensureOk(resp, 'listAll');
        return (await resp.json()).files;
    }

    /**
     * Write a binary file of any type from base64.
     * @param {string} filePath
     * @param {string} base64
     */
    async saveRaw(filePath, base64) {
        await ensureOk(await post('save-raw', { filePath, base64 }), 'saveRaw');
    }

    /**
     * Read any file as base64.
     * @param {string} filePath
     * @returns {Promise<string|null>} base64, or null if the file doesn't exist.
     */
    async getRaw(filePath) {
        const resp = await post('get-raw', { filePath });
        if (resp.status === 404) return null;
        await ensureOk(resp, 'getRaw');
        return (await resp.json()).base64;
    }

    /** @param {string} filePath */
    async deleteRaw(filePath) {
        await ensureOk(await post('delete-raw', { filePath }), 'deleteRaw');
    }
}
