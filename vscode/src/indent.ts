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

/** The words that open a block an `end` or an `until` closes, and that
 *  Luau reserves, so no name spells them. `if`, `match`, and the
 *  declaration words have rules of their own below. */
const OPENERS = new Set(['function', 'for', 'while', 'do', 'repeat'])

/** The words that cannot be the name of a declaration or an operand.
 *  The grammar refuses the same list, so `match trait with` reads
 *  `trait` as the scrutinee. */
const KEYWORD =
	'end|then|else|elseif|do|until|and|or|not|in|is|as|satisfies|where|return|local|const|break|continue|with|from|band|bor|bxor|shl|shr'

/** A declaration word opens a block only before a name on its line, and
 *  never after `.` or `:`, as `keyword_at` in contextual.rs decides.
 *  `local trait = 1`, `macro(1)`, and `t.impl` are names. */
const DECLARATION = new RegExp(
	String.raw`(?<![.:\w])(?:struct|trait|impl|macro|enum|interface|namespace|class)[ \t]+(?!(?:${KEYWORD})\b)[A-Za-z_]`,
	'g',
)

/** `match` opens a block before a scrutinee, as the grammar reads it.
 *  `s:match(p)`, `string.match(s, p)`, and `local match = 1` are names. */
const MATCH = new RegExp(
	String.raw`(?<![.:\w])match[ \t]+(?:(?!(?:${KEYWORD})\b)[A-Za-z_$#{[]|[0-9]|-(?!-))`,
	'g',
)

/** The text in front of an `if` that makes it an expression: an
 *  operator, an open bracket, a `,`, or `return`. */
const OPERAND = /(?:[-=(,[{+*/%^<>]|\.\.|\b(?:return|and|or|not|in)\b)\s*$/

/** `attribute name(...) on function, struct as`: the targets open
 *  nothing, and only a body after `as` needs an `end`. */
const ATTRIBUTE = new RegExp(
	String.raw`(?<![.:\w])attribute[ \t]+(?!(?:${KEYWORD})\b)[A-Za-z_]`,
)

/** A `function` with no body: a remote and a declared signature. */
const BODILESS = /(?<![.:\w])(?:remote|declare)[ \t]+function\b/g

/** The word a line of a `match` opens with, and its indentation. */
const WORD = /^([ \t]*)(case|default|end)\b/

/** A `match` head: the `with` ends it and the arms follow. */
const HEAD = /\bmatch\b.*\bwith$/

/** The long bracket that opens at `i`, `[[` or `[==[`: the index past
 *  its close, or the close it waits for when the line holds none. */
function long(
	line: string,
	i: number,
): { end: number; close?: string } | undefined {
	const open = /\[(=*)\[/y
	open.lastIndex = i

	const found = open.exec(line)

	if (found === null) {
		return undefined
	}

	const close = `]${found[1]}]`
	const at = line.indexOf(close, open.lastIndex)

	return at < 0 ? { end: line.length, close } : { end: at + close.length }
}

/** The code of a line: the text in front of a `--` comment, with the
 *  body of every string dropped. A `--` or an opener word inside a
 *  string is text; the `{...}` hole of a backtick string is code, and
 *  holds strings of its own. A long string and a block comment can run
 *  over lines: `close` is the bracket the line opens inside, and the
 *  second value is the one the next line opens inside. */
function code(line: string, close?: string): [string, string | undefined] {
	// The strings open here, innermost last. A `{` stands for a hole.
	const open: string[] = []
	let out = ''
	let i = 0

	if (close !== undefined) {
		const at = line.indexOf(close)

		if (at < 0) {
			return ['', close]
		}

		i = at + close.length
	}

	for (; i < line.length; i++) {
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
			const comment = long(line, i + 2)

			if (comment === undefined || comment.close !== undefined) {
				return [out, comment?.close]
			}

			i = comment.end - 1
		} else {
			// `$map[[` opens a list of pairs, not a string.
			const string =
				c === '[' && !/\$(?:map|set)$/.test(out) ? long(line, i) : undefined

			if (string === undefined) {
				out += c
			} else if (string.close !== undefined) {
				return [out, string.close]
			} else {
				i = string.end - 1
			}
		}
	}

	return [out, undefined]
}

/** The code of each line from the first up to `last`, so a long string
 *  or a block comment that opens above a line hides its text. */
function codes(lines: readonly string[], last: number): string[] {
	const out: string[] = []
	let close: string | undefined

	for (let i = 0; i <= last; i++) {
		const [text, next] = code(lines[i] ?? '', close)
		out.push(text)
		close = next
	}

	return out
}

function words(text: string): string[] {
	return text.split(/[^A-Za-z0-9_]+/).filter((word) => word.length > 0)
}

/** How many `if` statements a line opens. An if-expression has no
 *  `end`: `local x = if a then b else c`. It follows an operand
 *  position, or the `then` or `else` of another if-expression. */
function ifs(text: string): number {
	let count = 0
	let expression = false

	for (const found of text.matchAll(/(?<![.:\w])if\b/g)) {
		const before = text.slice(0, found.index)

		expression =
			OPERAND.test(before) || (expression && /\b(?:then|else)\s*$/.test(before))

		if (!expression) {
			count++
		}
	}

	return count
}

/** How many blocks a line opens. The `do` of a `for` or a `while`
 *  belongs to the loop, so the pair opens one block, not two. */
function opens(text: string): number {
	const attribute = ATTRIBUTE.exec(text)

	if (attribute !== null) {
		return /\bas\b/.test(text.slice(attribute.index)) ? 1 : 0
	}

	const list = words(text)
	const count =
		list.filter((word) => OPENERS.has(word)).length +
		ifs(text) +
		(text.match(MATCH)?.length ?? 0) +
		(text.match(DECLARATION)?.length ?? 0) -
		(text.match(BODILESS)?.length ?? 0)

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
	const all = codes(lines, index - 1)
	let depth = 0

	for (let i = index - 1; i >= 0; i--) {
		const text = (all[i] ?? '').trimEnd()

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
 *  declaration of a class or an extern type. Attributes and a
 *  visibility word can come first; a trait or an interface needs a
 *  name, so `trait = 1` opens nothing. */
const SIGNATURES = new RegExp(
	String.raw`^\s*(?:@[A-Za-z_][\w.]*(?:\((?:[^()]|\([^()]*\))*\))?\s+)*(?:(?:export(?:\s+default)?|public|private)\s+)?(?:(?:trait|interface)[ \t]+(?!(?:${KEYWORD})\b)[A-Za-z_]|declare\s+class\b|declare\s+extern\s+type\b)`,
)

/** A function header that ends the line with no body after it. */
const SIGNATURE =
	/^\s*(?:(?:public|private)\s+)?(?:async\s+)?function\s+[\w.:]+\s*(?:<[^>]*>)?\s*\(.*\)(?:\s*(?:->|:)\s*\S.*)?$/

function indentOf(text: string): string {
	return text.slice(0, text.length - text.trimStart().length)
}

/**
 * The signature above `lines[index]` and the line that opens the block
 * around it, when that block is a trait, an interface, or a `declare`
 * block. Undefined for any other line above.
 *
 * The scan walks up to the block around the line. A signature there
 * opens nothing; a method with a body counts as the block it is.
 */
function signatureBlock(
	lines: readonly string[],
	index: number,
): { above: string; opener: string } | undefined {
	const all = codes(lines, index - 1)
	// A blank line after the signature changes nothing: the next method
	// still takes the signature's column.
	let at = index - 1

	while (at >= 0 && (all[at] ?? '').trim() === '') {
		at--
	}

	const above = (all[at] ?? '').trimEnd()

	if (!SIGNATURE.test(above)) {
		return undefined
	}

	let depth = 0

	for (let i = index - 1; i >= 0; i--) {
		const text = (all[i] ?? '').trimEnd()

		if (text.trim() === '' || (depth === 0 && SIGNATURE.test(text))) {
			continue
		}

		depth += closes(text)

		// `declare extern type X with` opens its block with no opener word.
		const open = SIGNATURES.test(text) ? Math.max(1, opens(text)) : opens(text)

		if (open > depth) {
			return SIGNATURES.test(text) ? { above, opener: text } : undefined
		}

		depth -= open
	}

	return undefined
}

/**
 * The indentation of the line after a signature in a trait, an
 * interface, or a `declare` block: the signature's own, since it opens
 * no body. Undefined leaves the line to the editor's rules.
 */
export function signatureIndent(
	lines: readonly string[],
	index: number,
): string | undefined {
	const block = signatureBlock(lines, index)

	return block === undefined ? undefined : indentOf(block.above)
}

/**
 * The indentation of an `end` typed under a signature: the column of
 * the trait, the interface, or the `declare` block it closes. The
 * editor reads the signature as a function header and keeps the `end`
 * one level in. Undefined leaves the line to the editor's rules.
 */
export function signatureEndIndent(
	lines: readonly string[],
	index: number,
): string | undefined {
	if (!/^[ \t]*end\b/.test(lines[index] ?? '')) {
		return undefined
	}

	const block = signatureBlock(lines, index)

	return block === undefined ? undefined : indentOf(block.opener)
}
