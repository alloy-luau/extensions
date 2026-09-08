/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Andrew
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type Language, languages, resolveLang } from "@plugins/shikiCodeblocks.desktop/api/languages";
import { shiki } from "@plugins/shikiCodeblocks.desktop/api/shiki";

import alxGrammar from "./grammars/alx.tmLanguage.json";
import alyGrammar from "./grammars/aly.tmLanguage.json";
import dalyGrammar from "./grammars/daly.tmLanguage.json";

type Grammar = NonNullable<Language["grammar"]>;

// The grammars link to ../vscode/syntaxes, so there is one copy. An inline
// grammar skips the fetch that ShikiCodeblocks does for its own list.
const alloyLanguages: Language[] = [
    {
        id: "aly",
        name: "Alloy",
        scopeName: "source.aly",
        aliases: ["alloy"],
        grammarUrl: "",
        grammar: alyGrammar as unknown as Grammar,
        custom: true,
    },
    {
        id: "d.aly",
        name: "Alloy Declaration",
        scopeName: "source.d.aly",
        aliases: ["daly", "alloy-declaration"],
        grammarUrl: "",
        grammar: dalyGrammar as unknown as Grammar,
        custom: true,
    },
    {
        id: "alx",
        name: "Alloy JSX",
        scopeName: "source.alx",
        aliases: ["alloy-jsx"],
        grammarUrl: "",
        grammar: alxGrammar as unknown as Grammar,
        custom: true,
    },
];

// The Shiki worker resolves `include: "source.aly"` only through a
// language it has already loaded. These languages load before the key.
const loadFirst: Record<string, string[]> = {
    "d.aly": ["aly"],
    alx: ["aly"],
};

let originalLoadLang: typeof shiki.loadLang | null = null;

export function registerShikiLanguages() {
    for (const lang of alloyLanguages) languages[lang.id] = lang;

    if (originalLoadLang) return;
    originalLoadLang = shiki.loadLang;
    const loadLang = originalLoadLang;

    shiki.loadLang = async (langId: string) => {
        const id = resolveLang(langId)?.id ?? langId;
        for (const dep of loadFirst[id] ?? []) await loadLang(dep);
        return loadLang(langId);
    };
}

export function unregisterShikiLanguages() {
    for (const lang of alloyLanguages) delete languages[lang.id];

    if (originalLoadLang) {
        shiki.loadLang = originalLoadLang;
        originalLoadLang = null;
    }
}
