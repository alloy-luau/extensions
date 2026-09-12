/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Andrew
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// highlight.js definitions for Alloy and Alloy JSX. Discord renders a
// codeblock with highlight.js when ShikiCodeblocks is off, or when its
// "Try Highlight.js" setting says so. The rules follow the TextMate
// grammars in ../../vscode/syntaxes.

import type { HLJSApi, Language, Mode } from "highlight.js";

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/;

const CONTROL = "if then elseif else end for in while do repeat until return break continue with as case default await where after";
const STORAGE = "local function async macro struct trait impl enum interface extends type import from remote declare extern class attribute on";
const WORD_OPERATORS = "and or not band bor bxor bnot shl shr satisfies is";

// `new`, `delete`, `destroy`, and the five words Luau also allows as a
// name, `export`, `try`, `match`, `const`, are contextual: `Vector3.new`
// is a field and `local try = pcall` is a local. A mode with a lookahead
// handles them, so they stay out of this table.
const KEYWORDS = {
    $pattern: "[A-Za-z_][A-Za-z0-9_]*",
    keyword: `${CONTROL} ${STORAGE} ${WORD_OPERATORS}`,
    literal: "nil true false",
    built_in: [
        "self",
        "Future Result Ok Err Array HashMap Set Symbol Attributes",
        "table string math os task coroutine bit32 utf8 buffer debug vector",
        "game workspace script plugin",
        "print warn error assert pcall xpcall require tostring tonumber typeof",
        "ipairs pairs next select setmetatable getmetatable rawget rawset rawequal rawlen unpack",
    ].join(" "),
};

// The words a call shape never names. A contextual word is absent: it is
// the name in `match(s, p)`, so that line colours as the call it is.
const ALL_KEYWORDS = `${CONTROL} ${STORAGE} ${WORD_OPERATORS} delete destroy`.split(" ").join("|");

export function alloy(hljs: HLJSApi): Language {
    const COMMENTS: Mode[] = [
        { className: "meta", begin: /--!\w+.*$/ },
        hljs.COMMENT(/--\[=*\[/, /\]=*\]/),
        hljs.COMMENT(/--/, /$/),
    ];

    const SUBST: Mode = {
        className: "subst",
        begin: /\{/,
        end: /\}/,
        keywords: KEYWORDS,
    };

    const STRING: Mode = {
        className: "string",
        variants: [
            { begin: /"/, end: /"/, contains: [hljs.BACKSLASH_ESCAPE] },
            { begin: /'/, end: /'/, contains: [hljs.BACKSLASH_ESCAPE] },
            { begin: /`/, end: /`/, contains: [hljs.BACKSLASH_ESCAPE, SUBST] },
            { begin: /\[=*\[/, end: /\]=*\]/ },
        ],
    };

    const NUMBER: Mode = {
        className: "number",
        relevance: 0,
        variants: [
            { begin: /\b0[xX][0-9A-Fa-f_]+\b/ },
            { begin: /\b0[bB][01_]+\b/ },
            { begin: /\b\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?\b/ },
        ],
    };

    const ATTRIBUTE: Mode = { className: "meta", begin: /@[A-Za-z_][A-Za-z0-9_]*/ };

    const MACRO_CALL: Mode = { className: "title", begin: /\$[A-Za-z_][A-Za-z0-9_.]*(?=[([])/ };

    // Type positions. The content rules nest through TYPE_CONTENT, which
    // fills after the groups that refer to it exist.
    const TYPE_CONTENT: Mode[] = [];
    const typeGroup = (open: RegExp, close: RegExp): Mode => ({ begin: open, end: close, contains: TYPE_CONTENT });

    TYPE_CONTENT.push(
        ...COMMENTS,
        STRING,
        { className: "number", begin: /-?\b\d[\d_]*(?:\.\d+)?\b/, relevance: 0 },
        { className: "keyword", begin: /\b(?:keyof|typeof|in|read|write)\b/ },
        { className: "built_in", begin: /\b(?:string|number|boolean|nil|any|unknown|never|thread|buffer|table|vector|true|false|self|index|rawget|setmetatable)\b/ },
        { begin: /->/ },
        { className: "attr", begin: /\b[A-Za-z_][A-Za-z0-9_]*(?=\s*:(?!:))/, relevance: 0 },
        typeGroup(/\{/, /\}/),
        typeGroup(/\(/, /\)/),
        typeGroup(/</, />/),
        typeGroup(/\[/, /\]/),
        { className: "type", begin: /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\b/, relevance: 0 },
    );

    const TYPE_END = /(?=[=,;)\]}>]|\b(?:then|do|end|with|from|in|return|local|const|if|for|while|repeat|until)\b|$)/;

    const TYPE_POSITION: Mode = {
        contains: TYPE_CONTENT,
        variants: [
            // `x: T`. A space after the colon separates it from `a:b()`.
            {
                begin: /(?<!\s):(?!:)(?=\s+(?:[A-Za-z_({<'"`]|\.\.\.|-?\d))(?!\s*[A-Za-z_][A-Za-z0-9_.]*\s*[({"'`])/,
                end: TYPE_END,
            },
            // `expr :: T`
            { begin: /::/, end: TYPE_END },
            // `) -> T`
            {
                begin: /(?<=\))\s*->/,
                end: /(?=\b(?:then|do|end|with|from|return|local|const|if|for|while|repeat|until)\b|$)/,
            },
        ],
    };

    const keywordOnly = (words: RegExp): Mode => ({ className: "keyword", begin: words });
    const title = (name: RegExp): Mode => ({ className: "title", begin: name, endsParent: true, relevance: 0 });

    // `type Name<T> = ...`: the right side is a type.
    const TYPE_ALIAS: Mode = {
        begin: /\btype\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*<[^>]*>)?\s*=/,
        returnBegin: true,
        end: /$/,
        contains: [
            keywordOnly(/\btype\b/),
            { className: "title", begin: IDENT, relevance: 0 },
            typeGroup(/</, />/),
            { begin: /=/, endsWithParent: true, contains: TYPE_CONTENT },
        ],
    };

    // `struct Name`, `enum Name`, `new Name`, `remote function Name`, ...
    const DECLARATION: Mode = {
        begin: /\b(?:struct|enum|trait|interface|macro|attribute|impl|new|remote(?:\s+function)?|type(?:\s+function)?)\s+[A-Za-z_][A-Za-z0-9_]*/,
        returnBegin: true,
        end: /$/,
        contains: [
            keywordOnly(/\b(?:struct|enum|trait|interface|macro|attribute|impl|new|remote|type|function)\b/),
            title(IDENT),
        ],
    };

    const FUNCTION: Mode = {
        begin: /\bfunction\s+[A-Za-z_][A-Za-z0-9_.:]*\s*(?=[(<])/,
        returnBegin: true,
        end: /(?=[(<])/,
        contains: [
            keywordOnly(/\bfunction\b/),
            title(/[A-Za-z_][A-Za-z0-9_.:]*/),
        ],
    };

    // `function name<T: Bound>(`
    const GENERIC_PARAMS: Mode = {
        begin: /(?<=\bfunction\s+[A-Za-z_][A-Za-z0-9_.:]*\s*)</,
        end: />/,
        contains: TYPE_CONTENT,
    };

    // `f<<T>>(`
    const INSTANTIATION: Mode = { begin: /<<(?=[A-Za-z_])/, end: />>/, contains: TYPE_CONTENT };

    const CONTEXTUAL_KEYWORDS: Mode = {
        className: "keyword",
        variants: [
            { begin: /\b(?:read|write)\b(?=\s+[A-Za-z_({[])/ },
            { begin: /\b(?:private|public)\b(?=\s+(?:function|async|read|write|[A-Za-z_]))/ },
            { begin: /\b(?:delete|destroy)\b(?=\s+[A-Za-z_])/ },
            // `new Thing()` constructs; `new(x)` and `new = 1` are a local.
            { begin: /(?<![.:])\bnew\b(?=[ \t]+(?!(?:end|then|else|elseif|do|until|and|or|not|in|is|as|satisfies|where|return|local|const|break|continue)\b)[A-Za-z_])/ },
            // `try f()` and `try do`; `try(f)` and `try = 1` are a local.
            { begin: /(?<![.:])\btry\b(?=[ \t]+(?:do\b|(?!(?:end|then|else|elseif|do|until|and|or|not|in|is|as|satisfies|where|return|local|const|break|continue)\b)[A-Za-z_$#]|[0-9]|-[^-]))/ },
            // `match x with`; `match(s, p)` and `match[k]` are a local.
            { begin: /(?<![.:])\bmatch\b(?=[ \t]+(?:(?!(?:end|then|else|elseif|do|until|and|or|not|in|is|as|satisfies|where|return|local|const|break|continue)\b)[A-Za-z_${[]|[0-9]|#|-[^-]))/ },
            // `const LIMIT = 5`; `const = 1` and `const(x)` are a local.
            { begin: /(?<![.:])\bconst\b(?=[ \t]+(?:function\b|async[ \t]+function\b|@|[A-Za-z_]|\[|\{))/ },
            // `export type T`; `export = t` and `export.f` are a local.
            { begin: /(?<![.:])\bexport\b(?=[ \t]*\{|[ \t]+(?:type|default|local|const|function|class|open|async|global|enum|struct|trait|interface|remote|attribute|macro|namespace|impl)\b)/ },
        ],
    };

    const CALL: Mode = {
        className: "title",
        begin: new RegExp(`\\b(?!(?:${ALL_KEYWORDS})\\b)[A-Za-z_][A-Za-z0-9_]*(?=\\s*[({"'\`])`),
        relevance: 0,
    };

    // A name after `.` or `:` is a field or a method, whatever its case.
    const PROPERTY: Mode = { begin: /(?<=[.:])(?<!\.\.)[A-Za-z_][A-Za-z0-9_]*/, relevance: 0 };

    const TYPE_NAME: Mode = { className: "type", begin: /\b[A-Z][A-Za-z0-9_]*\b/, relevance: 0 };

    const CONTAINS: Mode[] = [
        ...COMMENTS,
        STRING,
        NUMBER,
        ATTRIBUTE,
        MACRO_CALL,
        TYPE_ALIAS,
        DECLARATION,
        FUNCTION,
        GENERIC_PARAMS,
        INSTANTIATION,
        TYPE_POSITION,
        CONTEXTUAL_KEYWORDS,
        CALL,
        PROPERTY,
        TYPE_NAME,
    ];
    SUBST.contains = CONTAINS;

    return {
        name: "Alloy",
        aliases: ["aly", "d.aly", "daly"],
        keywords: KEYWORDS,
        contains: CONTAINS,
    };
}

export function alx(hljs: HLJSApi): Language {
    const base = alloy(hljs);

    const XML_COMMENT = hljs.COMMENT(/<!--/, /-->/);

    // `{ expr }`: Alloy inside, markup allowed again. The content list
    // fills after TAG exists.
    const HOLE_CONTENT: Mode[] = [];
    const HOLE: Mode = { begin: /\{/, end: /\}/, keywords: KEYWORDS, contains: HOLE_CONTENT };

    const ATTR: Mode = { className: "attr", begin: /[A-Za-z_][A-Za-z0-9_.:-]*/, relevance: 0 };
    const ATTR_VALUE: Mode = {
        begin: /=\s*/,
        relevance: 0,
        contains: [
            { ...HOLE, endsParent: true },
            {
                className: "string",
                endsParent: true,
                variants: [
                    { begin: /"/, end: /"/ },
                    { begin: /'/, end: /'/ },
                    { begin: /`/, end: /`/ },
                ],
            },
        ],
    };

    // `<Name attr={x}>`, `</Name>`, `<Name />`, `<>`, `</>`
    const TAG: Mode = {
        className: "tag",
        begin: /<\/?(?=[A-Za-z_>])/,
        end: /\/?>/,
        contains: [
            {
                className: "name",
                begin: /[A-Za-z_][A-Za-z0-9_.:]*/,
                relevance: 0,
                starts: {
                    endsWithParent: true,
                    contains: [XML_COMMENT, ATTR_VALUE, ATTR, HOLE],
                },
            },
        ],
    };

    HOLE_CONTENT.push(XML_COMMENT, TAG, HOLE, ...base.contains);

    return {
        name: "Alloy JSX",
        aliases: ["alloy-jsx"],
        keywords: KEYWORDS,
        contains: [XML_COMMENT, TAG, HOLE, ...base.contains],
    };
}
