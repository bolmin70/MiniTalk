// Bare-bones version of SillyTavern's SlashCommandArgument.js: same exports and
// constructor/fromProps signatures, so V2 declarations load unchanged.
// Only `description`, `isRequired` and `defaultValue` (and `name` for named
// arguments) affect execution; the rest is kept as metadata for later
// (help, autocomplete, type checking). Values always reach callbacks as strings.

export const ARGUMENT_TYPE = {
    'STRING': 'string',
    'NUMBER': 'number',
    'RANGE': 'range',
    'BOOLEAN': 'bool',
    'VARIABLE_NAME': 'varname',
    'CLOSURE': 'closure',
    'SUBCOMMAND': 'subcommand',
    'LIST': 'list',
    'DICTIONARY': 'dictionary',
};

export class SlashCommandArgument {
    /**
     * @param {{ description?: string, typeList?: string|string[], isRequired?: boolean, acceptsMultiple?: boolean, defaultValue?: any, enumList?: any[], enumProvider?: Function, forceEnum?: boolean }} props
     */
    static fromProps(props) {
        return new SlashCommandArgument(
            props.description,
            props.typeList,
            props.isRequired,
            props.acceptsMultiple,
            props.defaultValue,
            props.enumList,
            props.enumProvider,
            props.forceEnum,
        );
    }

    constructor(description, types, isRequired = false, acceptsMultiple = false, defaultValue = null, enums = [], enumProvider = null, forceEnum = false) {
        this.description = description ?? '';
        this.typeList = types ? [types].flat() : [];
        this.isRequired = isRequired ?? false;
        this.acceptsMultiple = acceptsMultiple ?? false;
        this.defaultValue = defaultValue ?? null;
        this.enumList = enums ?? [];
        this.enumProvider = enumProvider ?? null;
        this.forceEnum = forceEnum ?? false;
    }
}

export class SlashCommandNamedArgument extends SlashCommandArgument {
    /**
     * @param {{ name: string, description?: string, typeList?: string|string[], isRequired?: boolean, acceptsMultiple?: boolean, defaultValue?: any, enumList?: any[], aliasList?: string[], enumProvider?: Function, forceEnum?: boolean }} props
     */
    static fromProps(props) {
        return new SlashCommandNamedArgument(
            props.name,
            props.description,
            props.typeList,
            props.isRequired,
            props.acceptsMultiple,
            props.defaultValue,
            props.enumList,
            props.aliasList,
            props.enumProvider,
            props.forceEnum,
        );
    }

    constructor(name, description, types, isRequired = false, acceptsMultiple = false, defaultValue = null, enums = [], aliases = [], enumProvider = null, forceEnum = false) {
        super(description, types, isRequired, acceptsMultiple, defaultValue, enums, enumProvider, forceEnum);
        this.name = name;
        this.aliasList = aliases ?? [];
    }
}
