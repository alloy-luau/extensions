" Alloy. This file colors the whole buffer from the words alone, so a
" construct the Luau tree-sitter grammar cannot parse still has color.
" Tree-sitter and the language server draw over it where they know more.
if exists("b:current_syntax")
  finish
endif

syn case match
syn sync minlines=300

" --- strings ---------------------------------------------------------------
syn match alloyEscape contained "\\\%([abfnrtvz\\'\"`{]\|x\x\x\|\d\{1,3}\|u{\x\+}\|$\)"
syn region alloyString start=+"+ skip=+\\\\\|\\"+ end=+"\|$+ contains=alloyEscape,@Spell
syn region alloyString start=+'+ skip=+\\\\\|\\'+ end=+'\|$+ contains=alloyEscape,@Spell
syn region alloyString start="\[\z(=*\)\[" end="\]\z1\]" contains=@Spell
" `text {expr}`: the braces hold code.
syn region alloyString start=+`+ skip=+\\\\\|\\`+ end=+`+ contains=alloyEscape,alloyInterp,@Spell
syn region alloyInterp contained matchgroup=alloyInterpBrace start="{" end="}" contains=TOP

" --- numbers ---------------------------------------------------------------
syn match alloyNumber "\<0[xX][0-9a-fA-F_]\+\>"
syn match alloyNumber "\<0[bB][01_]\+\>"
syn match alloyNumber "\<\d[0-9_]*\%(\.[0-9_]*\)\=\%([eE][-+]\=\d\+\)\=\>"
syn match alloyNumber "\.\d[0-9_]*\%([eE][-+]\=\d\+\)\=\>"

" --- names -----------------------------------------------------------------
" A name before `(` is a call. A name with a capital is a type, a struct,
" an enum, or a variant.
syn match alloyCall "\<\h\w*\>\ze\s*("
syn match alloyType "\<\u\w*\>"
" A built-in type name, in any place a type stands: `x: number`, `{string}`,
" `(number) -> T`. Before `.` or `(` it is the library, `string.format`, or a
" call, and keeps the color of a name.
syn match alloyType "[.:]\@1<!\<\%(string\|number\|boolean\|any\|unknown\|never\|thread\|buffer\|vector\)\>\%(\s*[.(=]\)\@!"
" The keyword `function` takes its own word first, so the name reads back.
syn match alloyFunction "\%(\<function\s\+\)\@<=\h[A-Za-z0-9_.:]*"
syn match alloyAttribute "@\h\w*"
" A macro or an intrinsic: `$dbg(x)`, `$each(Enum)`.
syn match alloyMacro "\$\h\w*"
syn keyword alloyBuiltin self
syn keyword alloyBoolean true false
syn keyword alloyConstant nil

" --- the words Luau reserves -----------------------------------------------
syn keyword alloyConditional if then else elseif
syn keyword alloyRepeat for while repeat until do in
syn keyword alloyKeyword end local function return break
syn keyword alloyOperatorWord and or not

" --- the words of Alloy ----------------------------------------------------
" Each of these is also a legal name, as `continue` and `type` are in
" Luau. A word after `.` or `:`, or before `=`, `,`, `.`, `:`, `)`, is a
" name, and keeps the color of one.
syn match alloyKeyword "\<import\s\+\zsinline\>\ze\s*\%([*{]\|\s\%(from\>\)\@!\a\)"
syn match alloyKeyword "[.:]\@1<!\<\%(const\|continue\|export\|import\|from\|global\|struct\|enum\|trait\|impl\|interface\|namespace\|macro\|attribute\|remote\|extends\|satisfies\|declare\|extern\|requires\|async\|await\|try\|where\|with\|as\|is\|new\|delete\|destroy\|after\|on\|read\|write\|private\|public\|static\|type\|typeof\|parallel\)\>\%(\s*[=,.:)]\)\@!"
syn match alloyConditional "[.:]\@1<!\<\%(match\|case\|default\)\>\%(\s*[=,.:)(]\)\@!"
" `using name = value`: a name follows, then `=` or the `:` of its type.
syn match alloyKeyword "^\s*\zs\<using\>\ze\s\+\h\w*\s*[=:]"
" `defer` opens a statement, and a name or `do` follows it.
syn match alloyKeyword "^\s*\zs\<defer\>\ze\s\+\h"
" `yield` opens a statement of a generator and takes a value.
syn match alloyKeyword "^\s*\zs\<yield\>\%(\s*\%([=,.:]\|$\)\)\@!"
syn match alloyOperatorWord "[.:]\@1<!\<\%(band\|bor\|bxor\|shl\|shr\)\>\%(\s*[=,.:)(]\)\@!"

" The supertypes: `x is struct`, `x is not object`, and `p: struct<T>`,
" `e: enum`. After `is` or a `:` the word names a kind, not a declaration.
syn match alloyType "\%(\<is\s\+\%(not\s\+\)\=\)\@<=\<\%(struct\|enum\|object\)\>"
syn match alloyType "\%(\h\w*\s*:\s*\)\@<=\<\%(struct\|enum\)\>"

" --- operators -------------------------------------------------------------
syn match alloyOperator "|>\|:=\|->\|=>\|?\.\|??=\=\|\.\.\.\|\.\.=\=\|[-+*/%^#<>=~!]=\=\|//=\="

" Last, so `--` is a comment before it is two operators.
syn keyword alloyTodo contained TODO FIXME XXX NOTE HACK
syn match alloyComment "--.*$" contains=alloyTodo,@Spell
syn region alloyComment start="--\[\z(=*\)\[" end="\]\z1\]" contains=alloyTodo,@Spell


hi def link alloyComment Comment
hi def link alloyTodo Todo
hi def link alloyString String
hi def link alloyEscape SpecialChar
hi def link alloyInterpBrace Special
hi def link alloyNumber Number
hi def link alloyCall Function
hi def link alloyFunction Function
hi def link alloyType Type
hi def link alloyAttribute PreProc
hi def link alloyMacro Macro
hi def link alloyBuiltin Special
hi def link alloyBoolean Boolean
hi def link alloyConstant Constant
hi def link alloyConditional Conditional
hi def link alloyRepeat Repeat
hi def link alloyKeyword Keyword
hi def link alloyOperatorWord Keyword
hi def link alloyOperator Operator

let b:current_syntax = "alloy"
