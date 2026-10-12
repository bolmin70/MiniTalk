// Extension discovery. Each folder in extensions/ with a manifest.json is an
// extension; the browser loads them in loading_order (see
// public/scripts/extensions.js). Their files are served at /extensions/<folder>/.
//
// manifest.json:
//   { "display_name": "My Extension", "version": "1.0.0",
//     "loading_order": 100,  // lower loads first (default 100)
//     "js": "index.js",      // module entry point (optional)
//     "css": "style.css" }   // stylesheet (optional)

import fs from 'node:fs/promises';
import path from 'node:path';

import express from 'express';

import { EXTENSIONS_DIR } from '../paths.js';
import { sendError } from '../util.js';

export const router = express.Router();

const DEFAULT_LOADING_ORDER = 100;

/**
 * A manifest file path that stays inside its extension folder, or null.
 * @param {string} folder Absolute extension folder
 * @param {unknown} file
 * @returns {string|null} The path as given, with forward slashes
 */
function fileInside(folder, file) {
    if (typeof file !== 'string' || !file.trim()) return null;
    const relative = file.trim().replace(/\\/g, '/');
    const absolute = path.resolve(folder, relative);
    return absolute.startsWith(folder + path.sep) ? relative : null;
}

/**
 * @param {string} name Folder name
 * @returns {Promise<object|null>} null when the folder has no manifest
 */
async function readExtension(name) {
    const folder = path.join(EXTENSIONS_DIR, name);
    let text;
    try {
        text = await fs.readFile(path.join(folder, 'manifest.json'), 'utf8');
    } catch {
        return null;
    }
    const extension = { name, displayName: name, version: '', loadingOrder: DEFAULT_LOADING_ORDER, js: null, css: null, error: null };
    try {
        const manifest = JSON.parse(text.replace(/^﻿/, ''));
        if (typeof manifest.display_name === 'string' && manifest.display_name.trim()) extension.displayName = manifest.display_name.trim();
        if (typeof manifest.version === 'string') extension.version = manifest.version;
        if (Number.isFinite(manifest.loading_order)) extension.loadingOrder = manifest.loading_order;
        extension.js = fileInside(folder, manifest.js);
        extension.css = fileInside(folder, manifest.css);
        if (manifest.js && !extension.js) extension.error = `"js" must be a file inside the extension folder.`;
        else if (manifest.css && !extension.css) extension.error = `"css" must be a file inside the extension folder.`;
    } catch (err) {
        extension.error = `manifest.json is not valid JSON: ${err.message}`;
    }
    return extension;
}

// GET / → { extensions: [{ name, displayName, version, loadingOrder, js, css, error }] } in load order
router.get('/', async (_req, res) => {
    try {
        let entries = [];
        try {
            entries = await fs.readdir(EXTENSIONS_DIR, { withFileTypes: true });
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
        const extensions = (await Promise.all(entries
            .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
            .map(entry => readExtension(entry.name))))
            .filter(Boolean)
            .sort((a, b) => a.loadingOrder - b.loadingOrder || a.name.localeCompare(b.name));
        return res.json({ extensions });
    } catch (err) {
        console.error('[extensions] listing failed:', err);
        return sendError(res, 500, err.message);
    }
});
