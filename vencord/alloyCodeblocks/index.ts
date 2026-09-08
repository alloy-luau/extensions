/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Andrew
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { hljs, requireHljs } from "@plugins/shikiCodeblocks.desktop/utils/misc";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";

import { alloy, alx } from "./hljs";
import { registerShikiLanguages, unregisterShikiLanguages } from "./shiki";

const logger = new Logger("AlloyCodeblocks");

export default definePlugin({
    name: "AlloyCodeblocks",
    description: "Highlights Alloy (aly, alx, d.aly) in codeblocks, in Discord's highlighter and in ShikiCodeblocks",
    authors: [{ name: "Andrew", id: 0n }],
    tags: ["Chat", "Appearance"],

    async start() {
        registerShikiLanguages();

        // Discord loads highlight.js in a lazy chunk. Registration before
        // that chunk exists throws, so the plugin loads the chunk first.
        try {
            await requireHljs();
            hljs.registerLanguage("alloy", alloy);
            hljs.registerLanguage("alx", alx);
        } catch (e) {
            logger.error("Failed to register the highlight.js languages", e);
        }
    },

    stop() {
        unregisterShikiLanguages();
        try {
            hljs.unregisterLanguage("alloy");
            hljs.unregisterLanguage("alx");
        } catch (e) {
            logger.error("Failed to unregister the highlight.js languages", e);
        }
    },
});
