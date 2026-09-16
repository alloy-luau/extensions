// Checks the indentation rules of language-configuration.json against
// lines the editor re-indents. A namespace opens a body, and a member
// keeps its visibility word, so both must raise the indent.
// Usage: node scripts/indent.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rules = JSON.parse(
	fs.readFileSync(path.join(here, '..', 'language-configuration.json'), 'utf8'),
).indentationRules
const increase = new RegExp(rules.increaseIndentPattern)
const decrease = new RegExp(rules.decreaseIndentPattern)

// [line, opens a body, closes one]
const cases = [
	['namespace test as', true, false],
	['export namespace test as', true, false],
	['namespace test as end', false, false],
	['  public function testing()', true, false],
	['  private function hidden()', true, false],
	['  public struct Point as', true, false],
	['  public local count = 1', false, false],
	['function toplevel()', true, false],
	['local function helper()', true, false],
	['  if x then', true, false],
	['  end', false, true],
	['else', true, true],
	['x = 1', false, false],
]

for (const [line, opens, closes] of cases) {
	assert.equal(increase.test(line), opens, `increase: ${line}`)
	assert.equal(decrease.test(line), closes, `decrease: ${line}`)
}

console.log(`indent rules: ${cases.length} lines ok`)
