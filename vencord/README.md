# Alloy for Vencord

A Vencord user plugin that highlights Alloy in Discord codeblocks. It
serves both highlighters Vencord can use:

- ShikiCodeblocks gets the TextMate grammars from `../vscode/syntaxes`.
  `alloyCodeblocks/grammars` links to them, so there is one copy.
- Discord's own highlight.js gets the definitions in
  `alloyCodeblocks/hljs.ts`.

The codeblock languages are `aly` (alias `alloy`), `alx` (alias
`alloy-jsx`), and `d.aly` (aliases `daly`, `alloy-declaration`).

## Install

Vencord builds user plugins from `src/userplugins` in a source checkout.
`install.sh` copies the plugin there and builds Vencord:

```sh
git clone https://github.com/Vendicated/Vencord
cd Vencord
npx pnpm install --frozen-lockfile
/path/to/extensions/vencord/install.sh "$PWD"
```

The build writes `dist/`. Point the client at it:

- Vesktop: set `vencordDir` in its `settings.json` to the `dist` folder.
  A Flatpak Vesktop also needs
  `flatpak override --user --filesystem=/path/to/dist:ro dev.vencord.Vesktop`.
- Discord with Vencord injected: run `npx pnpm inject`.

Restart the client. The plugin appears as "AlloyCodeblocks" in the
Vencord plugin list and starts enabled.

## Update

Pull Vencord, pull this repository, and run `install.sh` again. The
script copies the plugin, so a change here needs a new run.
