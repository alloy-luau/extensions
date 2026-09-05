# Alloy for Zed

Syntax highlighting and the language server for `.aly` and `.alx`
files. Alloy is a superset of Luau, so the Luau tree-sitter grammar
colors the shared part; the language server covers the rest: hover,
completion, diagnostics, the lints, and the rewrites.

## Install

1. Put `alloy` and `alloy-lsp` on the PATH: `alloy self install`, or
   a release zip.
2. In Zed, open Extensions, choose Install Dev Extension, and pick
   this folder.

## Settings

```json
{
  "lsp": {
    "alloy-lsp": {
      "binary": { "path": "/home/me/.alloy/bin/alloy-lsp" },
      "initialization_options": {
        "luauLspPath": "/home/me/.ember/bin/luau-lsp",
        "definitions": ["types/globalTypes.d.luau"]
      }
    }
  }
}
```

Every key is optional. With none, the server comes from the PATH and
finds `luau-lsp` there too.
