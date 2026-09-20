// Loads the TextMate grammars of this extension, so the token harness
// and the scope test read one registry.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const require = createRequire(path.join(root, 'package.json'))
const vsctm = require('vscode-textmate')
const onig = require('vscode-oniguruma')

const wasm = fs.readFileSync(
	path.join(root, 'node_modules/vscode-oniguruma/release/onig.wasm'),
).buffer
const onigLib = onig.loadWASM(wasm).then(() => ({
	createOnigScanner: (patterns) => new onig.OnigScanner(patterns),
	createOnigString: (s) => new onig.OnigString(s),
}))
const files = {
	'source.aly': 'aly',
	'source.alx': 'alx',
	'source.d.aly': 'daly',
}
const registry = new vsctm.Registry({
	onigLib,
	loadGrammar: async (scope) => {
		const file = files[scope]

		if (!file) return null

		const text = fs.readFileSync(
			path.join(root, 'syntaxes', `${file}.tmLanguage.json`),
			'utf8',
		)

		return vsctm.parseRawGrammar(text, `${file}.tmLanguage.json`)
	},
})

/** The scope a file name asks for: `.alx`, `.d.aly`, then `.aly`. */
export const scopeOf = (file) =>
	file.endsWith('.alx')
		? 'source.alx'
		: file.endsWith('.d.aly')
			? 'source.d.aly'
			: 'source.aly'

export const grammarOf = (scope) => registry.loadGrammar(scope)

/**
 * The tokens of each line, as `{ text, scopes }`, with the root scope
 * cut. The rule stack carries over, so a block that opens on one line
 * still holds on the next.
 */
export function tokenize(grammar, lines) {
	let state = vsctm.INITIAL

	return lines.map((line) => {
		const result = grammar.tokenizeLine(line, state)
		state = result.ruleStack

		return result.tokens.map((t) => ({
			text: line.slice(t.startIndex, t.endIndex),
			scopes: t.scopes.slice(1),
		}))
	})
}
