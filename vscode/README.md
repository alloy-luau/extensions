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

The project file gets its own language, `Alloy config`, with the icon,
TOML highlighting, completion for every table and key with its type and
default, hover documentation, and diagnostics for a key the compiler
would reject. The lint names in `[lint]` come from `alloy doc --json`
when the binary is on PATH.
