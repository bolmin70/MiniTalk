// Bare-bones version of SillyTavern's SlashCommandParser.js: the command
// registry plus a minimal parser.
//
// Supported syntax (a subset of SillyTavern's):
//   /command name=value name="quoted value" unnamed text
//   /first | /second          the pipe passes /first's result to /second
//   {{pipe}}                  inserted into arguments as the previous result
//   \|                        a literal | (a | inside "double quotes" also stays literal)
// Not supported yet: closures {: :}, variables, comments, parser flags.

import { SlashCommand } from './SlashCommand.js';

/**
 * One parsed command call, before arguments are resolved.
 * @typedef {{ command: SlashCommand, name: string, namedArgs: Record<string, string>, unnamedArg: string }} ParsedCall
 */

export class SlashCommandParser {
    /**
     * Registered commands, keyed by name and by each alias.
     * @type {Record<string, SlashCommand>}
     */
    static commands = {};

    /**
     * Legacy registration (SillyTavern's registerSlashCommand).
     * @param {string} command
     * @param {import('./SlashCommand.js').SlashCommandCallback} callback
     * @param {string[]} [aliases]
     * @param {string} [helpString]
     */
    static addCommand(command, callback, aliases, helpString = '') {
        this.addCommandObject(SlashCommand.fromProps({ name: command, callback, aliases, helpString }));
    }

    /**
     * Registers a command. A later registration with the same name replaces
     * the earlier one, as in SillyTavern.
     * @param {SlashCommand} command
     */
    static addCommandObject(command) {
        const names = [command?.name, ...(command?.aliases ?? [])];
        for (const name of names) {
            if (typeof name !== 'string' || !/^[^\s|/=]+$/.test(name)) {
                throw new Error(`Invalid slash command name: "${name}". Names can't be empty or contain spaces, "|", "/" or "=".`);
            }
        }
        if (typeof command.callback !== 'function') {
            throw new Error(`Slash command /${command.name} has no callback.`);
        }
        if (names.some(name => Object.hasOwn(this.commands, name))) {
            console.warn('Duplicate slash command registered, the new one replaces the old:', names);
        }
        for (const name of names) {
            this.commands[name] = command;
        }
    }

    /**
     * Splits a command line into command calls.
     * @param {string} text
     * @returns {ParsedCall[]}
     * @throws {Error} On syntax errors and unknown commands
     */
    static parse(text) {
        return splitOnPipes(text.trim()).map((segment) => {
            const match = segment.match(/^\/([^\s|]+)\s*([\s\S]*)$/);
            if (!match) {
                throw new Error(`Expected a command starting with "/", got: ${segment || '(nothing)'}`);
            }
            const [, name, rest] = match;
            const command = this.commands[name];
            if (!command) {
                throw new Error(`Unknown command /${name}`);
            }
            return { command, name, ...parseArguments(rest) };
        });
    }
}

/**
 * Splits on "|" that is neither escaped nor inside double quotes.
 * @param {string} text
 */
function splitOnPipes(text) {
    const segments = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '\\' && i + 1 < text.length) {
            current += char + text[++i];
        } else if (char === '"') {
            inQuotes = !inQuotes;
            current += char;
        } else if (char === '|' && !inQuotes) {
            segments.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    segments.push(current.trim());
    return segments;
}

/** Undoes \| and \" escapes. */
export function unescape(text) {
    return text.replace(/\\([|"\\])/g, '$1');
}

/**
 * Leading name=value pairs are named arguments; the rest is the unnamed one.
 * @param {string} text
 * @returns {{ namedArgs: Record<string, string>, unnamedArg: string }}
 */
function parseArguments(text) {
    const namedArgs = {};
    const namedArgRe = /^([\w-]+)=(?:"((?:\\.|[^"\\])*)"|(\S*))(?:\s+|$)/;
    let rest = text;
    let match;
    while ((match = rest.match(namedArgRe))) {
        namedArgs[match[1]] = unescape(match[2] ?? match[3]);
        rest = rest.slice(match[0].length);
    }
    return { namedArgs, unnamedArg: rest.trim() };
}
