vim.bo.commentstring = "-- %s"
vim.bo.comments = ":---,:--"

-- The layout `alloy fmt` writes by default: two spaces, no tabs. A
-- project with other `[fmt]` values sets these in its own config.
vim.bo.expandtab = true
vim.bo.shiftwidth = 2
vim.bo.softtabstop = 2
vim.bo.tabstop = 2

-- Indent by the words that open and close a block. `alloy fmt` gives the
-- final layout; this puts the cursor in the right column while typing.
vim.bo.autoindent = true
vim.bo.indentexpr = "v:lua.require'alloy'.indent()"
vim.bo.indentkeys = "0{,0},0),0],!^F,o,O,0=end,0=else,0=elseif,0=until,0=case,0=default"

-- `autoCloseParens`: lua/alloy.lua says what the keys do.
require("alloy").close_parens(0)
