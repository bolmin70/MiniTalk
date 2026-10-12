// Bare-bones slash command runner. Same module path and exports as
// SillyTavern's slash-commands.js (registerSlashCommand,
// executeSlashCommands, executeSlashCommandsWithOptions).

import { SlashCommand } from './slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from './slash-commands/SlashCommandArgument.js';
import { SlashCommandParser, unescape } from './slash-commands/SlashCommandParser.js';
import { showToast } from './toast.js';

/**
 * Same fields as SillyTavern's SlashCommandClosureResult; only `pipe` and the
 * error fields are ever set here.
 * @typedef {{ interrupt: boolean, pipe: any, isBreak: boolean, isAborted: boolean, isQuietlyAborted: boolean, abortReason: string|null, isError: boolean, errorMessage: string|null }} SlashCommandResult
 */

/**
 * @param {Partial<SlashCommandResult>} [fields]
 * @returns {SlashCommandResult}
 */
function makeResult(fields = {}) {
    return {
        interrupt: false,
        pipe: '',
        isBreak: false,
        isAborted: false,
        isQuietlyAborted: false,
        abortReason: null,
        isError: false,
        errorMessage: null,
        ...fields,
    };
}

/** True if the text should run as slash commands instead of being sent as a message. */
export function isSlashCommand(text) {
    return /^\/[^\s/]/.test(text.trim());
}

/**
 * Legacy registration helper.
 * @deprecated Use SlashCommandParser.addCommandObject(SlashCommand.fromProps({...})).
 * @param {string} command
 * @param {import('./slash-commands/SlashCommand.js').SlashCommandCallback} callback
 * @param {string[]} [aliases]
 * @param {string} [helpString]
 */
export function registerSlashCommand(command, callback, aliases, helpString = '') {
    SlashCommandParser.addCommand(command, callback, aliases, helpString);
}

/**
 * Splits text into words, keeping "quoted phrases" together.
 * @param {string} text
 * @param {number} [limit] Maximum number of parts; the last keeps the rest
 */
function splitWords(text, limit = Infinity) {
    const parts = [];
    let rest = text.trim();
    while (rest) {
        if (parts.length === limit - 1) {
            parts.push(rest);
            break;
        }
        const match = rest.match(/^"((?:\\.|[^"\\])*)"(?:\s+|$)|^(\S+)(?:\s+|$)/);
        parts.push(unescape(match[1] ?? match[2]));
        rest = rest.slice(match[0].length);
    }
    return parts;
}

/**
 * Builds the callback arguments for one call: fills in the pipe, defaults and
 * named-argument aliases, and checks required arguments.
 * @param {import('./slash-commands/SlashCommandParser.js').ParsedCall} call
 * @param {any} pipe Result of the previous command
 */
function resolveArguments({ command, name, namedArgs: rawNamed, unnamedArg: rawUnnamed }, pipe) {
    const pipeText = pipe === undefined || pipe === null ? '' : String(pipe);
    const insertPipe = (/** @type {string} */ text) => text.replaceAll('{{pipe}}', pipeText);

    /** @type {import('./slash-commands/SlashCommand.js').NamedArguments} */
    const namedArgs = { _hasUnnamedArgument: rawUnnamed.length > 0 };
    for (const [key, value] of Object.entries(rawNamed)) {
        const definition = command.namedArgumentList.find(arg => arg.name === key || arg.aliasList?.includes(key));
        namedArgs[definition?.name ?? key] = insertPipe(value);
    }
    for (const definition of command.namedArgumentList) {
        if (namedArgs[definition.name] !== undefined) continue;
        if (definition.defaultValue !== null && definition.defaultValue !== undefined) {
            namedArgs[definition.name] = definition.defaultValue;
        } else if (definition.isRequired) {
            throw new Error(`/${name} requires the named argument "${definition.name}".`);
        }
    }

    // With no unnamed argument, the previous command's result is used (as in SillyTavern).
    let unnamed = rawUnnamed || pipeText;
    const quoted = unnamed.match(/^"((?:\\.|[^"\\])*)"$/);
    if (quoted && !command.rawQuotes) {
        unnamed = quoted[1];
    }
    unnamed = unescape(insertPipe(unnamed));

    const unnamedDefinition = command.unnamedArgumentList[0];
    if (!unnamed && unnamedDefinition) {
        if (unnamedDefinition.defaultValue !== null && unnamedDefinition.defaultValue !== undefined) {
            unnamed = String(unnamedDefinition.defaultValue);
        } else if (unnamedDefinition.isRequired) {
            throw new Error(`/${name} needs ${unnamedDefinition.description ? `an argument (${unnamedDefinition.description})` : 'an argument'}.`);
        }
    }

    const unnamedArg = command.splitUnnamedArgument
        ? splitWords(rawUnnamed ? insertPipe(rawUnnamed) : unnamed, command.splitUnnamedArgumentCount)
        : unnamed;
    return { namedArgs, unnamedArg };
}

/**
 * Runs slash commands.
 * @param {string} text e.g. '/console hello | /console {{pipe}} again'
 * @param {{ handleParserErrors?: boolean, handleExecutionErrors?: boolean }} [options]
 *   When an option is true, that kind of error is shown as a toast and returned
 *   in the result; otherwise it is thrown. Defaults match SillyTavern.
 * @returns {Promise<SlashCommandResult>}
 */
export async function executeSlashCommandsWithOptions(text, { handleParserErrors = true, handleExecutionErrors = false } = {}) {
    let calls;
    try {
        calls = SlashCommandParser.parse(String(text ?? ''));
    } catch (error) {
        if (!handleParserErrors) throw error;
        showToast(error.message, 'error');
        return makeResult({ isError: true, errorMessage: error.message });
    }

    let pipe = '';
    try {
        for (const call of calls) {
            const { namedArgs, unnamedArg } = resolveArguments(call, pipe);
            const result = await call.command.callback(namedArgs, unnamedArg);
            pipe = result ?? '';
        }
    } catch (error) {
        if (!handleExecutionErrors) throw error;
        console.error('Slash command failed:', error);
        showToast(error.message, 'error');
        return makeResult({ isError: true, errorMessage: error.message });
    }
    return makeResult({ pipe });
}

/**
 * Legacy signature, kept for V2 code. Extra parameters are ignored.
 * @param {string} text
 * @param {boolean} [handleParserErrors]
 * @param {any} [_scope]
 * @param {boolean} [handleExecutionErrors]
 */
export function executeSlashCommands(text, handleParserErrors = true, _scope = null, handleExecutionErrors = false) {
    return executeSlashCommandsWithOptions(text, { handleParserErrors, handleExecutionErrors });
}

/** Registers the built-in commands. */
export function initDefaultSlashCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'console',
        callback: (_namedArgs, text) => {
            console.log(text);
            return text;
        },
        returns: 'the printed text',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'text to print',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: 'Prints text to the browser console (F12 → Console) and passes it on to the next command.',
    }));
}
