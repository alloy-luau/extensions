/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: the `${1}` forms are VS Code snippet placeholders */

/**
 * `alloy.toml` support: completion, hover, and diagnostics for the
 * project file, from one table of what the compiler accepts. The
 * compiler rejects an unknown key, so the editor flags it first.
 *
 * The docs here mirror `alloy/src/config.rs` in the alloy repository;
 * keep them in step when a key changes.
 */

import { exec } from 'node:child_process'
import {
	CompletionItem,
	CompletionItemKind,
	type CompletionItemProvider,
	Diagnostic,
	type DiagnosticCollection,
	DiagnosticSeverity,
	type ExtensionContext,
	Hover,
	type HoverProvider,
	languages,
	MarkdownString,
	type Position,
	Range,
	SnippetString,
	type TextDocument,
	workspace,
} from 'vscode'

export const LANGUAGE = 'alloy-toml'

type Key = {
	name: string
	type: string
	default: string
	doc: string
	/** Fixed choices, offered as values. */
	values?: string[]
	/** A snippet for the value, when a plain default is not enough. */
	snippet?: string
}

type Table = {
	name: string
	doc: string
	keys: Key[]
	/** The table takes any key; each one has this shape. */
	open?: { type: string; doc: string; snippet: string }
}

const LINTS_FALLBACK = [
	'optional_access',
	'unreachable_default',
	'empty_default',
	'deprecated_global',
	'unused_import',
	'implicit_any',
	'missing_return_type',
]

/** The lints, from `alloy doc --json` when the binary answers, so a
 *  new lint reaches the editor without an extension release. */
let lints: string[] = LINTS_FALLBACK

const lintList = (): Key['values'] => lints

export const TABLES: Table[] = [
	{
		name: 'build',
		doc: 'What compiles, and where the output goes.',
		keys: [
			{
				name: 'in',
				type: 'string',
				default: '"src"',
				doc: 'The source root. Every `.aly` and `.alx` under it compiles, relative to the folder that holds this file.',
			},
			{
				name: 'out',
				type: 'string',
				default: '"build"',
				doc: 'The output root. The tree under `in` is mirrored under it, and the runtime is written beside it as `alloy.luau`.',
			},
			{
				name: 'exclude',
				type: 'string[]',
				default: '[]',
				doc: 'Glob patterns, relative to `in`, of sources to skip.',
				snippet: '["${1:**/*.test.aly}"]',
			},
			{
				name: 'clean',
				type: 'bool',
				default: 'false',
				doc: 'Delete an output whose source is gone.',
				values: ['true', 'false'],
			},
			{
				name: 'artifact',
				type: '"ship" | "check"',
				default: '"ship"',
				doc: 'Which artifact to write. `ship` runs on Roblox; `check` is what luau-lsp sees, with the types kept.',
				values: ['"ship"', '"check"'],
			},
		],
	},
	{
		name: 'emit',
		doc: 'The few knobs that change what emitted code does.',
		keys: [
			{
				name: 'wait_timeout',
				type: 'number',
				default: 'unset',
				doc: 'Seconds passed to every `WaitForChild` that `=>` emits. Unset means no timeout: the engine waits forever and warns after five seconds. With a timeout the call can return nil, so `=>` guards like `->`.',
				snippet: '${1:5}',
			},
			{
				name: 'std_require',
				type: 'string',
				default: 'unset',
				doc: 'The string emitted code passes to `require` for the runtime. Unset means a relative path to the `alloy.luau` the build writes, or the instance path through the mounts.',
				snippet: '"${1:@alloy}"',
			},
			{
				name: 'erase_type_imports',
				type: 'bool',
				default: 'false',
				doc: 'Blank `import type` lines in the output so they add no runtime dependency. The output is then untyped for anyone who analyzes it directly.',
				values: ['true', 'false'],
			},
		],
	},
	{
		name: 'lint',
		doc: 'Which lints `alloy lint` runs, and at what level. `alloy doc lints` names them.',
		keys: [
			{
				name: 'strict',
				type: 'bool',
				default: 'false',
				doc: 'Turns the strict-only lints on: `implicit_any` and `missing_return_type`.',
				values: ['true', 'false'],
			},
			{
				name: 'deny',
				type: 'string[]',
				default: '[]',
				doc: 'Lints that fail the run.',
				snippet: '["${1}"]',
				values: lintList(),
			},
			{
				name: 'warn',
				type: 'string[]',
				default: '[]',
				doc: 'Lints that print and pass.',
				snippet: '["${1}"]',
				values: lintList(),
			},
			{
				name: 'allow',
				type: 'string[]',
				default: '[]',
				doc: 'Lints that stay silent.',
				snippet: '["${1}"]',
				values: lintList(),
			},
		],
	},
	{
		name: 'project',
		doc: 'The Rojo project the mounts describe.',
		keys: [
			{
				name: 'name',
				type: 'string',
				default: '"game"',
				doc: 'The name in `default.project.json` and `.alloy/build.project.json`.',
			},
			{
				name: 'runtime',
				type: 'string',
				default: '"@game/ReplicatedStorage/Alloy"',
				doc: "Where `alloy.luau` mounts. Emitted code requires it by a relative instance path from each file's mount.",
				snippet: '"@game/${1:ReplicatedStorage}/${2:Alloy}"',
			},
			{
				name: 'sourcemap',
				type: 'bool',
				default: 'true',
				doc: 'Write `.alloy/sourcemap.json` on every build. The language server reads it for `@game/` completion and instance types.',
				values: ['true', 'false'],
			},
		],
	},
	{
		name: 'mount',
		doc: 'Where each folder lands in the DataModel: `alias = [path, mount]`. The folder at `path` lands at `mount`, `require("@alias/x")` resolves through it, and with one or more mounts `alloy build` writes `default.project.json` over the sources and `.alloy/build.project.json` over the output.',
		keys: [],
		open: {
			type: '[string, string]',
			doc: 'The path on disk, relative to this file, and the DataModel location as `@game/Service/Folder`. A `.server.` or `.client.` file name picks the script class; `init` names its directory.',
			snippet:
				'${1:server} = ["${2:src/server}", "@game/${3:ServerScriptService}/${4:Server}"]',
		},
	},
]

const SERVICES = [
	'ReplicatedStorage',
	'ServerScriptService',
	'ServerStorage',
	'StarterPlayer/StarterPlayerScripts',
	'StarterPlayer/StarterCharacterScripts',
	'StarterGui',
	'Workspace',
	'ReplicatedFirst',
]

function table(name: string): Table | undefined {
	return TABLES.find((t) => t.name === name)
}

/** The table a line sits in: the last `[name]` header above it. */
function tableAt(document: TextDocument, line: number): string | undefined {
	for (let i = line; i >= 0; i -= 1) {
		const m = document.lineAt(i).text.match(/^\s*\[\s*([A-Za-z_][\w.-]*)\s*\]/)
		if (m) return m[1]
	}
	return undefined
}

function keyDoc(t: Table, k: Key): MarkdownString {
	const md = new MarkdownString()
	md.appendCodeblock(
		`[${t.name}]\n${k.name} = ${k.default === 'unset' ? '…' : k.default}`,
		'toml',
	)
	md.appendMarkdown(`**${k.type}** · default \`${k.default}\`\n\n${k.doc}`)
	return md
}

function tableDoc(t: Table): MarkdownString {
	const md = new MarkdownString()
	md.appendCodeblock(`[${t.name}]`, 'toml')
	md.appendMarkdown(t.doc)
	if (t.keys.length > 0) {
		md.appendMarkdown('\n\n')
		for (const k of t.keys) {
			md.appendMarkdown(
				`- \`${k.name}\` **${k.type}**, default \`${k.default}\`\n`,
			)
		}
	}
	return md
}

const completion: CompletionItemProvider = {
	provideCompletionItems(document, position) {
		const line = document.lineAt(position.line).text
		const before = line.slice(0, position.character)

		// A table header: `[` at the start of a line.
		if (/^\s*\[\s*[\w.-]*$/.test(before)) {
			return TABLES.map((t) => {
				const item = new CompletionItem(t.name, CompletionItemKind.Module)
				item.detail = `[${t.name}]`
				item.documentation = tableDoc(t)
				return item
			})
		}

		const current = tableAt(document, position.line)
		const t = current ? table(current) : undefined

		// A value: after `=`.
		const eq = before.indexOf('=')
		if (eq >= 0) {
			const key = before.slice(0, eq).trim()
			const k = t?.keys.find((x) => x.name === key)
			const inArray = before.slice(eq + 1).includes('[')

			if (k?.values && k.values.length > 0) {
				return k.values.map((v) => {
					const text =
						inArray && !v.startsWith('"') && !/^(true|false)$/.test(v)
							? `"${v}"`
							: v
					const item = new CompletionItem(text, CompletionItemKind.EnumMember)
					item.documentation = keyDoc(t as Table, k)
					return item
				})
			}

			if (t?.name === 'mount' || key === 'runtime') {
				const tail = before.slice(before.lastIndexOf('"') + 1)
				if (tail.startsWith('@game/') || tail === '') {
					return SERVICES.map((s) => {
						const item = new CompletionItem(
							`@game/${s}`,
							CompletionItemKind.Folder,
						)
						item.insertText = tail === '' ? `"@game/${s}/` : `@game/${s}/`
						item.detail = 'DataModel location'
						return item
					})
				}
			}

			return []
		}

		// A key, inside a table.
		if (!t) return []
		const items: CompletionItem[] = t.keys.map((k) => {
			const item = new CompletionItem(k.name, CompletionItemKind.Property)
			item.detail = `${k.type} · default ${k.default}`
			item.documentation = keyDoc(t, k)
			const value =
				k.snippet ??
				(k.default === 'unset'
					? '${1}'
					: k.default.replace(/^"(.*)"$/, '"${1:$1}"'))
			item.insertText = new SnippetString(`${k.name} = ${value}`)
			return item
		})

		if (t.open) {
			const item = new CompletionItem(
				'alias = [path, mount]',
				CompletionItemKind.Snippet,
			)
			item.detail = t.open.type
			item.documentation = new MarkdownString(t.open.doc)
			item.insertText = new SnippetString(t.open.snippet)
			items.push(item)
		}

		return items
	},
}

const hover: HoverProvider = {
	provideHover(document, position) {
		const line = document.lineAt(position.line).text
		const header = line.match(/^\s*\[\s*([A-Za-z_][\w.-]*)\s*\]/)

		if (header) {
			const t = table(header[1])
			return t ? new Hover(tableDoc(t)) : undefined
		}

		const key = line.match(/^\s*([A-Za-z_][\w-]*)\s*=/)
		if (!key) return undefined

		const start = line.indexOf(key[1])
		if (
			position.character < start ||
			position.character > start + key[1].length
		)
			return undefined

		const t = table(tableAt(document, position.line) ?? '')
		if (!t) return undefined

		const k = t.keys.find((x) => x.name === key[1])
		if (k)
			return new Hover(
				keyDoc(t, k),
				new Range(position.line, start, position.line, start + key[1].length),
			)

		if (t.open) {
			const md = new MarkdownString()
			md.appendCodeblock(`[mount]\n${key[1]} = [path, mount]`, 'toml')
			md.appendMarkdown(
				`**${t.open.type}**\n\n${t.open.doc}\n\n\`require("@${key[1]}/...")\` resolves through this mount.`,
			)
			return new Hover(md)
		}

		return undefined
	},
}

/** Unknown tables and keys, which the compiler rejects; a wrong value
 *  shape where the shape is fixed. */
function check(document: TextDocument): Diagnostic[] {
	const out: Diagnostic[] = []
	let current: Table | undefined
	let currentName = ''

	for (let i = 0; i < document.lineCount; i += 1) {
		const text = document.lineAt(i).text
		const header = text.match(/^\s*\[\s*([A-Za-z_][\w.-]*)\s*\]/)

		if (header) {
			currentName = header[1]
			current = table(currentName)

			if (!current) {
				const start = text.indexOf(header[1])
				out.push(
					new Diagnostic(
						new Range(i, start, i, start + header[1].length),
						`alloy.toml has no table \`${header[1]}\`; the tables are ${TABLES.map((t) => `[${t.name}]`).join(', ')}`,
						DiagnosticSeverity.Error,
					),
				)
			}

			continue
		}

		const key = text.match(/^\s*([A-Za-z_][\w-]*)\s*=\s*(.*?)\s*(#.*)?$/)
		if (!key) continue

		const start = text.indexOf(key[1])
		const range = new Range(i, start, i, start + key[1].length)

		if (currentName === '') {
			out.push(
				new Diagnostic(
					range,
					`\`${key[1]}\` sits above every table; put it under one of ${TABLES.map((t) => `[${t.name}]`).join(', ')}`,
					DiagnosticSeverity.Error,
				),
			)
			continue
		}

		if (!current) continue

		const k = current.keys.find((x) => x.name === key[1])

		if (!k && !current.open) {
			out.push(
				new Diagnostic(
					range,
					`[${current.name}] has no key \`${key[1]}\`; its keys are ${current.keys.map((x) => `\`${x.name}\``).join(', ')}`,
					DiagnosticSeverity.Error,
				),
			)
			continue
		}

		const value = key[2]

		if (k?.values && !k.values.includes(value) && !value.startsWith('[')) {
			out.push(
				new Diagnostic(
					range,
					`\`${k.name}\` takes one of ${k.values.join(', ')}`,
					DiagnosticSeverity.Error,
				),
			)
		} else if (k?.type === 'bool' && !/^(true|false)$/.test(value)) {
			out.push(
				new Diagnostic(
					range,
					`\`${k.name}\` is true or false`,
					DiagnosticSeverity.Error,
				),
			)
		} else if (k?.type === 'string[]' && !value.startsWith('[')) {
			out.push(
				new Diagnostic(
					range,
					`\`${k.name}\` is an array: \`["..."]\``,
					DiagnosticSeverity.Error,
				),
			)
		} else if (k?.type === 'string' && !/^"/.test(value) && !/^'/.test(value)) {
			out.push(
				new Diagnostic(
					range,
					`\`${k.name}\` is a string`,
					DiagnosticSeverity.Error,
				),
			)
		} else if (current.open && !k) {
			const pair = value.match(/^\[\s*"[^"]*"\s*,\s*"(@game\/[^"]*)"\s*\]$/)
			if (!pair) {
				out.push(
					new Diagnostic(
						range,
						'`[mount]` entries are `alias = ["path", "@game/Service/Folder"]`',
						DiagnosticSeverity.Error,
					),
				)
			}
		}

		if (k?.type === 'string[]' && k.values && value.startsWith('[')) {
			for (const m of value.matchAll(/"([^"]*)"/g)) {
				if (!k.values.includes(m[1])) {
					const at = text.indexOf(m[0])
					out.push(
						new Diagnostic(
							new Range(i, at, i, at + m[0].length),
							`\`${m[1]}\` is not a lint; \`alloy lint --list\` names them`,
							DiagnosticSeverity.Warning,
						),
					)
				}
			}
		}
	}

	return out
}

/** Asks the compiler for its lint names, once, and keeps the fallback
 *  when it does not answer. */
function loadLints(env: NodeJS.ProcessEnv): void {
	exec('alloy doc --json', { env }, (error, stdout) => {
		if (error) return
		try {
			const parsed = JSON.parse(stdout) as { lints?: { name: string }[] }
			const names = parsed.lints?.map((l) => l.name)
			if (names && names.length > 0) {
				lints = names
				for (const k of table('lint')?.keys ?? []) {
					if (k.values && k.values !== undefined && k.type === 'string[]')
						k.values = names
				}
			}
		} catch {
			// The fallback list stands.
		}
	})
}

export function register(
	context: ExtensionContext,
	env: NodeJS.ProcessEnv,
): void {
	const diagnostics: DiagnosticCollection =
		languages.createDiagnosticCollection('alloy.toml')
	const refresh = (document: TextDocument) => {
		if (document.languageId === LANGUAGE)
			diagnostics.set(document.uri, check(document))
	}

	context.subscriptions.push(
		diagnostics,
		languages.registerCompletionItemProvider(
			{ language: LANGUAGE },
			completion,
			'[',
			'=',
			'"',
			'/',
			'@',
		),
		languages.registerHoverProvider({ language: LANGUAGE }, hover),
		workspace.onDidOpenTextDocument(refresh),
		workspace.onDidChangeTextDocument((event) => refresh(event.document)),
		workspace.onDidCloseTextDocument((document) =>
			diagnostics.delete(document.uri),
		),
	)

	for (const document of workspace.textDocuments) refresh(document)
	loadLints(env)
}
