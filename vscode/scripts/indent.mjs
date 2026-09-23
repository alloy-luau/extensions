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
import { matchIndent } from '../out/indent.js'

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
]

for (const [line, opens, closes] of cases) {
	assert.equal(increase.test(line), opens, `increase: ${line}`)
	assert.equal(decrease.test(line), closes, `decrease: ${line}`)
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
	return (matchIndent(lines, index, UNIT) ?? afterTyping(lines, index)).length
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
]

let lines = []

for (const [name, document, index, expected] of arms) {
	lines = document ?? lines

	assert.equal(column(lines, index), expected, `${name}: ${lines[index]}`)
}

console.log(`indent rules: ${cases.length} lines ok`)
console.log(`match columns: ${arms.length} lines ok`)
