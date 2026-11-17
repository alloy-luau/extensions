-- The settings of the Alloy plugin, and what each one does. The names
-- and the defaults are the ones of the VS Code extension, so one page of
-- documentation serves both: `alloy-luau.sourcemap.autogenerate` there is
-- `sourcemap.autogenerate` here.
--
--   vim.g.alloy = { sourcemap = { autogenerate = true }, rig = "R6" }
--
-- Set vim.g.alloy before the first Alloy file opens. A key the table
-- leaves out keeps its default.
local M = {}
local watch_typed_keys

M.defaults = {
  server = {
    -- "" means ~/.alloy/bin/alloy-lsp when it exists, then alloy-lsp on PATH.
    path = "",
    args = {},
    -- "" means the binary of the VS Code luau-lsp extension when one is
    -- installed, then luau-lsp on PATH.
    luauLspPath = "",
    logLevel = "warn",
  },
  -- "off", "messages", or "verbose": the trace the client asks the server for.
  trace = { server = "off" },
  -- Declaration files whose globals every file sees. A relative path
  -- reads from the project root.
  types = { definitionFiles = {} },
  inlayHints = {
    variableTypes = true,
    parameterTypes = true,
    functionReturnTypes = true,
    parameterNames = "literals",
    makeInsertable = true,
  },
  autoEnd = true,
  autoCloseTags = true,
  -- `(`, `[`, and `{` write their closing character. Neovim only: VS Code
  -- has `editor.autoClosingBrackets` for this.
  autoCloseParens = true,
  hideRobloxDeprecated = false,
  hideAllDeprecated = false,
  arrowReturnHints = false,
  -- "R15" or "R6". Unset, `[roblox] rig` in alloy.toml decides.
  rig = nil,
  sourcemap = {
    file = "sourcemap.json",
    autogenerate = false,
    generatorCommand = "rojo sourcemap --output ${sourcemapFile}",
  },
  studioPlugin = { enabled = false, port = 3668 },
  fflags = {
    enableByDefault = true,
    sync = true,
    enableNewSolver = true,
    -- Flags set last, by name. A name that starts with `Alloy` is a flag
    -- of Alloy itself, and the rest go to luau-lsp.
    override = {},
  },
  -- A whole `luau-lsp` settings section, passed to the child as it is.
  luauLsp = {},
}

--- The settings: vim.g.alloy over the defaults.
function M.config()
  return vim.tbl_deep_extend("force", M.defaults, vim.g.alloy or {})
end

local function exists(path)
  return vim.uv.fs_stat(path) ~= nil
end

local data_dir = vim.fn.stdpath("data") .. "/alloy"

-- The directories tool installers use, in front of PATH. Neovim from a
-- desktop launcher does not read the shell profile.
local function tool_path()
  local dirs = {}
  for _, name in ipairs({ ".alloy", ".ember", ".rokit", ".aftman", ".foreman", ".cargo", ".local" }) do
    local dir = vim.env.HOME .. "/" .. name .. "/bin"
    if exists(dir) then
      dirs[#dirs + 1] = dir
    end
  end
  dirs[#dirs + 1] = vim.env.PATH or ""
  return table.concat(dirs, ":")
end
M.tool_path = tool_path

-- The luau-lsp binary: the setting, then the one a VS Code luau-lsp
-- extension ships. nil leaves the choice to alloy-lsp, which reads PATH.
local function luau_lsp_path(config)
  if config.server.luauLspPath ~= "" then
    return vim.fn.expand(config.server.luauLspPath)
  end
  for _, root in ipairs({ ".vscode", ".vscode-insiders", ".vscode-oss" }) do
    local found = vim.fn.glob(vim.env.HOME .. "/" .. root .. "/extensions/johnnymorganz.luau-lsp-*/bin/server", true, true)
    if #found > 0 then
      table.sort(found)
      return found[#found]
    end
  end
  return nil
end

-- The Roblox globals (game, workspace, Instance) and their docs come from
-- the same files as the VS Code extension uses. The first Alloy file
-- downloads them once. Set vim.g.alloy_roblox to false for a project that
-- is not for Roblox. Delete the folder to get new files.
local function roblox_args()
  if vim.g.alloy_roblox == false then
    return {}
  end
  local files = {
    { flag = "--definitions", path = data_dir .. "/globalTypes.PluginSecurity.d.luau",
      url = "https://luau-lsp.pages.dev/type-definitions/globalTypes.PluginSecurity.d.luau" },
    { flag = "--docs", path = data_dir .. "/api-docs.json",
      url = "https://luau-lsp.pages.dev/api-docs/en-us.json" },
  }
  vim.fn.mkdir(data_dir, "p")
  local args = {}
  for _, file in ipairs(files) do
    if vim.fn.filereadable(file.path) == 0 then
      vim.notify("Alloy: downloading " .. vim.fs.basename(file.path))
      -- curl writes to a temporary name, so a failed download leaves no half file.
      local tmp = file.path .. ".part"
      local done = vim.system({ "curl", "-fsSL", "--max-time", "30", "-o", tmp, file.url }):wait()
      if done.code == 0 then
        vim.uv.fs_rename(tmp, file.path)
      else
        vim.notify("Alloy: cannot download the Roblox types, so the globals are unknown", vim.log.levels.WARN)
      end
    end
    if vim.fn.filereadable(file.path) == 1 then
      vim.list_extend(args, { file.flag, file.path })
    end
  end
  return args
end

--- The command line of the server for a project at `root`.
function M.command(root)
  local config = M.config()
  local installed = vim.env.HOME .. "/.alloy/bin/alloy-lsp"
  local command = config.server.path ~= "" and vim.fn.expand(config.server.path)
    or (exists(installed) and installed or "alloy-lsp")
  local cmd = { command }
  local luau_lsp = luau_lsp_path(config)
  if luau_lsp then
    vim.list_extend(cmd, { "--luau-lsp", luau_lsp })
  end
  vim.list_extend(cmd, roblox_args())
  for _, file in ipairs(config.types.definitionFiles) do
    file = vim.fn.expand(file)
    if root and not file:match("^/") then
      file = root .. "/" .. file
    end
    vim.list_extend(cmd, { "--definitions", file })
  end
  vim.list_extend(cmd, { "--log-level", config.server.logLevel })
  vim.list_extend(cmd, config.server.args)
  return cmd
end

-- The Luau flags Roblox publishes for Studio, so the checker behaves as
-- the engine does. A start reads the file the last session wrote, and
-- each session writes a new one in the background, so no start waits on
-- the network. The file holds only flags the luau-lsp binary knows: one
-- it does not know prints "Unknown FFlag" on every start.
local synced_file = data_dir .. "/fflags.json"
local FFLAGS_URL = "https://clientsettingscdn.roblox.com/v1/settings/application?applicationName=PCStudioApp"

local function synced_flags()
  local file = io.open(synced_file)
  if not file then
    return {}
  end
  local ok, flags = pcall(vim.json.decode, file:read("a"))
  file:close()
  return ok and type(flags) == "table" and flags or {}
end

local refreshed = false
local function refresh_synced_flags(config)
  if refreshed then
    return
  end
  refreshed = true
  local luau_lsp = luau_lsp_path(config) or "luau-lsp"
  vim.system({ luau_lsp, "--show-flags" }, { text = true, timeout = 5000, env = { PATH = tool_path() } }, function(shown)
    local known, any = {}, false
    if shown.code == 0 then
      for line in (shown.stdout or ""):gmatch("[^\n]+") do
        local name = vim.trim(line):match("^[^=]+")
        if name then
          known[name], any = true, true
        end
      end
    end
    vim.system({ "curl", "-fsSL", "--max-time", "15", FFLAGS_URL }, { text = true }, function(got)
      if got.code ~= 0 then
        return
      end
      local ok, published = pcall(vim.json.decode, got.stdout or "")
      if not ok or type(published) ~= "table" then
        return
      end
      local flags = {}
      for name, value in pairs(published.applicationSettings or {}) do
        for _, kind in ipairs({ "DFFlag", "DFInt", "FFlag", "FInt" }) do
          if name:sub(1, #kind + 4) == kind .. "Luau" then
            local flag = name:sub(#kind + 1)
            if not any or known[flag] then
              flags[flag] = tostring(value)
            end
            break
          end
        end
      end
      -- This runs in a libuv callback, where no Vimscript function may run.
      vim.uv.fs_mkdir(data_dir, 493)
      local file = io.open(synced_file .. ".part", "w")
      if file then
        file:write(vim.json.encode(flags))
        file:close()
        vim.uv.fs_rename(synced_file .. ".part", synced_file)
      end
    end)
  end)
end

--- What the server reads from the editor: the first message carries it,
--- and a settings change sends it again.
function M.settings()
  local config = M.config()
  local override = {}
  if config.fflags.sync then
    override = synced_flags()
    refresh_synced_flags(config)
  end
  for name, value in pairs(config.fflags.override) do
    override[name] = tostring(value)
  end
  return {
    luauLsp = config.luauLsp,
    fflags = {
      enableByDefault = config.fflags.enableByDefault,
      enableNewSolver = config.fflags.enableNewSolver,
      -- An empty Lua table encodes as a JSON array, and the server wants an object.
      override = next(override) and override or vim.empty_dict(),
    },
    rig = config.rig,
    autoCloseTags = config.autoCloseTags,
    autoEnd = config.autoEnd,
    hideRobloxDeprecated = config.hideRobloxDeprecated,
    hideAllDeprecated = config.hideAllDeprecated,
    arrowReturnHints = config.arrowReturnHints,
    inlayHints = config.inlayHints,
    studioPlugin = config.studioPlugin,
    sourcemap = { file = config.sourcemap.file },
  }
end

--- The project root of a buffer: the root of its server, else the folder
--- that holds alloy.toml, a project file, or .git.
function M.root(buf)
  for _, client in ipairs(vim.lsp.get_clients({ bufnr = buf, name = "alloy_lsp" })) do
    if client.root_dir then
      return client.root_dir
    end
  end
  return vim.fs.root(buf, { "alloy.toml", ".config.aly", "default.project.json", ".git" })
end

local generating, again = false, false
local reported = false

--- Runs the sourcemap generator in the project root of `buf`. A second
--- call during a run waits and runs once more after it.
function M.generate_sourcemap(buf)
  local root = M.root(buf or 0)
  if not root then
    return
  end
  if generating then
    again = true
    return
  end
  local config = M.config()
  local file = config.sourcemap.file
  -- `alloy build` writes the sourcemap of a project with mounts. The
  -- server reads it, so the generator has nothing to do.
  if exists(root .. "/.alloy/sourcemap.json") and not exists(root .. "/" .. file) then
    return
  end
  generating = true
  local command = config.sourcemap.generatorCommand:gsub("%${sourcemapFile}", function()
    return file
  end)
  vim.system({ "sh", "-c", command }, { cwd = root, text = true, env = { PATH = tool_path() } }, function(done)
    generating = false
    vim.schedule(function()
      -- One report for each session: a save must not print the same failure each time.
      if done.code ~= 0 and not reported then
        reported = true
        local why = vim.trim(done.stderr or "")
        vim.notify("Alloy: `" .. command .. "` failed: " .. (why ~= "" and why or "exit " .. done.code), vim.log.levels.WARN)
      end
      if again then
        again = false
        M.generate_sourcemap(buf)
      end
    end)
  end)
end

--- Stops the server and starts it again, with the settings read anew.
function M.restart()
  local bufs = {}
  for _, client in ipairs(vim.lsp.get_clients({ name = "alloy_lsp" })) do
    vim.list_extend(bufs, vim.tbl_keys(client.attached_buffers))
    client:stop(true)
  end
  -- The filetype event attaches a new client to each buffer the old one held.
  vim.defer_fn(function()
    for _, buf in ipairs(bufs) do
      if vim.api.nvim_buf_is_loaded(buf) then
        vim.api.nvim_exec_autocmds("FileType", { buffer = buf, modeline = false })
      end
    end
  end, 300)
end

-- `>` at the end of an opening tag in a .alx file: the server names the
-- element, and its closing tag goes after the cursor.
local function close_tag(buf, client)
  local row, col = unpack(vim.api.nvim_win_get_cursor(0))
  local tick = vim.b[buf].changedtick
  client:request("alloy/closeTag", {
    uri = vim.uri_from_bufnr(buf),
    position = { line = row - 1, character = col },
  }, function(_, answer)
    local name = type(answer) == "table" and answer.name
    local now_row, now_col = unpack(vim.api.nvim_win_get_cursor(0))
    -- The reader types on while the server answers. An edit then lands
    -- on text the answer never saw, so it is dropped.
    if not name or vim.b[buf].changedtick ~= tick or now_row ~= row or now_col ~= col then
      return
    end
    vim.api.nvim_buf_set_text(buf, row - 1, col, row - 1, col, { "</" .. name .. ">" })
  end, buf)
end

-- After Enter on a line that opens a block, the server answers with the
-- `end` of the block, as an on-type edit at the cursor. Neovim's own
-- vim.lsp.on_type_formatting moves the cursor past an edit at the cursor,
-- so the caret would land after the `end`. This keeps it in the block.
local function end_at_caret(buf, client, char)
  local row, col = unpack(vim.api.nvim_win_get_cursor(0))
  local tick = vim.b[buf].changedtick
  local params = vim.lsp.util.make_position_params(0, client.offset_encoding)
  params.ch = char
  params.options = { tabSize = vim.bo[buf].shiftwidth, insertSpaces = vim.bo[buf].expandtab }
  client:request("textDocument/onTypeFormatting", params, function(_, edits)
    local now_row, now_col = unpack(vim.api.nvim_win_get_cursor(0))
    -- The reader typed on while the server answered: the edit is stale.
    if not edits or #edits == 0 or vim.b[buf].changedtick ~= tick or now_row ~= row or now_col ~= col then
      return
    end
    vim.lsp.util.apply_text_edits(edits, buf, client.offset_encoding)
    vim.api.nvim_win_set_cursor(0, { row, col })
  end, buf)
end

local watching = false
function watch_typed_keys()
  if watching then
    return
  end
  watching = true
  vim.on_key(function(_, typed)
    if typed ~= "\r" and typed ~= "{" then
      return
    end
    if vim.api.nvim_get_mode().mode ~= "i" then
      return
    end
    local buf = vim.api.nvim_get_current_buf()
    local client = vim.lsp.get_clients({ bufnr = buf, name = "alloy_lsp" })[1]
    if not client or not M.config().autoEnd then
      return
    end
    -- The key is in the buffer only after this callback.
    vim.schedule(function()
      end_at_caret(buf, client, typed == "\r" and "\n" or typed)
    end)
  end, vim.api.nvim_create_namespace("alloy_auto_end"))
end

local closers = { ["("] = ")", ["["] = "]", ["{"] = "}" }

--- `autoCloseParens` for `buf`: an opening character writes its closing
--- one, a closing character steps over the one that stands there, and
--- Backspace between an empty pair deletes both. A key that already has
--- an insert mapping stays with it, so a pairs plugin keeps the work.
function M.close_parens(buf)
  buf = buf == 0 and vim.api.nvim_get_current_buf() or buf
  -- The character before the cursor and the one after it.
  local function around()
    local col = vim.api.nvim_win_get_cursor(0)[2]
    local line = vim.api.nvim_get_current_line()
    return line:sub(col, col), line:sub(col + 1, col + 1)
  end
  local function map(key, action)
    if vim.fn.maparg(key, "i") == "" then
      vim.keymap.set("i", key, function()
        -- The setting is read at each key, so a change needs no restart.
        return action(M.config().autoCloseParens, around())
      end, { buffer = buf, expr = true, desc = "Alloy: autoCloseParens" })
    end
  end
  for open, close in pairs(closers) do
    map(open, function(on, _, after)
      -- As VS Code does: only before a space, a closing character, a
      -- comma, or the end of the line. `(` before a name wraps nothing.
      if on and after:match("^[%s%)%]},]?$") then
        -- The key itself goes in as typed, so a completion plugin still
        -- sees `{` as the last character. The closing one follows it.
        vim.schedule(function()
          local row, col = unpack(vim.api.nvim_win_get_cursor(0))
          if vim.api.nvim_get_current_buf() == buf and vim.api.nvim_get_current_line():sub(col, col) == open then
            vim.api.nvim_buf_set_text(buf, row - 1, col, row - 1, col, { close })
          end
        end)
      end
      return open
    end)
    map(close, function(on, _, after)
      -- <C-g>U keeps the step in the same undo block.
      return on and after == close and "<C-g>U<Right>" or close
    end)
  end
  map("<BS>", function(on, before, after)
    return on and before ~= "" and closers[before] == after and "<BS><Del>" or "<BS>"
  end)
end

-- A line that ends with one of these opens a block.
local function opens(line)
  line = line:gsub("%-%-.*$", ""):gsub("%s+$", "")
  if line:match("[%({%[]$") then
    return true
  end
  for _, word in ipairs({ "then", "do", "else", "repeat", "with" }) do
    if line:match("%f[%w_]" .. word .. "$") then
      return true
    end
  end
  -- `function f(a) -> T` and `function(a)` with no body on the line.
  if line:match("%f[%w_]function%f[^%w_]") and not line:match("%f[%w_]end$") then
    return true
  end
  -- A declaration that holds members: `struct Point`, `impl Shape for Circle`.
  local first = line:gsub("^%s*export%s+", ""):gsub("^%s*default%s+", ""):match("^%s*([%a_]+)")
  for _, word in ipairs({ "struct", "enum", "impl", "trait", "interface", "namespace", "declare", "extern", "case", "default" }) do
    if first == word and not line:match("%f[%w_]end$") then
      return true
    end
  end
  return false
end

--- The indent of the line at v:lnum, for `indentexpr`.
function M.indent()
  local lnum = vim.v.lnum
  local prev = vim.fn.prevnonblank(lnum - 1)
  if prev == 0 then
    return 0
  end
  local width = vim.fn.shiftwidth()
  local indent = vim.fn.indent(prev)
  local before = vim.fn.getline(prev)
  if opens(before) then
    indent = indent + width
  end
  local here = vim.fn.getline(lnum)
  local word = here:match("^%s*([%a_]+)")
  local closes = here:match("^%s*[%)}%]]")
    or word == "end" or word == "else" or word == "elseif" or word == "until"
  -- An arm of a `match` stands at the column of the arm before it.
  local arm = (word == "case" or word == "default") and before:match("^%s*([%a_]+)") ~= "match"
    and not before:match("%f[%w_]with%s*$")
  if closes or arm then
    indent = indent - width
  end
  return math.max(indent, 0)
end

-- The colors of Alloy code that stands in another buffer: a fenced block
-- in a hover, in a signature, or in the documentation of a completion
-- item. Neovim colors such a block with the tree-sitter grammar of its
-- language, and for Alloy that is the Luau grammar, which leaves
-- `struct`, `private`, and the `end` of an `impl` plain. syntax/alloy.vim
-- knows every word, so a hidden buffer runs it over the block and the
-- groups it gives go on the real buffer as marks.
local block_ns = vim.api.nvim_create_namespace("alloy_code_blocks")
local scratch

--- Each run of one syntax group in `lines` of Alloy code, as
--- { row, start, end, group }, all from zero, the end exclusive. Another
--- plugin can color a line of Alloy with it, such as a completion menu
--- that shows a type.
function M.spans(lines)
  if not (scratch and vim.api.nvim_buf_is_valid(scratch)) then
    scratch = vim.api.nvim_create_buf(false, true)
    vim.bo[scratch].syntax = "alloy"
  end
  vim.api.nvim_buf_set_lines(scratch, 0, -1, false, lines)
  local spans = {}
  vim.api.nvim_buf_call(scratch, function()
    vim.cmd("syntax sync fromstart")
    for row, line in ipairs(lines) do
      local col = 1
      while col <= #line do
        local id = vim.fn.synIDtrans(vim.fn.synID(row, col, 1))
        local start = col
        repeat
          col = col + 1
        until col > #line or vim.fn.synIDtrans(vim.fn.synID(row, col, 1)) ~= id
        if id ~= 0 then
          spans[#spans + 1] = { row - 1, start - 1, col - 1, vim.fn.synIDattr(id, "name") }
        end
      end
    end
  end)
  return spans
end

--- Colors the lines `first` to `last` of `buf` as Alloy code, from zero,
--- the end exclusive.
function M.highlight_lines(buf, first, last)
  local lines = vim.api.nvim_buf_get_lines(buf, first, last, false)
  for _, span in ipairs(M.spans(lines)) do
    -- Over the tree-sitter colors, which stand at priority 100.
    pcall(vim.api.nvim_buf_set_extmark, buf, block_ns, first + span[1], span[2], {
      end_col = span[3],
      hl_group = span[4],
      priority = 150,
    })
  end
end

--- Colors each ```alloy block of a Markdown buffer, such as a hover.
function M.highlight_blocks(buf)
  if not vim.api.nvim_buf_is_valid(buf) then
    return
  end
  vim.api.nvim_buf_clear_namespace(buf, block_ns, 0, -1)
  local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  local first
  for row, line in ipairs(lines) do
    if not first then
      if line:match("^%s*```%s*alloy%s*$") then
        first = row + 1
      end
    elseif line:match("^%s*```%s*$") then
      M.highlight_lines(buf, first - 1, row - 1)
      first = nil
    end
  end
end

--- What the plugin adds to a buffer when the server attaches.
function M.on_attach(client, buf)
  local config = M.config()
  if config.autoEnd and client:supports_method("textDocument/onTypeFormatting", buf) then
    watch_typed_keys()
  end
  if config.autoCloseTags and vim.api.nvim_buf_get_name(buf):match("%.alx$") then
    vim.api.nvim_create_autocmd("InsertCharPre", {
      buffer = buf,
      group = vim.api.nvim_create_augroup("alloy_close_tag_" .. buf, { clear = true }),
      callback = function()
        if vim.v.char == ">" then
          -- The character is in the buffer only after this event.
          vim.schedule(function()
            close_tag(buf, client)
          end)
        end
      end,
    })
  end
end

return M
