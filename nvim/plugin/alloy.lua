if vim.g.loaded_alloy then
  return
end
vim.g.loaded_alloy = true

-- Alloy has no grammar of its own. The Luau parser reads it.
vim.treesitter.language.register("luau", "alloy")

-- The query in after/queries/luau uses this predicate. The Alloy
-- keywords color only in an Alloy buffer.
vim.treesitter.query.add_predicate("alloy-buffer?", function(_, _, source)
  return type(source) == "number" and vim.bo[source].filetype == "alloy"
end, { force = true })

-- The Luau grammar has no `new` expression, so the tree gives no
-- reliable shape. This predicate reads the line, with the same rule as
-- the VS Code grammar: no `.` or `:` before, and a name after on the
-- same line that is not a keyword.
local not_a_type = {}
for word in
  ("end then else elseif do until and or not in is as satisfies where return local const "
    .. "break continue with from band bor bxor shl shr"):gmatch("%S+")
do
  not_a_type[word] = true
end
vim.treesitter.query.add_predicate("alloy-new?", function(match, _, source, predicate)
  local node = match[predicate[2]]
  if type(node) == "table" then
    node = node[#node]
  end
  if not node or type(source) ~= "number" or vim.bo[source].filetype ~= "alloy" then
    return false
  end
  local row, start_col, _, end_col = node:range()
  local line = vim.api.nvim_buf_get_lines(source, row, row + 1, false)[1] or ""
  if line:sub(start_col, start_col):match("[.:]") then
    return false
  end
  local word = line:sub(end_col + 1):match("^[ \t]+([%a_][%w_]*)")
  return word ~= nil and not not_a_type[word]
end, { force = true })

vim.api.nvim_create_autocmd("FileType", {
  pattern = "alloy",
  callback = function(ev)
    -- syntax/alloy.vim colors the buffer, and the server's semantic
    -- tokens go over it. The Luau grammar is off by default: it cannot
    -- parse a `struct`, a `private` member, or `-> T`, and in the part
    -- it gives up on it colors a keyword as a plain name. Set
    -- vim.g.alloy_treesitter to true to draw it over the syntax file.
    if vim.g.alloy_treesitter == true and pcall(vim.treesitter.start, ev.buf) then
      vim.bo[ev.buf].syntax = "alloy"
    end
  end,
})

-- File icons, when nvim-web-devicons is present. The glyphs come from font/alloy-icons.ttf.
-- The terminal must map U+100000-U+100003 to the "Alloy Icons" font. See the README.
local has_devicons, devicons = pcall(require, "nvim-web-devicons")
if has_devicons then
  local by_extension = {
    ["aly"] = { icon = "\u{100000}", color = "#8B6AEE", cterm_color = "99", name = "Alloy" },
    ["alx"] = { icon = "\u{100001}", color = "#51C6F1", cterm_color = "81", name = "AlloyJsx" },
    ["d.aly"] = { icon = "\u{100002}", color = "#DD75EE", cterm_color = "177", name = "AlloyDeclaration" },
  }
  local by_filename = {
    [".config.aly"] = { icon = "\u{100003}", color = "#8A69ED", cterm_color = "99", name = "AlloyConfig" },
    ["alloy.toml"] = { icon = "\u{100003}", color = "#8A69ED", cterm_color = "99", name = "AlloyToml" },
  }
  -- set_icon makes the highlight groups and covers the default lookup.
  devicons.set_icon(vim.tbl_extend("error", by_extension, by_filename))
  -- With `strict = true`, devicons reads these two tables and not the one set_icon fills.
  for ext, icon in pairs(by_extension) do
    devicons.get_icons_by_extension()[ext] = icon
  end
  for name, icon in pairs(by_filename) do
    devicons.get_icons_by_filename()[name] = icon
  end
end

-- Alloy code in a float: the hover and the signature go through
-- open_floating_preview, and the documentation of a completion item is
-- the preview window of the menu. lua/alloy.lua says why the plugin
-- colors these itself.
local open_floating_preview = vim.lsp.util.open_floating_preview
function vim.lsp.util.open_floating_preview(contents, syntax, opts, ...)
  local buf, win = open_floating_preview(contents, syntax, opts, ...)
  if buf then
    pcall(require("alloy").highlight_blocks, buf)
  end
  return buf, win
end
vim.api.nvim_create_autocmd("CompleteChanged", {
  callback = function()
    -- The server fills the documentation in after the item is chosen.
    vim.defer_fn(function()
      local info = vim.fn.complete_info({ "selected", "preview_bufnr" })
      if info.preview_bufnr and info.preview_bufnr > 0 then
        pcall(require("alloy").highlight_blocks, info.preview_bufnr)
      end
    end, 120)
  end,
})

-- The two commands of the VS Code extension.
vim.api.nvim_create_user_command("AlloyRestartServer", function()
  require("alloy").restart()
end, { desc = "Stop the Alloy language server and start it again" })
vim.api.nvim_create_user_command("AlloyGenerateSourcemap", function()
  require("alloy").generate_sourcemap(0)
end, { desc = "Run the sourcemap generator command in the project root" })

-- `sourcemap.autogenerate`: each save of a script runs the generator.
vim.api.nvim_create_autocmd("BufWritePost", {
  pattern = { "*.aly", "*.alx", "*.luau", "*.lua" },
  callback = function(ev)
    local alloy = require("alloy")
    if alloy.config().sourcemap.autogenerate then
      alloy.generate_sourcemap(ev.buf)
    end
  end,
})

-- Set vim.g.alloy_lsp to false to start the server yourself.
if vim.g.alloy_lsp ~= false then
  vim.lsp.enable("alloy_lsp")
end
