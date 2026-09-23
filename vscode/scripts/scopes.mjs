// Checks the scope the grammar gives a word that is both an operator
// and a free name. A rule with no lookahead colours the local, and a
// missing rule leaves the operator plain, so each case names the one
// token it cares about and the scope that token must end with.
//
// Usage: npm test
import assert from 'node:assert/strict'
import { grammarOf, scopeOf, tokenize } from './grammar.mjs'

const WORDLIKE = 'keyword.operator.wordlike.aly'
const TYPE = 'entity.name.type.aly'

// [source line, [token text, its innermost scope], ...]
const cases = [
	// `is` is a type test: the word and the type after it both colour.
	[
		'@ratelimit(5, 1)',
		['@', 'punctuation.definition.attribute.aly'],
		[',', 'punctuation.definition.attribute.aly'],
	],
	['x is Part', ['is', WORDLIKE], ['Part', TYPE]],
	['x is not Part', ['is', WORDLIKE], ['not', WORDLIKE], ['Part', TYPE]],
	['not x is Part', ['not', WORDLIKE], ['is', WORDLIKE], ['Part', TYPE]],
	['x is number', ['is', WORDLIKE], ['number', 'support.type.primitive.aly']],
	['x is Enum.Material', ['is', WORDLIKE], ['Enum.Material', TYPE]],
	['x is M.Thing', ['is', WORDLIKE], ['M.Thing', TYPE]],
	[
		'if not system is ModuleScript then',
		['is', WORDLIKE],
		['ModuleScript', TYPE],
		['then', 'keyword.control.aly'],
	],
	// The test ends at the operator after it, so `and` keeps its own
	// colour and the type never runs to the end of the line.
	['local ok = x is Part and y is Model', ['and', WORDLIKE], ['Model', TYPE]],
	// `is` is also a free name.
	['local is = 1', ['is', 'variable.other.aly']],
	['is(x)', ['is', 'entity.name.function.aly']],
	['t.is', ['is', 'variable.other.property.aly']],
	['t:is()', ['is', 'entity.name.function.aly']],
]

const grammar = await grammarOf(scopeOf('case.aly'))

for (const [line, ...wanted] of cases) {
	const [tokens] = tokenize(grammar, [line])

	for (const [text, scope] of wanted) {
		const token = tokens.find((t) => t.text === text)

		assert.ok(token, `no \`${text}\` token in: ${line}`)
		assert.equal(token.scopes.at(-1), scope, `${text} in: ${line}`)
	}
}

console.log(`token scopes: ${cases.length} lines ok`)
