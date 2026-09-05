# Alloy editor extensions

The editor extensions for [Alloy](https://github.com/alloy-luau/alloy), a
strict superset of Luau that compiles to plain Luau.

| Folder   | Editor  | State                                 |
|----------|---------|---------------------------------------|
| `vscode` | VS Code | Syntax, the language server, commands |
| `zed`    | Zed     | Syntax through the Luau grammar, the language server |

Each extension starts `alloy-lsp` from PATH or from a setting. The
binaries come from the `alloy` repository: `scripts/build.sh --install`
there puts them in `~/.alloy/bin`.

```sh
cd vscode
npm ci
npm run lint
npm run compile
npm run package     # writes the .vsix
```

A release is a tag `vscode-v1.2.3` on a commit whose `package.json`
carries that version; CI builds the `.vsix`, creates the release, and
publishes to the Marketplace when `VSCE_PAT` is set.
