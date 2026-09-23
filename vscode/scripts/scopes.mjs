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
	['local r = total/count', ['count', 'variable.other.aly']],
	['local s = a..b', ['b', 'variable.other.aly']],
	[
		'local n = 3i + .5',
		['3i', 'constant.numeric.aly'],
		['.5', 'constant.numeric.aly'],
	],
	['$expect(x)', ['expect', 'entity.name.function.macro.intrinsic.aly']],
	['export open namespace Ui as', ['open', 'storage.modifier.aly']],
	['local h = Heap.new()', ['Heap', 'support.class.std.aly']],
	['attribute service on impl as', ['as', 'keyword.control.aly']],
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

// A union written over lines keeps its type context past the first.
{
	const lines = ['export type Id =', '\t| Part', '\t| Model', 'local x = Part']
	const tokens = tokenize(grammar, lines)
	const scope = (row, text) =>
		tokens[row].find((t) => t.text === text).scopes.at(-1)

	assert.equal(scope(2, 'Model'), TYPE, 'Model in the union')
	assert.notEqual(scope(3, 'local'), TYPE, 'the next statement leaves the type')
}

console.log(`token scopes: ${cases.length} lines ok`)
