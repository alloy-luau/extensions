//! The Zed extension for Alloy. It starts `alloy-lsp` from the PATH,
//! or from the `alloy-luau.server.path` setting, and passes the
//! `--luau-lsp`, `--definitions`, and `--docs` arguments the settings
//! name. The binaries come from `alloy self install` or a release zip.

use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

struct AlloyExtension;

impl zed::Extension for AlloyExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree).ok();
        let (binary, init) = match settings {
            Some(s) => (s.binary, s.initialization_options),

            None => (None, None),
        };
        let (path, arguments) = match binary {
            Some(b) => (b.path, b.arguments),

            None => (None, None),
        };
        let mut args: Vec<String> = arguments.unwrap_or_default();
        let command = match path {
            Some(path) => path,

            None => worktree.which("alloy-lsp").ok_or_else(|| {
                "alloy-lsp is not on the PATH; run `alloy self install`, or set lsp.alloy-lsp.binary.path in settings".to_string()
            })?,
        };

        // Settings of the shape the VS Code extension takes:
        // `{ "luauLspPath": ..., "definitions": [...], "docs": ... }`.
        if let Some(init) = init {
            if let Some(path) = init.get("luauLspPath").and_then(|v| v.as_str()) {
                args.push("--luau-lsp".to_string());
                args.push(path.to_string());
            }

            for file in init
                .get("definitions")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str())
            {
                args.push("--definitions".to_string());
                args.push(file.to_string());
            }

            if let Some(docs) = init.get("docs").and_then(|v| v.as_str()) {
                args.push("--docs".to_string());
                args.push(docs.to_string());
            }
        }

        Ok(zed::Command {
            command,
            args,
            env: Vec::new(),
        })
    }
}

zed::register_extension!(AlloyExtension);
