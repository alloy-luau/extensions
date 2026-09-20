// Prints the TextMate tokens the grammar gives a file, one line per
// source line, so a scope that leaks past its block shows up.
// Usage: node scripts/tokens.mjs path/to/file.aly [first-line] [last-line]
import fs from 'node:fs'
import { grammarOf, scopeOf, tokenize } from './grammar.mjs'

const file = process.argv[2]
const first = Number(process.argv[3] ?? 1)
const last = Number(process.argv[4] ?? Infinity)
const grammar = await grammarOf(scopeOf(file))
const lines = fs.readFileSync(file, 'utf8').split('\n')

tokenize(grammar, lines).forEach((tokens, i) => {
	if (i + 1 < first || i + 1 > last) return

	const parts = tokens.map((t) => {
		const scopes = t.scopes.map((s) => s.replace(/\.(aly|alx|daly)$/, ''))

		return `${JSON.stringify(t.text)} ${scopes.join(' ')}`
	})

	console.log(`${i + 1}: ${parts.join('  |  ')}`)
})
