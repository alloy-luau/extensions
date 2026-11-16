; The node names are the ones of the Luau grammar that extension.toml
; pins. A name the grammar does not have fails the whole query, and Zed
; then drops the language: no color and no language server.

; `function f()`, `local function f()`, `function M.f()`, `function M:f()`.
(function_declaration
  name: (_) @name) @item

; `type T = ...` and `export type T = ...`.
(type_definition
  name: (identifier) @name) @item
