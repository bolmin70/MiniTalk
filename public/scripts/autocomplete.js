// Slash-command autocomplete for the send box, modelled on SillyTavern's:
// suggests command names after "/", then named arguments ("name=") and
// declared enum values. ↑/↓ select, Tab/Enter accept, Esc closes,
// Ctrl+Space reopens. A details panel describes the selected suggestion.

import { SlashCommandParser } from './slash-commands/SlashCommandParser.js';

/**
 * @typedef {import('./slash-commands/SlashCommand.js').SlashCommand} SlashCommand
 * @typedef {import('./slash-commands/SlashCommandArgument.js').SlashCommandArgument} SlashCommandArgument
 * @typedef {import('./slash-commands/SlashCommandArgument.js').SlashCommandNamedArgument} SlashCommandNamedArgument
 *
 * @typedef {object} Option
 * @property {'command'|'namedArgument'|'enum'|'hint'} type
 * @property {string} icon
 * @property {string} label Text shown (and matched against)
 * @property {[number, number]|null} match Matched [start, length] within label
 * @property {string} insert Text that replaces the word being typed
 * @property {boolean} selectable False for the signature hint shown while typing arguments
 * @property {string} [description]
 * @property {SlashCommand} [command]
 * @property {SlashCommandArgument} [argument]
 */

// Named argument at the start of the arguments, followed by whitespace (so
// the one being typed isn't consumed). Unlike the parser, an unterminated
// "quote isn't taken as an unquoted value.
const COMPLETE_NAMED_ARG = /^([\w-]+)=(?:"((?:\\.|[^"\\])*)"|([^"\s]\S*|))\s+/;

/** @param {string} text */
function isCommandInput(text) {
    const trimmed = text.trimStart();
    return trimmed.startsWith('/') && !trimmed.startsWith('//');
}

/**
 * Case-insensitive match: prefix first, then substring.
 * @param {string} candidate
 * @param {string} query
 * @returns {{ score: number, start: number } | null}
 */
function matchText(candidate, query) {
    const index = candidate.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return null;
    return { score: index === 0 ? (candidate.length === query.length ? 0 : 1) : 2, start: index };
}

/** @param {string} html Help strings may contain HTML. */
function htmlToText(html) {
    return new DOMParser().parseFromString(String(html ?? ''), 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
}

/**
 * Help strings come from command declarations (trusted page code), but are
 * still cleaned of scripts and event handlers before display.
 * @param {string} html
 */
function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
    doc.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(el => el.remove());
    for (const el of doc.body.querySelectorAll('*')) {
        for (const attr of [...el.attributes]) {
            if (attr.name.startsWith('on') || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
        }
    }
    return doc.body.innerHTML;
}

/** @param {SlashCommandArgument} argument */
function typeText(argument) {
    return argument.typeList?.length ? argument.typeList.join('|') : 'string';
}

/**
 * Short argument summary, e.g. `app=string [sound=bool] (text)`.
 * @param {SlashCommand} command
 */
function signature(command) {
    const parts = command.namedArgumentList.map(arg => arg.isRequired ? `${arg.name}=${typeText(arg)}` : `[${arg.name}=${typeText(arg)}]`);
    for (const arg of command.unnamedArgumentList) {
        const text = `(${arg.description || typeText(arg)})`;
        parts.push(arg.isRequired ? text : `[${text}]`);
    }
    return parts.join(' ');
}

/**
 * Declared enum values of an argument (enumList, or enumProvider when it
 * works without SillyTavern's executor/scope).
 * @param {SlashCommandArgument} argument
 * @returns {{ value: string, description: string, icon: string }[]}
 */
function enumValues(argument) {
    let list = argument?.enumList ?? [];
    if (typeof argument?.enumProvider === 'function') {
        try {
            const provided = argument.enumProvider(null, null);
            if (Array.isArray(provided)) list = provided;
        } catch {
            // Providers written for SillyTavern may need context MiniTalk doesn't have.
        }
    }
    return list
        .filter(item => item !== null && item !== undefined)
        .map(item => typeof item === 'object'
            ? { value: String(item.value), description: item.description ? String(item.description) : '', icon: item.typeIcon || '◊' }
            : { value: String(item), description: '', icon: '◊' });
}

/**
 * Quotes a value if it contains whitespace or quotes.
 * @param {string} value
 */
function quoteIfNeeded(value) {
    return /[\s"|]/.test(value) ? `"${value.replace(/(["\\])/g, '\\$1')}"` : value;
}

/**
 * Works out what is being typed at the caret.
 * @param {string} text
 * @param {number} caret
 * @returns {{ options: Option[], start: number, end: number } | null}
 */
export function getSuggestions(text, caret) {
    if (!isCommandInput(text)) return null;

    // Start of the command the caret is in (after the last unquoted, unescaped |).
    let segmentStart = 0;
    let inQuotes = false;
    for (let i = 0; i < caret; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') inQuotes = !inQuotes;
        else if (text[i] === '|' && !inQuotes) segmentStart = i + 1;
    }
    const before = text.slice(segmentStart, caret);
    const leading = before.length - before.trimStart().length;
    const segment = before.slice(leading);
    const segmentOffset = segmentStart + leading;
    const wordAfterCaret = text.slice(caret).match(/^[^\s|]*/)[0].length;

    // Command name
    const nameMatch = segment.match(/^\/([^\s|"]*)$/);
    if (nameMatch) {
        return {
            options: commandOptions(nameMatch[1]),
            start: segmentOffset + 1,
            end: caret + wordAfterCaret,
        };
    }

    // Arguments
    const argsMatch = segment.match(/^\/([^\s|]+)\s+([\s\S]*)$/);
    const command = argsMatch && SlashCommandParser.commands[argsMatch[1]];
    if (!command) return null;

    let rest = argsMatch[2];
    const usedNames = new Set();
    let match;
    while ((match = rest.match(COMPLETE_NAMED_ARG))) {
        usedNames.add(match[1]);
        rest = rest.slice(match[0].length);
    }
    const restOffset = caret - rest.length;

    /** @type {Option[]} */
    let options = [];
    const valueMatch = rest.match(/^([\w-]+)=("?)((?:\\.|[^"\\])*)$/);
    if (valueMatch && (valueMatch[2] || !/\s/.test(valueMatch[3]))) {
        // Value of a named argument
        const [, name, quote, partial] = valueMatch;
        const argument = command.namedArgumentList.find(arg => arg.name === name || arg.aliasList?.includes(name));
        options = enumOptions(argument, partial.replace(/\\(.)/g, '$1'), value => `${quoteIfNeeded(value)} `);
        const closingQuote = quote && text[caret + wordAfterCaret] === '"' ? 1 : 0;
        if (options.length) {
            return { options, start: restOffset + name.length + 1, end: caret + wordAfterCaret + closingQuote };
        }
    } else if (/^[\w-]*$/.test(rest)) {
        // A new word: a named argument, or the start of the unnamed argument
        options = [
            ...namedArgumentOptions(command, rest, usedNames),
            ...enumOptions(command.unnamedArgumentList[0], rest, value => value),
        ];
    } else {
        // Inside the unnamed argument
        options = enumOptions(command.unnamedArgumentList[0], rest, value => value);
    }

    if (!options.length) {
        options = [hintOption(command, argsMatch[1])];
    }
    return { options, start: restOffset, end: caret + wordAfterCaret };
}

/** @param {string} query */
function commandOptions(query) {
    const commands = new Set(Object.values(SlashCommandParser.commands));
    const options = [];
    for (const command of commands) {
        // Match the name first, then aliases; insert whichever matched.
        let best = null;
        for (const name of [command.name, ...command.aliases]) {
            const result = matchText(name, query);
            if (result && (!best || result.score < best.result.score)) best = { name, result };
        }
        if (!best) continue;
        const label = best.name === command.name ? command.name : best.name;
        options.push({
            type: 'command',
            icon: '/',
            label,
            match: query ? [best.result.start, query.length] : null,
            insert: `${label} `,
            selectable: true,
            description: htmlToText(command.helpString),
            command,
            score: best.result.score,
        });
    }
    return options
        .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
        .map(({ score, ...option }) => option);
}

/**
 * @param {SlashCommand} command
 * @param {string} query
 * @param {Set<string>} usedNames
 * @returns {Option[]}
 */
function namedArgumentOptions(command, query, usedNames) {
    return command.namedArgumentList
        .filter(arg => !usedNames.has(arg.name) && !arg.aliasList?.some(alias => usedNames.has(alias)))
        .map(arg => ({ arg, result: matchText(arg.name, query) }))
        .filter(({ result }) => result)
        .sort((a, b) => a.result.score - b.result.score)
        .map(({ arg, result }) => ({
            type: 'namedArgument',
            icon: '⌗',
            label: `${arg.name}=`,
            match: query ? [result.start, query.length] : null,
            insert: `${arg.name}=`,
            selectable: true,
            description: htmlToText(arg.description),
            argument: arg,
        }));
}

/**
 * @param {SlashCommandArgument|undefined} argument
 * @param {string} query
 * @param {(value: string) => string} toInsert
 * @returns {Option[]}
 */
function enumOptions(argument, query, toInsert) {
    if (!argument) return [];
    return enumValues(argument)
        .map(item => ({ item, result: matchText(item.value, query) }))
        .filter(({ result }) => result)
        .sort((a, b) => a.result.score - b.result.score)
        .map(({ item, result }) => ({
            type: 'enum',
            icon: item.icon,
            label: item.value,
            match: query ? [result.start, query.length] : null,
            insert: toInsert(item.value),
            selectable: true,
            description: htmlToText(item.description),
            argument,
        }));
}

/**
 * The command's signature, shown while typing its arguments.
 * @param {SlashCommand} command
 * @param {string} typedName
 * @returns {Option}
 */
function hintOption(command, typedName) {
    return {
        type: 'hint',
        icon: '/',
        label: typedName,
        match: null,
        insert: '',
        selectable: false,
        description: htmlToText(command.helpString),
        command,
    };
}

/**
 * Attaches the autocomplete to a textarea.
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} container Positioned element the popup is placed above
 */
export function initSlashCommandAutocomplete(textarea, container) {
    const list = document.createElement('ul');
    list.id = 'slash_autocomplete';
    list.className = 'autoComplete';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    const details = document.createElement('div');
    details.className = 'autoComplete-details';
    details.hidden = true;
    container.append(details, list);

    textarea.setAttribute('aria-autocomplete', 'list');
    textarea.setAttribute('aria-controls', list.id);

    /** @type {{ options: Option[], start: number, end: number } | null} */
    let state = null;
    let selected = 0;
    // Esc keeps it closed until the text changes (or Ctrl+Space).
    let dismissed = false;

    function close() {
        state = null;
        list.hidden = true;
        details.hidden = true;
        textarea.setAttribute('aria-expanded', 'false');
        textarea.removeAttribute('aria-activedescendant');
    }

    function update() {
        if (dismissed || document.activeElement !== textarea) return close();
        const caret = textarea.selectionStart;
        if (caret !== textarea.selectionEnd) return close();
        const next = getSuggestions(textarea.value, caret);
        if (!next || !next.options.length) return close();

        // Keep the selection on the same entry while typing narrows the list.
        const previous = state?.options[selected]?.label;
        state = next;
        selected = Math.max(0, state.options.findIndex(option => option.label === previous));
        render();
    }

    function render() {
        list.replaceChildren(...state.options.map((option, index) => renderOption(option, index)));
        list.hidden = false;
        textarea.setAttribute('aria-expanded', 'true');
        select(selected);
    }

    /**
     * @param {Option} option
     * @param {number} index
     */
    function renderOption(option, index) {
        const item = document.createElement('li');
        item.className = 'item';
        item.id = `slash_autocomplete_${index}`;
        item.dataset.optionType = option.type;
        item.setAttribute('role', 'option');
        item.classList.toggle('not-selectable', !option.selectable);

        const type = document.createElement('span');
        type.className = 'type';
        type.textContent = option.icon;

        const specs = document.createElement('span');
        specs.className = 'specs';
        const name = document.createElement('span');
        name.className = 'name';
        if (option.type === 'command' || option.type === 'hint') name.append('/');
        if (option.match) {
            const [start, length] = option.match;
            const matched = document.createElement('span');
            matched.className = 'matched';
            matched.textContent = option.label.slice(start, start + length);
            name.append(option.label.slice(0, start), matched, option.label.slice(start + length));
        } else {
            name.append(option.label);
        }
        specs.append(name);
        if (option.command) {
            const args = document.createElement('span');
            args.className = 'arguments';
            args.textContent = signature(option.command);
            specs.append(args);
        }

        const help = document.createElement('span');
        help.className = 'help';
        help.textContent = option.description ?? '';

        item.append(type, specs, help);
        if (option.selectable) {
            item.addEventListener('click', () => accept(index));
        }
        item.addEventListener('mousemove', () => {
            if (selected !== index && option.selectable) select(index);
        });
        return item;
    }

    /** @param {number} index */
    function select(index) {
        selected = index;
        [...list.children].forEach((item, i) => item.classList.toggle('selected', i === index));
        const item = list.children[index];
        item?.scrollIntoView({ block: 'nearest' });
        if (item) textarea.setAttribute('aria-activedescendant', item.id);
        renderDetails(state.options[index]);
    }

    /** @param {Option} option */
    function renderDetails(option) {
        const parts = [];
        const head = document.createElement('div');
        head.className = 'specs';
        parts.push(head);

        if (option.command) {
            const command = option.command;
            const name = document.createElement('div');
            name.className = 'name';
            name.textContent = `/${command.name}`;
            const args = document.createElement('div');
            args.className = 'arguments';
            args.textContent = signature(command);
            head.append(name, args);
            if (command.returns) head.append(detailLine('returns', String(command.returns)));
            if (command.aliases.length) head.append(detailLine('aliases', command.aliases.map(a => `/${a}`).join(', ')));
            const argumentList = [...command.namedArgumentList, ...command.unnamedArgumentList];
            if (argumentList.length) {
                const ul = document.createElement('ul');
                ul.className = 'argumentList';
                for (const arg of argumentList) {
                    const li = document.createElement('li');
                    const label = /** @type {any} */ (arg).name ? `${/** @type {any} */ (arg).name}=` : '(unnamed)';
                    const flags = [typeText(arg), arg.isRequired ? 'required' : 'optional'];
                    if (arg.defaultValue !== null && arg.defaultValue !== undefined) flags.push(`default: ${arg.defaultValue}`);
                    li.append(Object.assign(document.createElement('code'), { textContent: label }), ` ${flags.join(', ')}`);
                    if (arg.description) li.append(Object.assign(document.createElement('div'), { className: 'argDescription', textContent: htmlToText(arg.description) }));
                    ul.append(li);
                }
                parts.push(ul);
            }
            if (command.helpString) {
                const help = document.createElement('div');
                help.className = 'helpString';
                help.innerHTML = sanitizeHtml(command.helpString);
                parts.push(help);
            }
        } else {
            const name = document.createElement('div');
            name.className = 'name';
            name.textContent = option.label;
            head.append(name);
            if (option.type === 'namedArgument') {
                const arg = /** @type {SlashCommandNamedArgument} */ (option.argument);
                head.append(detailLine('type', typeText(arg)), detailLine('', arg.isRequired ? 'required' : 'optional'));
                if (arg.defaultValue !== null && arg.defaultValue !== undefined) head.append(detailLine('default', String(arg.defaultValue)));
            }
            if (option.description) {
                parts.push(Object.assign(document.createElement('div'), { className: 'helpString', textContent: option.description }));
            }
        }
        details.replaceChildren(...parts);
        details.hidden = false;
    }

    /**
     * @param {string} label
     * @param {string} value
     */
    function detailLine(label, value) {
        const line = document.createElement('div');
        line.className = 'detailLine';
        line.textContent = label ? `${label}: ${value}` : value;
        return line;
    }

    /** @param {number} index */
    function accept(index) {
        const option = state?.options[index];
        if (!option?.selectable) return;
        textarea.focus();
        textarea.setRangeText(option.insert, state.start, state.end, 'end');
        // Lets autosize and this module react, which shows the next suggestions.
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /** True if accepting the option would change nothing (e.g. the full command name is typed). */
    function isAlreadyTyped(option) {
        return textarea.value.slice(state.start, state.end) === option.insert.trimEnd();
    }

    textarea.addEventListener('keydown', (event) => {
        if (event.key === ' ' && event.ctrlKey) {
            event.preventDefault();
            dismissed = false;
            update();
            return;
        }
        if (!state || event.isComposing) return;

        const option = state.options[selected];
        const selectable = state.options.some(o => o.selectable);
        let handled = true;
        if (event.key === 'Escape') {
            dismissed = true;
            close();
            event.stopPropagation(); // don't also trigger page-level Esc handling
        } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && selectable && !event.altKey) {
            const step = event.key === 'ArrowDown' ? 1 : -1;
            let next = selected;
            do {
                next = (next + step + state.options.length) % state.options.length;
            } while (!state.options[next].selectable);
            select(next);
        } else if (event.key === 'Tab' && !event.shiftKey && option?.selectable) {
            accept(selected);
        } else if (event.key === 'Enter' && !event.shiftKey && option?.selectable && !isAlreadyTyped(option)) {
            accept(selected);
        } else {
            handled = false;
        }
        if (handled) {
            // Also stops the send box's Enter-to-send handler.
            event.preventDefault();
            event.stopImmediatePropagation();
        } else if (event.key === 'Enter') {
            close();
        }
    }, { capture: true });

    textarea.addEventListener('input', () => {
        dismissed = false;
        update();
    });
    textarea.addEventListener('click', update);
    textarea.addEventListener('keyup', (event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) update();
    });
    textarea.addEventListener('blur', close);
    // Clicking the popup must not take focus from the textarea.
    for (const element of [list, details]) {
        element.addEventListener('mousedown', event => event.preventDefault());
    }
}
