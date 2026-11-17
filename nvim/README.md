# Alloy for Neovim

Syntax highlighting and the language server for `.aly` and `.alx`
files. The plugin needs Neovim 0.11 or later and no other plugin.

The plugin gives two layers of color:

- A syntax file colors the whole buffer from the words alone: every
  keyword of Luau and of Alloy, strings, numbers, comments, calls, and
  type names. It needs no parser, so no construct is left plain.
- The language server sends semantic tokens. Neovim draws them over the
  syntax file when the server attaches.

The Luau tree-sitter grammar is a third layer, off by default. It cannot
parse a `struct`, a `private` member, or `-> T`, and it colors a keyword
as a plain name in the part it gives up on. Set
`vim.g.alloy_treesitter = true` before the plugin loads to draw it over
the syntax file.

An Alloy buffer indents with two spaces, the layout `alloy fmt` writes.

The language server also gives hover, completion, diagnostics, the
lints, and the rewrites.

## Install

1. Put `alloy` and `alloy-lsp` on the PATH: `alloy self install`, or
   a release zip.
2. Clone this repository:

   ```sh
   git clone https://github.com/alloy-luau/extensions ~/.local/share/alloy-extensions
   ```

3. Add the `nvim` folder to the runtime path in `init.lua`:

   ```lua
   local alloy = vim.fn.expand("~/.local/share/alloy-extensions/nvim")
   vim.opt.runtimepath:prepend(alloy)
   vim.opt.runtimepath:append(alloy .. "/after")
   ```

4. Optional, for `vim.g.alloy_treesitter`: get a Luau parser. Use one of
   these:

   - Run `sh ~/.local/share/alloy-extensions/nvim/build.sh`. It needs
     `git` and a C compiler, and writes `parser/luau.so` in the plugin.
   - With nvim-treesitter, run `:TSInstall luau`.

Open a `.aly` file and run `:checkhealth vim.lsp`. The report shows the
`alloy_lsp` client.

## Settings

The plugin takes every setting of the VS Code extension, under the same
name without the `alloy-luau.` prefix. Set them in one table before the
first Alloy file opens. A key the table leaves out keeps its default.

```lua
vim.g.alloy = {
  sourcemap = { autogenerate = true },
  rig = "R6",
  fflags = { override = { AlloyNativeIfLocal = true } },
}
```

| Setting | Default | What it does |
| --- | --- | --- |
| `server.path` | `""` | The alloy-lsp binary. Empty means `~/.alloy/bin/alloy-lsp`, then PATH. |
| `server.args` | `{}` | Extra arguments for alloy-lsp. |
| `server.luauLspPath` | `""` | The luau-lsp binary. Empty means the one a VS Code luau-lsp extension ships, then PATH. |
| `server.logLevel` | `"warn"` | What alloy-lsp writes to its log: `off`, `error`, `warn`, `info`, `debug`, `trace`. |
| `trace.server` | `"off"` | The trace the client asks for: `off`, `messages`, `verbose`. |
| `types.definitionFiles` | `{}` | Declaration files whose globals every file sees. A relative path reads from the project root. |
| `inlayHints.variableTypes` | `true` | The type of a variable. |
| `inlayHints.parameterTypes` | `true` | The type of an untyped parameter. |
| `inlayHints.functionReturnTypes` | `true` | The return type of a function. |
| `inlayHints.parameterNames` | `"literals"` | Parameter names at a call: `none`, `literals`, `all`. |
| `inlayHints.makeInsertable` | `true` | Sent to the server. Neovim has no click that writes a hint. |
| `autoEnd` | `true` | Enter after a line that opens a block writes its `end`, with the cursor between. |
| `autoCloseTags` | `true` | In a `.alx` file, `>` after an opening tag writes the closing tag. |
| `autoCloseParens` | `true` | `(`, `[`, and `{` write their closing character. Neovim only. A key that already has an insert mapping keeps it. |
| `hideRobloxDeprecated` | `false` | Leave members the Roblox API marks deprecated out of completion. |
| `hideAllDeprecated` | `false` | Leave out what the source marks `@deprecated` too. |
| `arrowReturnHints` | `false` | Show a return type hint as `-> T`. |
| `rig` | unset | `R15` or `R6`. Unset, `[roblox] rig` in alloy.toml decides. |
| `sourcemap.file` | `"sourcemap.json"` | The sourcemap the server reads, from the project root. |
| `sourcemap.autogenerate` | `false` | Run the generator command on each save of a script. |
| `sourcemap.generatorCommand` | `"rojo sourcemap --output ${sourcemapFile}"` | The command that writes the sourcemap, run in the project root. |
| `studioPlugin.enabled` | `false` | Accept the luau-lsp Studio companion plugin. |
| `studioPlugin.port` | `3668` | The port the Studio plugin connects to. |
| `fflags.enableByDefault` | `true` | Turn on every boolean Luau flag in the server. |
| `fflags.sync` | `true` | Use the Luau flags Roblox publishes for Studio. |
| `fflags.enableNewSolver` | `true` | Run the new type solver, which Alloy's emitted code needs. |
| `fflags.override` | `{}` | Flags set last, by name. An `Alloy` name is a flag of Alloy; the rest go to luau-lsp. |

`luauLsp` takes a whole luau-lsp settings table and passes it to the
child, as the `luau-lsp` section does in VS Code.

Three things differ from VS Code:

- A change to `vim.g.alloy` takes effect on `:AlloyRestartServer`.
- `fflags.sync` reads the flags the last session saved, and saves new
  ones in the background, so no start waits on the network. The first
  session has none.
- A project that `alloy build` gave `.alloy/sourcemap.json` needs no
  generator, and `sourcemap.autogenerate` does nothing there.

`autoCloseParens` reads its value at each key, so a change to it needs
no restart.

The server asks for a completion list after a space in two places: a
name list of an `import`, and the arguments of an attribute. blink.cmp
does not ask after a space by default. This lets it ask in an Alloy
buffer. It also leaves buffer words out there: blink.cmp shows them as
"text" rows where the server has no answer.

```lua
require("blink.cmp").setup({
  completion = {
    trigger = {
      show_on_blocked_trigger_characters = function()
        return vim.bo.filetype == "alloy" and { "\n", "\t" } or { " ", "\n", "\t" }
      end,
    },
  },
  sources = {
    default = { "lsp", "path", "buffer" },
    per_filetype = { alloy = { "lsp", "path" } },
  },
})
```

The plugin has two commands: `:AlloyRestartServer` and
`:AlloyGenerateSourcemap`.

Three older switches still work: `vim.g.alloy_roblox = false` leaves out
the Roblox types, `vim.g.alloy_lsp = false` leaves the server to you, and
`vim.g.alloy_treesitter = true` adds the Luau grammar.

## File icons

With nvim-web-devicons, the plugin shows the Alloy icons for `.aly`,
`.alx`, `.d.aly`, `.config.aly`, and `alloy.toml`. A terminal draws text
only, so the icons are glyphs in `font/alloy-icons.ttf`.

1. Copy `font/alloy-icons.ttf` to `~/.local/share/fonts` and run
   `fc-cache -f`.
2. Tell the terminal to use the font for the icon code points. For
   kitty, add this line to `kitty.conf`:

   ```
   symbol_map U+100000-U+100003 Alloy Icons
   ```

`font/build.py` makes the font again from the PNG icons of the VS Code
extension.

## The server command

`server.path`, `server.luauLspPath`, and `server.args` cover most
changes to the command. To replace the whole command, set it before the
first Alloy file opens:

```lua
vim.lsp.config("alloy_lsp", {
  cmd = {
    "/home/me/.alloy/bin/alloy-lsp",
    "--luau-lsp", "/home/me/.ember/bin/luau-lsp",
    "--definitions", "types/globalTypes.d.luau",
  },
})
```

Set `vim.g.alloy_lsp = false` before the plugin loads to start the
server yourself.

## Limits

Alloy has no tree-sitter grammar of its own. The Luau grammar reads
syntax that only Alloy has as an error, and the semantic tokens of the
server color that part.
