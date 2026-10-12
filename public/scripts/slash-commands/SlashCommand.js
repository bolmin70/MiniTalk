// Bare-bones version of SillyTavern's SlashCommand.js: a plain command
// definition, created the same way V2 extensions do:
//
//   SlashCommandParser.addCommandObject(SlashCommand.fromProps({
//       name: 'mycommand',
//       callback: (namedArgs, unnamedArg) => { ...; return 'result'; },
//       helpString: 'What it does.',
//       namedArgumentList: [SlashCommandNamedArgument.fromProps({ name: 'level', ... })],
//       unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'text', ... })],
//   }));

/**
 * Named arguments as the callback receives them. Values are strings;
 * `_hasUnnamedArgument` tells whether text was given or the pipe was used.
 * @typedef {{ [name: string]: any, _hasUnnamedArgument: boolean }} NamedArguments
 */

/**
 * @typedef {(namedArgs: NamedArguments, unnamedArg: string | string[]) => any} SlashCommandCallback
 */

export class SlashCommand {
    /**
     * @param {Partial<SlashCommand> & { name: string, callback: SlashCommandCallback }} props
     * @returns {SlashCommand}
     */
    static fromProps(props) {
        const command = new SlashCommand();
        Object.assign(command, props);
        command.aliases = props.aliases ?? [];
        command.namedArgumentList = props.namedArgumentList ?? [];
        command.unnamedArgumentList = props.unnamedArgumentList ?? [];
        return command;
    }

    /** @type {string} */ name;
    /** @type {SlashCommandCallback} */ callback;
    /** @type {string} */ helpString = '';
    /** @type {string} */ returns;
    /** @type {string[]} */ aliases = [];
    /** @type {import('./SlashCommandArgument.js').SlashCommandNamedArgument[]} */ namedArgumentList = [];
    /** @type {import('./SlashCommandArgument.js').SlashCommandArgument[]} */ unnamedArgumentList = [];
    /** Pass the unnamed argument to the callback as an array of words (quotes group words). */
    splitUnnamedArgument = false;
    /** Maximum number of parts when splitting; the last part keeps the rest. */
    /** @type {number} */ splitUnnamedArgumentCount;
    /** Keep quotes around a quoted unnamed argument instead of stripping them. */
    rawQuotes = false;
    /** Kept for compatibility; no effect yet. */
    interruptsGeneration = false;
    /** Kept for compatibility; no effect yet. */
    purgeFromMessage = true;
}
