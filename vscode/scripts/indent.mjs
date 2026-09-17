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
]

let lines = []

for (const [name, document, index, expected] of arms) {
	lines = document ?? lines

	assert.equal(column(lines, index), expected, `${name}: ${lines[index]}`)
}

console.log(`indent rules: ${cases.length} lines ok`)
console.log(`match columns: ${arms.length} lines ok`)
