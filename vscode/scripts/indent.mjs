// Checks the indentation of a line two ways: the patterns of
// language-configuration.json against the lines the editor re-indents,
// and the column a reader ends up with as they type the first word of
// a line. A namespace opens a body, and a member keeps its visibility
// word, so both must raise the indent.
//
// The editor's model is `getIndentActionForType` and
// `getInheritIndentForLine` in
// src/vs/editor/common/languages/autoIndent.ts. It re-indents a line
// the moment a typed character makes the line match
// decreaseIndentPattern. It then takes the nearest line above that
// opens or closes a block and writes that line's own indentation, one
// level out from it when that line opens no block. So a pattern never
// writes a column one level inside its reference line, which is the
// column an arm of a `match` takes: `src/indent.ts` writes that one.
//
// The model leaves out `indentNextLinePattern` and
// `unIndentedLinePattern`, which this language declares neither of.
//
// Usage: npm test
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	matchIndent,
	signatureEndIndent,
	signatureIndent,
} from '../out/indent.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const rules = JSON.parse(
	fs.readFileSync(path.join(here, '..', 'language-configuration.json'), 'utf8'),
).indentationRules
const increase = new RegExp(rules.increaseIndentPattern)
const decrease = new RegExp(rules.decreaseIndentPattern)

// increaseIndentPattern reads, in the order it is written:
//
//   ^(?!\s*(?:export\s+|global\s+)?(?:declare|remote)\s+function\b)
//                                             a signature, never a body
//   (?: CODE (?:\b(?:then|do|repeat|else|with|as)\b|[{[(])
//     | \s*default
//     | CODE \b(?:function|macro)\b (?!CODE\bend\b) CODE \)(: T)?
//   ) \s*(?:--.*)?$
//
// CODE is `(?:[^-]|-(?!-))*`: any run of text with no `--` in it, so
// every opener must sit in front of the comment, and a line that opens
// with `--` holds no opener at all. The tail takes the comment.
//
// The opener is the last word of the code, which is what makes a block
// that closes on its own line (`function f() return 1 end`) open
// nothing: the line ends in `end`, not in an opener. The prefix is
// free, so an opener that is not the first word (`local x = async do`,
// `Damage.on(function(a, b)`) counts. The `function` branch refuses a
// line that closes its own body, hence the `end` lookahead.
//
// Undecidable from one line: a body-less signature in a `trait`,
// `interface`, or `declare` block. `    function area(self): number`
// is the same text in `trait Shape as` (08_structs_traits.aly:32, no
// body) and in `impl Shape for Circle as` (:46, a body follows), so
// the pattern opens for both. Dropping the increase would misplace the
// `end` of every method, which is the commoner line.
//
// [line, opens a body, closes one]
const cases = [
	['namespace test as', true, false],
	['export namespace test as', true, false],
	['namespace test as end', false, false],
	['  public function testing()', true, false],
	['  private function hidden()', true, false],
	['  public struct Point as', true, false],
	['  public local count = 1', false, false],
	['function toplevel()', true, false],
	['local function helper()', true, false],
	['  if x then', true, false],
	['  end', false, true],
	['else', true, true],
	['x = 1', false, false],
	// An arm of a `match` leaves the rules alone: no pattern writes
	// its column.
	['    case Ok(v) then print(v)', false, false],
	['    default "none"', false, false],
	// A name that opens with a word of the close list keeps its indent.
	['end_time = 0', false, false],
	['endpoint.x = 1', false, false],
	['elsewhere()', false, false],
	['until_now = 2', false, false],
	['end)', false, true],
	// An opener away from the front of the line. Each line is a hit in
	// ~/Documents/alloy-examples.
	['local twice = async do', true, false], // 03_async:65
	['    local combined = try do', true, false], // 04_result:50
	['local first = async do', true, false], // 13_std:63
	['type function Keys(t)', true, false], // 09:41, 12:30
	['type function F(', true, false],
	['declare extern type PluginToolbar with', true, false], // 12:7
	['    local Build(model_name) = job else', true, false], // 06:84
	['attribute service(n: string) on impl as', true, false],
	['export class Widget as', true, false],
	['declare class Part as', true, false],
	['export impl Vector3 as', true, false],
	['interface SaveData extends Serializable as', true, false],
	['return match color with', true, false],
	[
		'for _, player in Players:GetPlayers() where player.Team ~= nil do',
		true,
		false,
	],
	// A `function(` that ends the line opens a body wherever it sits.
	['    table.sort(order, function(a, b)', true, false], // 03_async:47
	['local ping = async function(): number', true, false], // 03_async:76
	[
		'    Damage.on(function(sender: Player, target: Player, amount: number)',
		true,
		false,
	], // 16_remotes:63
	['    Chat.on(function(sender: Player, text: string)', true, false], // 16_remotes:67
	['    Chat.on_ratelimited(function(sender: Player)', true, false], // 16_remotes:71
	[
		'    GetProfile.on(async function(sender: Player, id: number): Profile',
		true,
		false,
	], // 16_remotes:76
	['    JoinTeam.on(function(sender: Player, team: Team)', true, false], // 16_remotes:82
	['    Ping.on(function(sender: Player, sent_at: number)', true, false], // 16_remotes:86
	['    Toast.on(function(message: string, seconds: number)', true, false], // 16_remotes:97
	['    Confirm.on(function(prompt: string): boolean', true, false], // 16_remotes:101
	['    Ping.on(function(sent_at: number)', true, false], // 16_remotes:133
	['        self.health.on_death = function()', true, false], // 14_oop:144
	[
		'        self.connections:push(player.CharacterAdded:Connect(function()',
		true,
		false,
	], // 14_oop:147
	['            Activated={function()', true, false], // 11_ui.alx:17
	['    local rows = props.items:map(function(item)', true, false], // 11_ui.alx:28
	['x = function()', true, false],
	['    macro clamp01(x)', true, false], // 20_macros:6
	// A block that closes on its own line opens nothing.
	['function f() return 1 end', false, false],
	['macro m(x) $dbg(x) end', false, false],
	['if x then return end', false, false],
	['struct X as x: number end', false, false],
	['    function(acc: number, x) return acc + x end,', false, false], // 13_std:21
	['    function(n) return n * n end', false, false], // 13_std:103
	['local doubled = xs:map(function(x) return x * 2 end)', false, false], // 13_std:18
	[
		'local heartbeat = scope:add(RunService.Heartbeat:Connect(function() end))',
		false,
		false,
	], // 13_std:97
	// A comment neither opens a body nor hides one.
	['-- if x then', false, false],
	['    -- local t = {', false, false],
	['x = 1 -- if y then', false, false],
	['local t = { -- note', true, false],
	['local twice = async do -- a thread of its own', true, false],
	// A signature with no body of its own.
	['declare function warn_once(message: string): ()', false, false], // 12:5
	[
		'export remote function GetProfile(id: number) -> Profile from client',
		false,
		false,
	], // 16_remotes:12
	[
		'export remote function Confirm(prompt: string): boolean from server',
		false,
		false,
	], // 16_remotes:31
	['export attribute server_only on function', false, false], // 21:9
	['attribute icon(asset: string) on struct, enum, variant', false, false], // 21:10
	// A declaration header needs no `as` when its body starts on the
	// next line. Attributes, `export default`, and a visibility word can
	// come first, and a generic default holds an `=`.
	['struct P', true, false],
	['enum E', true, false],
	['trait T', true, false],
	['interface I extends J', true, false],
	['namespace N', true, false],
	['impl T for P', true, false],
	['impl Box<T>', true, false],
	['export struct P -- a point', true, false],
	['    public struct Point', true, false],
	['    private enum Inner', true, false],
	['export default struct Config', true, false],
	['export default enum Mode', true, false],
	['struct Box<T = number>', true, false],
	['struct Box<T = Array<number>>', true, false],
	['@derive(Eq) struct R', true, false],
	['@derive(Eq, Hash) @icon("x") export enum R', true, false],
	['@derive(Eq) struct R as', true, false],
	['@derive(Eq)', false, false],
	['struct P end', false, false],
	// A declaration word is a name unless a name follows it.
	['print(macro)', false, false],
	['macro(1)', false, false],
	['local r = macro(1)', false, false],
	['export macro m2(x)', true, false],
	['print(trait, macro)', false, false],
	['local struct = 1', false, false],
	['local trait = 1', false, false],
	['trait = trait + 1', false, false],
	['t.impl = 2', false, false],
	['local impl = { run = function() end }', false, false],
	['local remote = folder.Hit', false, false],
	['remote:FireServer()', false, false],
	// A long string opens no body, so its text keeps its column. After
	// `$map` or `$set` the brackets open the pairs.
	['local s = [[', false, false],
	['local s = [==[', false, false],
	['local s = [[ -- note', false, false],
	['foo([[', false, false],
	['local t = [', true, false],
	['local m = $map[[', true, false],
	// A declaration word is the scrutinee of a `match`: `with` is no name.
	['match trait with', true, false],
	['match enum with', true, false],
	['match macro with', true, false],
	['match attribute with', true, false],
	['local ok = macro and f()', false, false],
	// Generics nest three deep, and a class header needs no `as`.
	['struct Box<T = HashMap<string, Array<number>>>', true, false],
	['declare class Foo', true, false],
	['export class Widget', true, false],
	['local class = 1', false, false],
]

// A body-less signature keeps its column for the next line, in a trait,
// an interface, and a declare block; a method with a body stays open.
{
	const trait = ['trait Weapon as', '    function damage(self): number', '']
	assert.equal(signatureIndent(trait, 2), '    ', 'trait signature')

	const withDefault = [
		'export trait Weapon as',
		'    function describe(self): string',
		'        return "x"',
		'    end',
		'    function fire(self, target: Health)',
		'',
	]
	assert.equal(
		signatureIndent(withDefault, 5),
		'    ',
		'after a default method',
	)

	const declared = [
		'declare extern type CFrame with',
		'    function inverse(self): CFrame',
		'',
	]
	assert.equal(signatureIndent(declared, 2), '    ', 'declare block')

	const body = ['local function f(x: number): number', '']
	assert.equal(signatureIndent(body, 1), undefined, 'a function with a body')

	const noAs = ['trait Weapon', '    function damage(self): number', '']
	assert.equal(signatureIndent(noAs, 2), '    ', 'trait with no `as`')

	const attributed = [
		'@derive(Eq) export default interface Shape',
		'    function area(self): number',
		'',
	]
	assert.equal(
		signatureIndent(attributed, 2),
		'    ',
		'attributes and `export default`',
	)

	const visible = [
		'namespace N',
		'    public trait Shape',
		'        function area(self): number',
		'',
	]
	assert.equal(signatureIndent(visible, 3), '        ', 'public trait')

	// `trait` here is a local, so the function below it has a body.
	const named = ['trait = 1', 'function f(x): number', '']
	assert.equal(signatureIndent(named, 2), undefined, 'a local named trait')
}

// The `end` under a signature closes the block of signatures, so it
// takes the column of the trait, the interface, or the declare block.
// Under a function header with a body, it closes that body.
{
	const trait = [
		'trait Named',
		'    function name(self): string',
		'    function tag(self): string',
		'end',
	]
	assert.equal(signatureEndIndent(trait, 3), '', 'trait end')

	const nested = [
		'namespace N',
		'    public interface Shape',
		'        function area(self): number',
		'    end',
	]
	assert.equal(signatureEndIndent(nested, 3), '    ', 'nested interface end')

	const declared = [
		'declare extern type CFrame with',
		'    function inverse(self): CFrame',
		'end',
	]
	assert.equal(signatureEndIndent(declared, 2), '', 'declare block end')

	const body = ['impl P', '    function len(self): number', 'end']
	assert.equal(signatureEndIndent(body, 2), undefined, 'a method body end')

	assert.equal(
		signatureEndIndent(
			['trait Named', '    function name(self): string', 'x'],
			2,
		),
		undefined,
		'a line that is no end',
	)
}

// .alx: a tag that stays open indents, and its close dedents.
const alx = JSON.parse(
	fs.readFileSync(
		path.join(here, '..', 'language-configuration-alx.json'),
		'utf8',
	),
).indentationRules
const alxCases = [
	['\t<Frame Size={size}>', true, false],
	['<Frame', true, false],
	['<TextLabel Text="hi" />', false, false],
	['<TextLabel>hi</TextLabel>', false, false],
	['</Frame>', false, true],
	['/>', false, true],
	['if open then', true, false],
]

for (const [line, opens, closes] of alxCases) {
	assert.equal(
		new RegExp(alx.increaseIndentPattern).test(line),
		opens,
		`alx increase: ${line}`,
	)
	assert.equal(
		new RegExp(alx.decreaseIndentPattern).test(line),
		closes,
		`alx decrease: ${line}`,
	)
}

for (const [line, opens, closes] of cases) {
	assert.equal(increase.test(line), opens, `increase: ${line}`)
	assert.equal(decrease.test(line), closes, `decrease: ${line}`)
	// An .alx file holds Alloy code, which indents the same there.
	assert.equal(
		new RegExp(alx.increaseIndentPattern).test(line),
		opens,
		`alx increase: ${line}`,
	)
}

const UNIT = '    '

const indentOf = (line) => line.slice(0, line.length - line.trimStart().length)

/** VS Code's `unshiftIndent`: one level out, and never past zero. */
const unshift = (indent) => indent.slice(UNIT.length)

/**
 * `getInheritIndentForLine`: the line above that decides this one, and
 * whether it opens a block. `honor` is the editor's
 * `honorIntentialIndent`, which is true on Enter and false on type.
 */
function inherit(lines, index, honor) {
	let above = index - 1

	while (above >= 0 && lines[above].trim() === '') {
		above--
	}

	if (above < 0) {
		return { indent: '', action: null }
	}

	if (increase.test(lines[above])) {
		return { indent: indentOf(lines[above]), action: 'indent' }
	}

	if (decrease.test(lines[above]) || above === 0 || honor) {
		return { indent: indentOf(lines[above]), action: null }
	}

	// The indentation of a line under a block opener is temporary, so
	// the search reads on until a line that opens or closes a block.
	for (let i = above; i >= 0; i--) {
		if (increase.test(lines[i])) {
			return { indent: indentOf(lines[i]), action: 'indent' }
		}

		if (decrease.test(lines[i])) {
			return { indent: indentOf(lines[i]), action: null }
		}
	}

	return { indent: indentOf(lines[0]), action: null }
}

/** `getIndentForEnter`: where Enter leaves the new line. */
function afterEnter(lines, index) {
	const found = inherit(lines, index, true)

	return found.action === 'indent' ? found.indent + UNIT : found.indent
}

/** `getIndentActionForType`: where the first word of the line leaves
 *  it, once the editor's own rules have had their say. */
function afterTyping(lines, index) {
	if (!decrease.test(lines[index])) {
		return afterEnter(lines, index)
	}

	const found = inherit(lines, index, false)

	return found.action === 'indent' ? found.indent : unshift(found.indent)
}

/** The column the reader ends up with: the extension's answer when it
 *  has one, else the editor's. */
function column(lines, index) {
	return (
		matchIndent(lines, index, UNIT) ??
		signatureEndIndent(lines, index) ??
		afterTyping(lines, index)
	).length
}

// [name, lines, the line typed, its column]
const arms = [
	[
		'the first arm after `match ... with`',
		[
			'match parse_volume("2") with',
			'    case Ok(v) then print("volume", v)',
			'    case Err(msg) then warn(msg)',
			'    default warn("none")',
			'end',
		],
		1,
		4,
	],
	['a later arm after a one-line arm', null, 2, 4],
	['`default` after a one-line arm', null, 3, 4],
	['`end` after a one-line arm', null, 4, 0],
	[
		'the first arm of a match in a function',
		[
			'local function handle(msg: Msg)',
			'    match msg with',
			'        case Join(p) then',
			'            print("welcome", p.Name)',
			'        case Chat(p, text) then',
			'            print(text)',
			'        default',
			'            warn("unhandled message")',
			'    end',
			'end',
		],
		2,
		8,
	],
	['a later arm after a multi-line arm body', null, 4, 8],
	['`default` after a multi-line arm body', null, 6, 8],
	['`end` after a multi-line arm body', null, 8, 4],
	['the `end` of the function', null, 9, 0],
	[
		'an arm of a match in a namespace',
		[
			'namespace Colors as',
			'    public function hex(color: Color): string',
			'        return match color with',
			'            case "Red" then "#ff0000"',
			'            default "#000000"',
			'        end',
			'    end',
			'end',
		],
		3,
		12,
	],
	['`default` after an arm in a namespace', null, 4, 12],
	['the `end` of that match', null, 5, 8],
	['the `end` of the member', null, 6, 4],
	['the `end` of the namespace', null, 7, 0],
	[
		'an arm of a match nested in an arm',
		[
			'match msg with',
			'    case Join(p) then',
			'        match p.state with',
			'            case Idle then nil',
			'        end',
			'    default nil',
			'end',
		],
		3,
		12,
	],
	['the `end` of the inner match', null, 4, 8],
	['`default` of the outer match, under an `end`', null, 5, 4],
	['the `end` of the outer match', null, 6, 0],
	[
		'`default` as the only arm',
		['match color with', '    default "#000000"', 'end'],
		1,
		4,
	],
	['the `end` of a match with one `default`', null, 2, 0],
	// `macro` opens a block the scan must count, as block_end.rs does.
	[
		'`default` under a macro block in an arm',
		[
			'match z with',
			'    case Ok(v) then',
			'        macro m(a)',
			'            a',
			'        end',
			'    default nil',
			'end',
		],
		5,
		4,
	],
	['the `end` of a match with a macro block', null, 6, 0],
	// An opener word inside a string opens nothing.
	[
		'`default` under a string that holds an opener',
		[
			'match z with',
			'    case Ok(v) then',
			'        print("function")',
			'        print(`{v} end`)',
			'    default nil',
			'end',
		],
		4,
		4,
	],
	['the `end` of a match with such a string', null, 5, 0],
	// A declaration word opens a block only before a name.
	[
		'`default` under declaration words used as names',
		[
			'match z with',
			'    case Ok(v) then',
			'        local trait = macro(1)',
			'        t.impl = struct.enum',
			'        print(namespace, interface)',
			'    default nil',
			'end',
		],
		5,
		4,
	],
	['the `end` of a match with such names', null, 6, 0],
	[
		'`default` under an attribute with no body',
		[
			'match z with',
			'    case Ok(v) then',
			'        attribute server_only on function',
			'        remote function Get(id: number): number from server',
			'    default nil',
			'end',
		],
		4,
		4,
	],
	// A long string and a block comment hide the words they hold, over
	// lines.
	[
		'`default` under a long string over lines',
		[
			'match z with',
			'    case Ok(v) then',
			'        local s = [==[',
			'if x then',
			'    for i = 1, 3 do',
			']==]',
			'    default nil',
			'end',
		],
		6,
		4,
	],
	['the `end` of a match with a long string', null, 7, 0],
	[
		'`default` under a block comment over lines',
		[
			'match z with',
			'    case Ok(v) then',
			'        --[[',
			'        if x then',
			'        ]] print(v)',
			'    default nil',
			'end',
		],
		5,
		4,
	],
	// `$map[[` opens a list of pairs, so the `end` after it counts.
	[
		'`default` under a `$map` over lines',
		[
			'match z with',
			'    case Ok(v) then',
			'        if v then',
			'            local m = $map[[1, 2],',
			'                [3, 4],',
			'            ]',
			'        end',
			'    default nil',
			'end',
		],
		7,
		4,
	],
	// A declaration word as a scrutinee opens the `match` alone.
	[
		'a `case` after a nested `match trait with`',
		[
			'match x with',
			'    case 1 then',
			'        match trait with',
			'            case 2 then nil',
			'        end',
			'    case 3 then nil',
			'end',
		],
		5,
		4,
	],
	['the `end` after a nested `match trait with`', null, 6, 0],
	[
		'an arm of `match attribute with`',
		['match attribute with', '    case 1 then nil', '    default nil', 'end'],
		1,
		4,
	],
	['`default` of `match attribute with`', null, 2, 4],
	['the `end` of `match attribute with`', null, 3, 0],
	[
		'an arm of `match macro with` in `match enum with`',
		[
			'match enum with',
			'    case A then',
			'        match macro with',
			'            default nil',
			'        end',
			'    default nil',
			'end',
		],
		3,
		12,
	],
	['`default` after `match macro with`', null, 5, 4],
	// A method or a field named `match`, a local named `class`, and an
	// if-expression open no block.
	[
		'`default` under names and if-expressions',
		[
			'match z with',
			'    case Ok(s) then',
			'        local ok = s:match("x")',
			'        local n = string.match(s, "%d")',
			'        local class = 1',
			'        local v = if ok then 1 else 2',
			'        print(if ok then "a" else "b")',
			'        f(v, if ok then 1 else 2)',
			'        local w = if a then if b then 1 else 2 else 3',
			'        if ok then print(v) end',
			'    default nil',
			'end',
		],
		10,
		4,
	],
	['the `end` of a match with if-expressions', null, 11, 0],
	// The editor reads a signature as a function header; the extension
	// writes the `end` of the trait at the trait's column.
	[
		'the `end` of a trait after a signature',
		[
			'trait Named',
			'    function name(self): string',
			'    function tag(self): string',
			'end',
		],
		3,
		0,
	],
	[
		'the `end` of a method in an impl',
		['impl P', '    function len(self): number', '    end', 'end'],
		2,
		4,
	],
]

let lines = []

for (const [name, document, index, expected] of arms) {
	lines = document ?? lines

	assert.equal(column(lines, index), expected, `${name}: ${lines[index]}`)
}

// The editor's rules give an arm under `match attribute with` the same
// column, so this asks the extension itself: the line is a match head.
assert.equal(
	matchIndent(['match attribute with', 'case 1 then nil'], 1, UNIT),
	UNIT,
	'matchIndent under `match attribute with`',
)

console.log(`indent rules: ${cases.length} lines ok`)
console.log(`match columns: ${arms.length} lines ok`)
