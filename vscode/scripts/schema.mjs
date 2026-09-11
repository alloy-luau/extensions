// Writes schemas/alloy.toml.json from the compiler's own schema.
//
// The compiler lives in the crates repository beside this one. A
// checkout that holds only this repository, which is what CI gets,
// keeps the committed schema and packages with it. Regenerating is a
// convenience for a working copy that has both repositories, and
// `alloy self schema` is the single source either way.
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = join(here, '..', '..', '..', 'crates', 'Cargo.toml')
const out = join(here, '..', 'schemas', 'alloy.toml.json')

if (!existsSync(manifest)) {
	console.log(
		'no crates checkout beside this repository; keeping the committed schema',
	)
	process.exit(0)
}

const run = spawnSync(
	'cargo',
	['run', '-q', '--manifest-path', manifest, '--', 'self', 'schema'],
	{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
)

if (run.error) {
	console.log(
		`cargo did not run (${run.error.message}); keeping the committed schema`,
	)
	process.exit(0)
}

if (run.status !== 0) {
	process.stderr.write(run.stderr ?? '')
	console.error('alloy self schema failed; the committed schema stands')
	process.exit(1)
}

writeFileSync(out, run.stdout)
console.log(`wrote ${out}`)
