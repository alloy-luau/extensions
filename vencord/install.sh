#!/bin/sh
# Copies the plugin into a Vencord checkout and builds Vencord.
# Usage: install.sh /path/to/Vencord
#
# A copy, not a symlink: esbuild resolves a symlink to its real path,
# and Vencord's path aliases only apply under its own tsconfig.
set -eu

vencord="${1:?usage: install.sh /path/to/Vencord}"
here="$(cd "$(dirname "$0")" && pwd)"
target="$vencord/src/userplugins/alloyCodeblocks"

mkdir -p "$vencord/src/userplugins"
rm -rf "$target"
cp -rL "$here/alloyCodeblocks" "$target"

cd "$vencord"
npx --yes pnpm build
