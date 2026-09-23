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

The scan reads the text, past comments and past the body of a string:
the server's own block scan walks tokens, so an `end` it reads there
closes nothing.
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
	'macro',
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

/** The code of a line: the text in front of a `--` comment, with the
 *  body of every string dropped. A `--` or an opener word inside a
 *  string is text; the `{...}` hole of a backtick string is code, and
 *  holds strings of its own. */
function code(line: string): string {
	// The strings open here, innermost last. A `{` stands for a hole.
	const open: string[] = []
	let out = ''

	for (let i = 0; i < line.length; i++) {
		const c = line[i]
		const inside = open.at(-1)

		if (inside !== undefined && inside !== '{') {
			if (c === '\\') {
				i++
			} else if (c === inside) {
				open.pop()
			} else if (inside === '`' && c === '{') {
				open.push('{')
			}
		} else if (c === '"' || c === "'" || c === '`') {
			open.push(c)
		} else if (inside === '{' && c === '}') {
			open.pop()
		} else if (c === '-' && line[i + 1] === '-') {
			return out
		} else {
			out += c
		}
	}

	return out
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

/** A line that opens a body of signatures: a trait, an interface, or a
 *  declaration of a class or an extern type. */
const SIGNATURES =
	/^\s*(?:export\s+)?(?:trait|interface|declare\s+class|declare\s+extern\s+type)\b/

/** A function header that ends the line with no body after it. */
const SIGNATURE =
	/^\s*(?:(?:public|private)\s+)?(?:async\s+)?function\s+[\w.:]+\s*(?:<[^>]*>)?\s*\(.*\)(?:\s*(?:->|:)\s*\S.*)?$/

/**
 * The indentation of the line after a signature in a trait, an
 * interface, or a `declare` block: the signature's own, since it opens
 * no body. Undefined leaves the line to the editor's rules.
 *
 * The scan walks up to the block around the line. A signature there
 * opens nothing; a method with a body counts as the block it is.
 */
export function signatureIndent(
	lines: readonly string[],
	index: number,
): string | undefined {
	const above = code(lines[index - 1] ?? '').trimEnd()

	if (!SIGNATURE.test(above)) {
		return undefined
	}

	let depth = 0

	for (let i = index - 1; i >= 0; i--) {
		const text = code(lines[i] ?? '').trimEnd()

		if (text.trim() === '' || (depth === 0 && SIGNATURE.test(text))) {
			continue
		}

		depth += closes(text)

		// `declare extern type X with` opens its block with no opener word.
		const open = SIGNATURES.test(text) ? Math.max(1, opens(text)) : opens(text)

		if (open > depth) {
			return SIGNATURES.test(text)
				? above.slice(0, above.length - above.trimStart().length)
				: undefined
		}

		depth -= open
	}

	return undefined
}
