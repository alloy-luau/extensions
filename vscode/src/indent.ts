/*
Where the words of a `match` belong.

The editor re-indents a line the moment a typed character makes the
line match `decreaseIndentPattern`. It then takes the nearest line
above that opens or closes a block and writes that line's own
indentation, one level out from it when that line opens no block
(`getIndentActionForType` in
src/vs/editor/common/languages/autoIndent.ts). A pattern therefore
never writes a column one level *inside* its reference line, which is
the column an arm of a `match` takes, and `case` and `end` under the
same arm body take different columns from one reference. So the
extension writes the column for `case`, `default`, and the `end` that
closes a `match`.

The scan reads the text. A string that holds `end` counts as a close,
the way the server's own block scan counts it.
*/

/** The words that open a block an `end` or an `until` closes. */
const OPENERS = new Set([
	'function',
	'if',
	'for',
	'while',
	'do',
	'match',
	'repeat',
	'struct',
	'trait',
	'impl',
	'enum',
	'interface',
	'namespace',
	'attribute',
	'class',
])

/** The word a line of a `match` opens with, and its indentation. */
const WORD = /^([ \t]*)(case|default|end)\b/

/** A `match` head: the `with` ends it and the arms follow. */
const HEAD = /\bmatch\b.*\bwith$/

/** The code of a line: the text in front of a `--` comment. A `--`
 *  inside a string is text. */
function code(line: string): string {
	let quote = ''

	for (let i = 0; i < line.length; i++) {
		const c = line[i]

		if (quote !== '') {
			if (c === '\\') {
				i++
			} else if (c === quote) {
				quote = ''
			}
		} else if (c === '"' || c === "'" || c === '`') {
			quote = c
		} else if (c === '-' && line[i + 1] === '-') {
			return line.slice(0, i)
		}
	}

	return line
}

function words(text: string): string[] {
	return text.split(/[^A-Za-z0-9_]+/).filter((word) => word.length > 0)
}

/** How many blocks a line opens. The `do` of a `for` or a `while`
 *  belongs to the loop, so the pair opens one block, not two. */
function opens(text: string): number {
	const list = words(text)
	const count = list.filter((word) => OPENERS.has(word)).length

	if (!list.some((word) => word === 'for' || word === 'while')) {
		return count
	}

	return count - list.filter((word) => word === 'do').length
}

/** How many blocks a line closes. */
function closes(text: string): number {
	return words(text).filter((word) => word === 'end' || word === 'until').length
}

/** The indentation of the `match` whose body holds the line, or
 *  undefined when the line sits in another block. The scan counts the
 *  blocks upward, so the nearest open `match` wins. */
function opener(lines: readonly string[], index: number): string | undefined {
	let depth = 0

	for (let i = index - 1; i >= 0; i--) {
		const text = code(lines[i] ?? '').trimEnd()

		if (text.trim() === '') {
			continue
		}

		depth += closes(text)

		const open = opens(text)

		// More opened here than the scan closed below: this line opens
		// the block the caret sits in.
		if (open > depth) {
			return HEAD.test(text)
				? text.slice(0, text.length - text.trimStart().length)
				: undefined
		}

		depth -= open
	}

	return undefined
}

/**
 * The indentation the first word of `lines[index]` takes, when that
 * word belongs to a `match`: one `unit` inside the `match` for an arm,
 * the `match`'s own for its `end`. Undefined leaves the line to the
 * editor's indentation rules.
 */
export function matchIndent(
	lines: readonly string[],
	index: number,
	unit: string,
): string | undefined {
	const word = WORD.exec(lines[index] ?? '')

	if (word === null) {
		return undefined
	}

	const found = opener(lines, index)

	if (found === undefined) {
		return undefined
	}

	return word[2] === 'end' ? found : found + unit
}
