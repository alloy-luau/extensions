// Prints the TextMate tokens the grammar gives a file, one line per
// source line, so a scope that leaks past its block shows up.
// Usage: node scripts/tokens.mjs path/to/file.aly [first-line] [last-line]
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
	'source.daly': 'daly',
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

const file = process.argv[2]
const first = Number(process.argv[3] ?? 1)
const last = Number(process.argv[4] ?? Infinity)
const scope = file.endsWith('.alx')
	? 'source.alx'
	: file.endsWith('.d.aly')
		? 'source.daly'
		: 'source.aly'
const grammar = await registry.loadGrammar(scope)
let state = vsctm.INITIAL
const lines = fs.readFileSync(file, 'utf8').split('\n')

lines.forEach((line, i) => {
	const result = grammar.tokenizeLine(line, state)
	state = result.ruleStack

	if (i + 1 < first || i + 1 > last) return

	const parts = result.tokens.map((t) => {
		const scopes = t.scopes
			.slice(1)
			.map((s) => s.replace(/\.(aly|alx|daly)$/, ''))

		return `${JSON.stringify(line.slice(t.startIndex, t.endIndex))} ${scopes.join(' ')}`
	})
	console.log(`${i + 1}: ${parts.join('  |  ')}`)
})
