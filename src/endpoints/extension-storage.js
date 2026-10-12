// ──────────────────────────────────────────────
// Extension storage — core port of the st-extension-storage server plugin
// ──────────────────────────────────────────────
//
// Same routes, request bodies and responses as the plugin, mounted at the same
// URL (/api/plugins/extension-storage) so V2 extensions and their bundled
// extension-storage.js client keep working unchanged. Paths are relative to
// the app root (e.g. 'extensions/MyExt/data.json').

import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { resolveInsideRoot } from '../paths.js';

const TAG = '[extension-storage]';
const OUTSIDE_ROOT = 'Path is outside the MiniTalk directory.';

export const router = express.Router();

/**
 * Resolves a JSON file path inside the app root.
 * @param {unknown} relPath
 * @param {{ createDirs?: boolean }} [options]
 * @returns {{ filePath: string, error?: undefined } | { filePath?: undefined, error: string }}
 */
function resolveJsonPath(relPath, { createDirs = false } = {}) {
    if (!relPath || typeof relPath !== 'string') {
        return { error: '"filePath" is required and must be a string.' };
    }
    if (!relPath.replace(/\\/g, '/').endsWith('.json')) {
        return { error: 'Only .json files are supported.' };
    }
    return resolveAnyPath(relPath, { createDirs });
}

/**
 * Resolves a path of any file type inside the app root.
 * @param {unknown} relPath
 * @param {{ createDirs?: boolean }} [options]
 * @returns {{ filePath: string, error?: undefined } | { filePath?: undefined, error: string }}
 */
function resolveAnyPath(relPath, { createDirs = false } = {}) {
    if (!relPath || typeof relPath !== 'string') {
        return { error: '"filePath" is required and must be a string.' };
    }
    const filePath = resolveInsideRoot(relPath);
    if (!filePath) {
        return { error: OUTSIDE_ROOT };
    }
    if (createDirs) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    return { filePath };
}

/**
 * Resolves an existing directory inside the app root.
 * @param {unknown} dirPath
 * @returns {{ dirPath: string, error?: undefined, status?: undefined } | { dirPath?: undefined, error: string, status: number }}
 */
function resolveDir(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') {
        return { error: '"dirPath" is required.', status: 400 };
    }
    const absolute = resolveInsideRoot(dirPath);
    if (!absolute) {
        return { error: OUTSIDE_ROOT, status: 400 };
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
        return { error: 'Directory not found.', status: 404 };
    }
    return { dirPath: absolute };
}

/**
 * Reads a JSON file, stripping a UTF-8 BOM if present.
 * @param {string} filePath
 */
function readJsonFileSync(filePath) {
    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }
    return JSON.parse(content);
}

/**
 * Sets a value on a nested object using a dot-notation path.
 * @param {object} obj
 * @param {string} dotPath
 * @param {any} value
 */
function setNestedValue(obj, dotPath, value) {
    const keys = dotPath.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
}

/**
 * Wraps a route handler with the shared error logging / 500 response.
 * @param {string} name
 * @param {(req: import('express').Request, res: import('express').Response) => any} handler
 */
function route(name, handler) {
    return (req, res) => {
        try {
            return handler(req, res);
        } catch (err) {
            console.error(`${TAG} ${name} error:`, err);
            return res.status(500).json({ error: err.message });
        }
    };
}

// POST /get  { filePath } → parsed JSON content
router.post('/get', route('GET', (req, res) => {
    const result = resolveJsonPath(req.body.filePath);
    if (result.error) return res.status(400).json({ error: result.error });
    if (!fs.existsSync(result.filePath)) return res.status(404).json({ error: 'File not found.' });
    return res.json(readJsonFileSync(result.filePath));
}));

// POST /save  { filePath, data } → creates or overwrites the file
router.post('/save', route('SAVE', (req, res) => {
    const { data } = req.body;
    if (data === undefined || data === null) {
        return res.status(400).json({ error: 'Missing "data" in request body.' });
    }
    const result = resolveJsonPath(req.body.filePath, { createDirs: true });
    if (result.error) return res.status(400).json({ error: result.error });
    writeFileAtomicSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return res.json({ ok: true });
}));

// POST /update  { filePath, updates } → shallow merge, dot-notation keys set nested values
router.post('/update', route('UPDATE', (req, res) => {
    const { updates } = req.body;
    if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: '"updates" must be a non-null object.' });
    }
    const result = resolveJsonPath(req.body.filePath, { createDirs: true });
    if (result.error) return res.status(400).json({ error: result.error });

    const existing = fs.existsSync(result.filePath) ? readJsonFileSync(result.filePath) : {};
    for (const [key, value] of Object.entries(updates)) {
        if (key.includes('.')) {
            setNestedValue(existing, key, value);
        } else {
            existing[key] = value;
        }
    }

    writeFileAtomicSync(result.filePath, JSON.stringify(existing, null, 2), 'utf-8');
    return res.json({ ok: true, data: existing });
}));

// POST /delete  { filePath }
router.post('/delete', route('DELETE', (req, res) => {
    const result = resolveJsonPath(req.body.filePath);
    if (result.error) return res.status(400).json({ error: result.error });
    if (!fs.existsSync(result.filePath)) return res.status(404).json({ error: 'File not found.' });
    fs.unlinkSync(result.filePath);
    return res.json({ ok: true });
}));

// POST /exists  { filePath } → { exists }
router.post('/exists', route('EXISTS', (req, res) => {
    const result = resolveJsonPath(req.body.filePath);
    if (result.error) return res.status(400).json({ error: result.error });
    return res.json({ exists: fs.existsSync(result.filePath) });
}));

// POST /list  { dirPath } → { files } (.json only)
router.post('/list', route('LIST', (req, res) => {
    const dir = resolveDir(req.body.dirPath);
    if (dir.error) return res.status(dir.status).json({ error: dir.error });
    const files = fs.readdirSync(dir.dirPath).filter(f => f.endsWith('.json'));
    return res.json({ files });
}));

// POST /save-raw  { filePath, base64 } → writes binary content of any type
router.post('/save-raw', route('SAVE-RAW', (req, res) => {
    const { base64 } = req.body;
    if (!base64 || typeof base64 !== 'string') {
        return res.status(400).json({ error: '"base64" is required and must be a string.' });
    }
    const result = resolveAnyPath(req.body.filePath, { createDirs: true });
    if (result.error) return res.status(400).json({ error: result.error });
    fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
    return res.json({ ok: true });
}));

// POST /get-raw  { filePath } → { base64 }
router.post('/get-raw', route('GET-RAW', (req, res) => {
    const result = resolveAnyPath(req.body.filePath);
    if (result.error) return res.status(400).json({ error: result.error });
    if (!fs.existsSync(result.filePath)) return res.status(404).json({ error: 'File not found.' });
    return res.json({ base64: fs.readFileSync(result.filePath).toString('base64') });
}));

// POST /delete-raw  { filePath } → deletes a file of any type
router.post('/delete-raw', route('DELETE-RAW', (req, res) => {
    const result = resolveAnyPath(req.body.filePath);
    if (result.error) return res.status(400).json({ error: result.error });
    if (!fs.existsSync(result.filePath)) return res.status(404).json({ error: 'File not found.' });
    fs.unlinkSync(result.filePath);
    return res.json({ ok: true });
}));

// POST /list-all  { dirPath, extension? } → { files }
router.post('/list-all', route('LIST-ALL', (req, res) => {
    const dir = resolveDir(req.body.dirPath);
    if (dir.error) return res.status(dir.status).json({ error: dir.error });
    const { extension } = req.body;
    let files = fs.readdirSync(dir.dirPath);
    if (extension) {
        files = files.filter(f => f.endsWith(extension));
    }
    return res.json({ files });
}));
