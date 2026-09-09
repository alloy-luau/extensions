# Alloy for VS Code

Language support for Alloy (`.aly`) and Alloy JSX (`.alx`).

The extension starts `alloy-lsp` and speaks the Language Server Protocol to
it. It looks in `~/.alloy/bin` first, where `alloy self install` puts the
server, then on `PATH`. Set `alloy-luau.server.path` for another location.
The server runs `luau-lsp` as a child: `alloy-luau.server.luauLspPath` when
set, else the binary of the luau-lsp extension when it is installed, else
the one on `PATH`. The `bin` directories of `~/.alloy`, `~/.ember`,
`~/.rokit`, `~/.aftman`, `~/.foreman`, `~/.cargo`, and `~/.local` join the
server's PATH, because a VS Code started from a desktop launcher does not
read the shell profile.

## Types

The Roblox globals come from the same files the luau-lsp extension
downloads: `globalTypes.<securityLevel>.d.luau` and `api-docs.json`. The
extension uses that download when it exists, else it downloads its own copy
once. `luau-lsp.types.roblox.securityLevel` picks the level and
`luau-lsp.platform.type` set to `standard` turns the globals off.
`luau-lsp.types.definitionFiles` and `alloy-luau.types.definitionFiles` add
more files.

## Flags

The server passes Luau flags to luau-lsp the way the luau-lsp extension
does, under `alloy-luau.fflags`: `enableByDefault` turns every boolean
flag on (default true), `sync` reads the flags Roblox publishes for
Studio (default true), `enableNewSolver` keeps the new type solver on
(default true; Alloy's emitted code needs it), and `override` sets
single flags last. A change restarts the server.

## Typing helpers

Two settings write the closing half of a pair while you type. Both are on
by default.

`alloy-luau.autoEnd` offers the `end` of a block after Enter. The line
that opens the block decides the indentation, and the cursor lands on the
empty line between the two: `function`, `if`, `for`, `while`, `do`,
`repeat`, `struct`, `enum`, `interface`, `trait`, `impl`, `macro`, and
`match`.

`alloy-luau.autoCloseTags` writes the closing tag of a `.alx` element
after the `>` that ends the opening tag, and leaves the cursor between
the two. A self-closing tag, a closing tag, a `>` in a string or a `{ }`
hole, and an element that already closes get nothing. VS Code sends the
request only with `editor.formatOnType` on, which this extension turns on
for Alloy files.

## Commands

- `Alloy: Restart Language Server`

## Sourcemap

`alloy-luau.sourcemap.file` is the sourcemap the server reads, relative to
the project root; `sourcemap.json` by default. With
`alloy-luau.sourcemap.autogenerate` on, every save of a script runs
`alloy-luau.sourcemap.generatorCommand` in the root, which defaults to
`rojo sourcemap --output ${sourcemapFile}`, so the file setting decides the
output. `Alloy: Generate Sourcemap` runs it once.

## Studio plugin

`alloy-luau.studioPlugin.enabled` lets the luau-lsp Studio companion plugin
connect to the Alloy server, so the DataModel tree types `game` requires
and instance paths in Alloy files. It is off by default: the luau-lsp
extension's own server may hold the port. `alloy-luau.studioPlugin.port`
picks the port, 3667 by default; use another when both servers listen.

## Logs

The server writes to the `Alloy` output channel. `alloy-luau.server.logLevel`
picks how much: `off`, `error`, `warn` (the default), `info`, `debug`, or
`trace`. `alloy-luau.trace.server` traces the messages between VS Code and
the server from the client side.

## alloy.toml

The project file is plain TOML. Install Even Better TOML
(`tamasfe.even-better-toml`): it completes every table and key of
`alloy.toml` from a JSON Schema, shows the type, the default, and the
text of each one, and marks a key the compiler rejects. The schema ships
with this extension in `schemas/alloy.toml.json` and is registered
through Even Better TOML's `tomlValidation` contribution point, which
takes an absolute URL, so the entry points at the copy on the main
branch of this repository.

`alloy self code` sets the same thing up without a network: it writes
the schema to `~/.alloy/alloy.schema.json` and points VS Code, VSCodium,
Cursor, Windsurf, and Zed at that file through their `settings.json`.
`alloy self schema` prints the schema, which `npm run schema`
regenerates here.
