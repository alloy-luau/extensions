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
const NAME = 'variable.other.aly'
const MEMBER = 'variable.other.enummember.aly'

// [source line, [token text, its innermost scope], ...]
const cases = [
	// `is` is a type test: the word and the type after it both colour.
	[
		'@ratelimit(5, 1)',
		['@', 'punctuation.definition.attribute.aly'],
		[',', 'punctuation.definition.attribute.aly'],
	],
	// Luau's own list: the names it takes are attributes, and the keys
	// of `deprecated`'s table are properties.
	[
		'@[native]',
		['@', 'punctuation.definition.attribute.aly'],
		['native', 'entity.other.attribute-name.aly'],
	],
	[
		"@[deprecated { use = 'mix', reason = 'renamed' }]",
		['deprecated', 'entity.other.attribute-name.aly'],
		['use', 'variable.other.property.aly'],
		['reason', 'variable.other.property.aly'],
	],
	// A star import's attribute colours its whole path.
	[
		'@serde.deny_unknown_fields',
		['serde.deny_unknown_fields', 'entity.other.attribute-name.aly'],
	],
	[
		'local v: ~nil = 1',
		['~', 'keyword.operator.type.negation.aly'],
		['nil', 'support.type.primitive.aly'],
	],
	['type N = ~string | ~number', ['~', 'keyword.operator.type.negation.aly']],
	[
		'local function g<T: ~nil>(x: T)',
		['~', 'keyword.operator.type.negation.aly'],
	],
	['if a ~= b then', ['~=', 'keyword.operator.aly']],
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
	// A declaration word is a keyword only before a name on its line
	// (`remote`, `public`, and `private` also before `function`). Every
	// other use is a name, as in Roblox code.
	['local remote = folder.Hit', ['remote', NAME]],
	['remote:FireServer()', ['remote', NAME]],
	['trait = trait + 1', ['trait', NAME]],
	['print(trait, macro)', ['trait', NAME], ['macro', NAME]],
	['macro(1)', ['macro', 'entity.name.function.aly']],
	['local attribute = 1', ['attribute', NAME]],
	['local namespace = ns', ['namespace', NAME]],
	[
		'local ok = if public then private else nil',
		['public', NAME],
		['private', NAME],
	],
	// `impl` opens a type header only before a name, so the rest of the
	// line keeps its own colours.
	[
		't.impl = 2',
		['impl', 'variable.other.property.aly'],
		['2', 'constant.numeric.aly'],
	],
	[
		'local impl = { run = function() end }',
		['impl', NAME],
		['run', NAME],
		['function', 'storage.type.aly'],
		['end', 'keyword.control.aly'],
	],
	[
		'remote Hit(n: number) from client',
		['remote', 'storage.type.remote.aly'],
		['Hit', 'entity.name.function.remote.aly'],
	],
	[
		'remote function Get(id: number): number from server',
		['remote', 'storage.type.remote.aly'],
		['Get', 'entity.name.function.remote.aly'],
	],
	['export macro m(x)', ['macro', 'storage.type.aly']],
	['impl T for P', ['impl', 'storage.type.aly'], ['P', TYPE]],
	['namespace N', ['namespace', 'storage.type.aly']],
	['trait Shape', ['trait', 'storage.type.aly']],
	['export attribute tagged on struct', ['attribute', 'storage.type.aly']],
	['private function hidden() end', ['private', 'storage.modifier.aly']],
	[
		'enum Color as Red, Green end',
		['Red', MEMBER],
		['end', 'keyword.control.aly'],
	],
	['print($map[[1, 2]])', ['1', 'constant.numeric.aly']],
	// A declaration word as the scrutinee of a `match` is a name, and
	// `with` keeps its keyword colour.
	['match trait with', ['trait', NAME], ['with', 'keyword.control.aly']],
	['match macro with', ['macro', NAME], ['with', 'keyword.control.aly']],
	[
		'match attribute with',
		['attribute', NAME],
		['with', 'keyword.control.aly'],
	],
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

// Generics nest three deep in a header: the last `>` closes the list
// and reads as no shift operator.
{
	const [tokens] = tokenize(grammar, [
		'struct Box<T = HashMap<string, Array<number>>>',
	])

	assert.equal(
		tokens.at(-1).scopes.at(-1),
		'punctuation.definition.type.generics.aly',
		'the last `>` of nested generics',
	)
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

// An enum body opens on its header with or without `as`, so a variant
// colours as a member in both forms and the body closes at its `end`.
// A `[[` long string holds its keywords as text over lines.
{
	// [lines, [row, token text, its innermost scope], ...]
	const blocks = [
		[
			['enum Shape', '    Circle(number)', '    Unit', 'end', 'local u = Unit'],
			[1, 'Circle', MEMBER],
			[1, 'number', 'support.type.primitive.aly'],
			[2, 'Unit', MEMBER],
			[3, 'end', 'keyword.control.aly'],
			[4, 'Unit', TYPE],
		],
		[
			[
				'@derive(Eq)',
				'export default enum Mode -- the modes',
				'    Fast = 1',
				'    Slow',
				'end',
			],
			[1, 'default', 'keyword.control.aly'],
			[1, 'Mode', 'entity.name.type.enum.aly'],
			[2, 'Fast', MEMBER],
			[3, 'Slow', MEMBER],
		],
		[
			['@derive(Eq) enum R', '    A(Array<number>)', 'end'],
			[0, 'R', 'entity.name.type.enum.aly'],
			[1, 'A', MEMBER],
			[1, 'Array', TYPE],
		],
		[
			['enum Result<T, E = Array<string>>', '    Ok(T)', 'end'],
			[0, 'string', 'support.type.primitive.aly'],
			[1, 'Ok', MEMBER],
			[1, 'T', TYPE],
		],
		[
			['namespace N', '    public enum Inner', '        X', '    end', 'end'],
			[1, 'public', 'storage.modifier.aly'],
			[2, 'X', MEMBER],
		],
		[
			['enum Old as', '    A', 'end'],
			[1, 'A', MEMBER],
		],
		[
			['local s = [[', 'if x then', ']]', 'local t = 1'],
			[1, 'if x then', 'string.quoted.other.multiline.aly'],
			[3, 'local', 'storage.type.aly'],
		],
		// `match enum with` opens a match, not an enum body.
		[
			['match enum with', '    case A then 1', 'end', 'local u = Unit'],
			[0, 'enum', NAME],
			[0, 'with', 'keyword.control.aly'],
			[1, 'case', 'keyword.control.aly'],
			[3, 'Unit', TYPE],
		],
	]

	for (const [lines, ...wanted] of blocks) {
		const tokens = tokenize(grammar, lines)

		for (const [row, text, scope] of wanted) {
			const token = tokens[row].find((t) => t.text === text)

			assert.ok(token, `no \`${text}\` token in: ${lines[row]}`)
			assert.equal(token.scopes.at(-1), scope, `${text} in: ${lines[row]}`)
		}
	}
}

// `.config.aly` has a language of its own, for its icon, and reads as
// Alloy through the grammar it includes.
{
	const config = await grammarOf('source.aly.config')
	const [tokens] = tokenize(config, [
		'export default { build = { out = "dist" } }',
	])
	const scope = (text) => tokens.find((t) => t.text === text).scopes.at(-1)

	assert.equal(scope('export'), 'storage.type.aly', 'export in a config')
	assert.ok(
		tokens.some((t) => t.scopes.includes('string.quoted.double.aly')),
		'a string in a config',
	)
}

// A `<style>` holds CSS up to `</style>`: `--accent` is a custom
// property there, not a Luau comment, and `{` opens no hole.
{
	const alx = await grammarOf('source.alx')
	const lines = [
		'return <div>',
		'<style>',
		':root { --accent: #7c5cff; }',
		'</style>',
		'<p>x</p>',
		'</div>',
	]
	const tokens = tokenize(alx, lines)
	const css = tokens[2]

	assert.ok(
		css.every((t) => t.scopes.includes('meta.embedded.block.css')),
		'the CSS line is CSS',
	)
	assert.ok(
		!css.some((t) => t.scopes.some((s) => s.startsWith('comment'))),
		'--accent is no comment',
	)
	assert.equal(
		tokens[4].find((t) => t.text === 'p').scopes.at(-1),
		'entity.name.tag.alx',
		'the markup after the style',
	)
}

console.log(`token scopes: ${cases.length} lines ok`)
