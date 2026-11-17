-- The settings are in vim.g.alloy; lua/alloy.lua lists them. Override a
-- key of this table with vim.lsp.config("alloy_lsp", { ... }).
local alloy = require("alloy")
local settings = alloy.settings()

return {
  -- A function, so the command reads the project root: a relative
  -- declaration file resolves from there.
  cmd = function(dispatchers, config)
    return vim.lsp.rpc.start(alloy.command(config.root_dir), dispatchers, {
      cwd = config.root_dir,
      env = { PATH = alloy.tool_path() },
    })
  end,
  filetypes = { "alloy" },
  root_markers = { "alloy.toml", ".config.aly", ".git" },
  init_options = settings,
  settings = settings,
  trace = alloy.config().trace.server,
  on_attach = alloy.on_attach,
}
