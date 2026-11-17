#!/bin/sh
# Builds the Luau tree-sitter parser into parser/luau.so of this plugin.
# Skip it when nvim-treesitter already supplies a Luau parser.
# The revision matches the one that zed/extension.toml pins.
set -eu

REV=a8914d6c1fc5131f8e1c13f769fa704c9f5eb02f
DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

git clone --quiet https://github.com/tree-sitter-grammars/tree-sitter-luau "$TMP"
git -C "$TMP" checkout --quiet "$REV"
mkdir -p "$DIR/parser"
"${CC:-cc}" -O2 -fPIC -shared -I"$TMP/src" "$TMP/src/parser.c" "$TMP/src/scanner.c" \
  -o "$DIR/parser/luau.so"
echo "built $DIR/parser/luau.so"
