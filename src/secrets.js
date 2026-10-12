import fs from 'node:fs';

import { SECRETS_FILE } from './paths.js';

export const SECRET_KEYS = {
    CLAUDE: 'api_key_claude',
    OPENROUTER: 'api_key_openrouter',
    OPENAI: 'api_key_openai',
};

const ENV_FALLBACKS = {
    [SECRET_KEYS.CLAUDE]: 'ANTHROPIC_API_KEY',
    [SECRET_KEYS.OPENROUTER]: 'OPENROUTER_API_KEY',
    [SECRET_KEYS.OPENAI]: 'OPENAI_API_KEY',
};

/**
 * Reads an API key from data/default-user/secrets.json, falling back to an
 * environment variable. The file uses SillyTavern's format, so an existing ST
 * secrets.json can be copied over as-is: each value is either a plain string
 * (older ST) or an array of { value, active } entries (current ST).
 * The file is re-read on every call, so edits apply without a restart.
 * @param {string} key One of SECRET_KEYS
 * @returns {string} The key, or an empty string if none is configured.
 */
export function readSecret(key) {
    let secrets = {};
    try {
        secrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8').replace(/^﻿/, ''));
    } catch {
        // Missing or unreadable file: fall through to the environment.
    }

    const entry = secrets[key];
    let value = '';
    if (typeof entry === 'string') {
        value = entry;
    } else if (Array.isArray(entry)) {
        value = (entry.find(e => e?.active) ?? entry[0])?.value ?? '';
    }

    return value || process.env[ENV_FALLBACKS[key]] || '';
}
