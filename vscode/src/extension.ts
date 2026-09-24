import { exec } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import {
	commands,
	type Disposable,
	type ExtensionContext,
	extensions,
	IndentAction,
	languages,
	type OutputChannel,
	Range,
	SnippetString,
	type TextDocumentChangeEvent,
	window,
	workspace,
} from 'vscode'

/** A list setting, or nothing. A value that is not an array (a string a
 *  user typed by hand) made the spread of it throw "is not iterable" on
 *  every server restart. */
function list(
	config: ReturnType<typeof workspace.getConfiguration>,
	key: string,
): string[] {
	const value = config.get<unknown>(key)
	return Array.isArray(value)
		? value.filter((v): v is string => typeof v === 'string')
		: []
}

import {
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
} from 'vscode-languageclient/node'
import { matchIndent, signatureIndent } from './indent'

let client: LanguageClient | undefined
let output: OutputChannel | undefined
let storage: string | undefined

const EXE = process.platform === 'win32' ? '.exe' : ''

/**
 * Directories that tool installers use. VS Code started from a desktop
 * launcher does not read the shell profile, so PATH alone misses them.
 */
function toolDirs(): string[] {
	const home = homedir()
	return [
		'.alloy',
		'.ember',
		'.rokit',
		'.aftman',
		'.foreman',
		'.cargo',
		'.local',
	]
		.map((dir) => join(home, dir, 'bin'))
		.filter((dir) => existsSync(dir))
}

/** The environment of the server: the tool directories in front of PATH. */
function serverEnv(): NodeJS.ProcessEnv {
	const current = process.env.PATH ?? ''
	return { ...process.env, PATH: [...toolDirs(), current].join(delimiter) }
}

/** Where `alloy self install` puts the server. */
function installedServer(): string | undefined {
	const candidate = join(homedir(), '.alloy', 'bin', `alloy-lsp${EXE}`)
	return existsSync(candidate) ? candidate : undefined
}

/**
 * The luau-lsp binary that the luau-lsp extension ships. The API answers
 * for an enabled extension; the folder scan also finds one that is
 * installed and off, or installed in another VS Code build.
 */
function bundledLuauLsp(): string | undefined {
	const server = `server${EXE}`
	const ext = extensions.getExtension('JohnnyMorganz.luau-lsp')
	if (ext !== undefined) {
		const candidate = join(ext.extensionPath, 'bin', server)
		if (existsSync(candidate)) {
			return candidate
		}
	}
	const home = homedir()
	for (const root of ['.vscode', '.vscode-insiders', '.vscode-oss']) {
		const dir = join(home, root, 'extensions')
		let entries: string[]
		try {
			entries = readdirSync(dir)
		} catch {
			continue
		}
		const found = entries
			.filter((name) =>
				name.toLowerCase().startsWith('johnnymorganz.luau-lsp-'),
			)
			.sort()
			.reverse()
			.map((name) => join(dir, name, 'bin', server))
			.find((path) => existsSync(path))
		if (found !== undefined) {
			return found
		}
	}
	return undefined
}

const TYPES_URL = 'https://luau-lsp.pages.dev/type-definitions'
const DOCS_URL = 'https://luau-lsp.pages.dev/api-docs/en-us.json'

/**
 * The Roblox globals and their docs, the way the luau-lsp extension gets
 * them. Its own downloads sit next door in global storage and are used
 * first; else this extension downloads a copy into its storage once.
 * `luau-lsp.platform.type` set to `standard` turns them off.
 */
async function robloxDefinitions(): Promise<{
	definitions: string[]
	docs?: string
}> {
	const luauLsp = workspace.getConfiguration('luau-lsp')
	if (luauLsp.get<string>('platform.type', 'roblox') !== 'roblox') {
		return { definitions: [] }
	}
	const level = luauLsp.get<string>(
		'types.roblox.securityLevel',
		'PluginSecurity',
	)
	const types = `globalTypes.${level}.d.luau`
	const docs = 'api-docs.json'
	const dirs: string[] = []
	if (storage !== undefined) {
		dirs.push(join(dirname(storage), 'johnnymorganz.luau-lsp'), storage)
	}
	for (const dir of dirs) {
		if (existsSync(join(dir, types))) {
			const docsPath = join(dir, docs)
			return {
				definitions: [join(dir, types)],
				docs: existsSync(docsPath) ? docsPath : undefined,
			}
		}
	}
	if (storage === undefined) {
		return { definitions: [] }
	}
	try {
		await mkdir(storage, { recursive: true })
		output?.appendLine(`downloading ${types} and ${docs} into ${storage}`)
		const [typesText, docsText] = await Promise.all([
			fetchText(`${TYPES_URL}/${types}`),
			fetchText(DOCS_URL),
		])
		await writeFile(join(storage, types), typesText)
		await writeFile(join(storage, docs), docsText)
		return { definitions: [join(storage, types)], docs: join(storage, docs) }
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		output?.appendLine(`cannot download the Roblox types: ${detail}`)
		window.showWarningMessage(
			`Alloy: cannot download the Roblox types, so the globals are unknown: ${detail}`,
		)
		return { definitions: [] }
	}
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`${url}: ${response.status} ${response.statusText}`)
	}
	return response.text()
}

/** The luau-lsp binary the server drives: the configured path, else
 *  the bundled one. */
function luauLspPath(): string | undefined {
	const config = workspace.getConfiguration('alloy-luau')
	return config.get<string>('server.luauLspPath', '').trim() || bundledLuauLsp()
}

async function serverCommand(): Promise<{ command: string; args: string[] }> {
	const config = workspace.getConfiguration('alloy-luau')
	const configured = config.get<string>('server.path', '').trim()
	const luauLsp = luauLspPath()
	const roblox = await robloxDefinitions()
	const definitions = [
		...roblox.definitions,
		...list(workspace.getConfiguration('luau-lsp'), 'types.definitionFiles'),
		...list(config, 'types.definitionFiles'),
	]
	const args: string[] = []
	if (luauLsp !== undefined && luauLsp.length > 0) {
		args.push('--luau-lsp', luauLsp)
	}
	for (const file of definitions) {
		args.push('--definitions', file)
	}
	if (roblox.docs !== undefined) {
		args.push('--docs', roblox.docs)
	}
	args.push('--log-level', config.get<string>('server.logLevel', 'warn'))
	args.push(...list(config, 'server.args'))
	const command =
		configured.length > 0 ? configured : (installedServer() ?? 'alloy-lsp')
	return { command, args }
}

const FFLAGS_URL =
	'https://clientsettingscdn.roblox.com/v1/settings/application?applicationName=PCStudioApp'
const FFLAG_KINDS = ['FFlag', 'FInt', 'DFFlag', 'DFInt']

/**
 * The Luau flags the server passes to luau-lsp, the way the luau-lsp
 * extension builds them: every boolean flag on unless `enableByDefault`
 * is off, the flags Roblox publishes for Studio when `sync` is on, and
 * `override` last. The new solver stays on unless `enableNewSolver` is
 * off; Alloy's emit needs it.
 */
/** The flags the luau-lsp binary knows, from `--show-flags`. Roblox
 *  publishes flags for a newer Luau than the binary carries, and each
 *  one the binary does not know prints "Unknown FFlag" on every start;
 *  a flag not in this set is left out. An empty set means the binary
 *  could not be asked, and nothing is filtered. */
function knownFlags(luauLsp: string | undefined): Promise<Set<string>> {
	return new Promise((resolve) => {
		if (luauLsp === undefined || luauLsp.length === 0) {
			resolve(new Set())
			return
		}
		exec(`"${luauLsp}" --show-flags`, { timeout: 5000 }, (error, stdout) => {
			if (error) {
				resolve(new Set())
				return
			}
			const names = new Set<string>()
			for (const line of stdout.split('\n')) {
				const name = line.trim().split('=')[0]
				if (name.length > 0) {
					names.add(name)
				}
			}
			resolve(names)
		})
	})
}

async function fflagsSection(
	luauLsp: string | undefined,
): Promise<Record<string, unknown>> {
	const config = workspace.getConfiguration('alloy-luau.fflags')
	const override: Record<string, string> = {}
	const known = await knownFlags(luauLsp)
	if (config.get<boolean>('sync', true)) {
		try {
			const text = await fetchText(FFLAGS_URL)
			const published = JSON.parse(text) as {
				applicationSettings?: Record<string, string>
			}
			for (const [name, value] of Object.entries(
				published.applicationSettings ?? {},
			)) {
				for (const kind of FFLAG_KINDS) {
					if (name.startsWith(`${kind}Luau`)) {
						const flag = name.slice(kind.length)
						if (known.size === 0 || known.has(flag)) {
							override[flag] = String(value)
						}
					}
				}
			}
		} catch (error) {
			output?.appendLine(`fflags: cannot sync with Roblox: ${String(error)}`)
		}
	}
	for (const [name, value] of Object.entries(
		config.get<Record<string, unknown>>('override', {}),
	)) {
		override[name] = String(value)
	}
	return {
		enableByDefault: config.get<boolean>('enableByDefault', true),
		enableNewSolver: config.get<boolean>('enableNewSolver', true),
		override,
	}
}

/**
 * What the server needs from the editor's settings: the whole `luau-lsp`
 * section, if the user has one, and the Alloy inlay hint choices on top.
 * The server answers the child's configuration requests from this.
 */
async function serverSettings(): Promise<Record<string, unknown>> {
	const luauLsp = workspace.getConfiguration('luau-lsp')
	const hints = workspace.getConfiguration('alloy-luau.inlayHints')
	const plugin = workspace.getConfiguration('alloy-luau.studioPlugin')
	const sourcemap = workspace.getConfiguration('alloy-luau.sourcemap')
	const alloy = workspace.getConfiguration('alloy-luau')
	// Only a rig the user set travels: unset, `[roblox] rig` in
	// alloy.toml decides.
	const rig = alloy.inspect<string>('rig')
	return {
		luauLsp: JSON.parse(JSON.stringify(luauLsp)),
		fflags: await fflagsSection(luauLspPath()),
		rig: rig?.workspaceFolderValue ?? rig?.workspaceValue ?? rig?.globalValue,
		autoCloseTags: alloy.get<boolean>('autoCloseTags', true),
		autoEnd: alloy.get<boolean>('autoEnd', true),
		hideRobloxDeprecated: alloy.get<boolean>('hideRobloxDeprecated', false),
		hideAllDeprecated: alloy.get<boolean>('hideAllDeprecated', false),
		arrowReturnHints: alloy.get<boolean>('arrowReturnHints', false),
		inlayHints: {
			variableTypes: hints.get<boolean>('variableTypes', true),
			parameterTypes: hints.get<boolean>('parameterTypes', true),
			functionReturnTypes: hints.get<boolean>('functionReturnTypes', true),
			parameterNames: hints.get<string>('parameterNames', 'literals'),
			makeInsertable: hints.get<boolean>('makeInsertable', true),
		},
		studioPlugin: {
			enabled: plugin.get<boolean>('enabled', false),
			port: plugin.get<number>('port', 3668),
		},
		sourcemap: {
			file: sourcemap.get<string>('file', 'sourcemap.json'),
		},
	}
}

/** The language of a `.alx` file, the only one that holds markup. */
const ALX = 'alloy-luau-jsx'

/** Every language that holds Alloy code. */
const ALLOY = ['alloy-luau', 'alloy-luau-config', 'alloy-luau-declaration', ALX]

/** The word a line of a `match` opens with, alone on its line. */
const ARM = /^[ \t]*(?:case|default|end)$/

/**
 * Enter below a body-less signature in a trait, an interface, or a
 * `declare` block keeps the signature's column. The indentation rules
 * read one line, so they open a body that the block never has.
 */
async function signatureEnter(event: TextDocumentChangeEvent): Promise<void> {
	const document = event.document
	const change = event.contentChanges[0]

	if (
		!ALLOY.includes(document.languageId) ||
		event.reason !== undefined ||
		event.contentChanges.length !== 1 ||
		!change.text.startsWith('\n') ||
		change.text.trim() !== ''
	) {
		return
	}

	const editor = window.activeTextEditor

	if (editor === undefined || editor.document !== document) {
		return
	}

	const at = document.positionAt(change.rangeOffset + change.text.length)
	const line = document.lineAt(at.line)
	const written = signatureIndent(document.getText().split('\n'), at.line)
	const start = line.firstNonWhitespaceCharacterIndex

	if (
		written === undefined ||
		written === line.text.slice(0, start) ||
		line.text.trim() !== ''
	) {
		return
	}

	await editor.edit(
		(builder) =>
			builder.replace(
				new Range(at.line, 0, at.line, line.text.length),
				written,
			),
		{ undoStopBefore: false, undoStopAfter: false },
	)
}

/**
 * Writes the column of `case`, `default`, and the `end` that closes a
 * `match`, as the reader finishes the word.
 *
 * The editor's indentation rules cannot reach that column. A pattern
 * writes the reference line's own column, or one level out from it
 * when that line opens no block, so it never writes one level in,
 * which is where an arm of a `match` belongs. `src/indent.ts` holds
 * the rule and `scripts/indent.mjs` checks it.
 */
async function matchArmIndent(event: TextDocumentChangeEvent): Promise<void> {
	const document = event.document
	const change = event.contentChanges[0]

	if (
		!ALLOY.includes(document.languageId) ||
		event.reason !== undefined ||
		event.contentChanges.length !== 1 ||
		change.text.length !== 1
	) {
		return
	}

	const editor = window.activeTextEditor

	if (editor === undefined || editor.document !== document) {
		return
	}

	const at = document.positionAt(change.rangeOffset + change.text.length)
	const line = document.lineAt(at.line)

	if (!ARM.test(line.text.slice(0, at.character))) {
		return
	}

	const size = editor.options.tabSize
	const unit =
		editor.options.insertSpaces === true
			? ' '.repeat(typeof size === 'number' ? size : 4)
			: '\t'
	const written = matchIndent(document.getText().split('\n'), at.line, unit)
	const start = line.firstNonWhitespaceCharacterIndex

	if (written === undefined || written === line.text.slice(0, start)) {
		return
	}

	await editor.edit(
		(builder) =>
			builder.replace(new Range(at.line, 0, at.line, start), written),
		{ undoStopBefore: false, undoStopAfter: false },
	)
}

/**
 * Writes the closing tag after the `>` that ends an opening tag. The
 * server names the element; the client inserts, because a snippet's
 * `$0` puts the caret between the two tags and a text edit carries no
 * caret.
 */
async function closeTag(event: TextDocumentChangeEvent): Promise<void> {
	const document = event.document
	const change = event.contentChanges[0]
	if (
		client === undefined ||
		document.languageId !== ALX ||
		event.reason !== undefined ||
		event.contentChanges.length !== 1 ||
		change.text !== '>' ||
		!workspace
			.getConfiguration('alloy-luau')
			.get<boolean>('autoCloseTags', true)
	) {
		return
	}
	const editor = window.activeTextEditor
	if (editor === undefined || editor.document !== document) {
		return
	}
	const at = document.positionAt(change.rangeOffset + change.text.length)
	const version = document.version
	let name: string | undefined
	try {
		const answer = await client.sendRequest<{ name?: string } | null>(
			'alloy/closeTag',
			{
				uri: document.uri.toString(),
				position: { line: at.line, character: at.character },
			},
		)
		name = answer?.name
	} catch (error) {
		output?.appendLine(`closeTag: ${String(error)}`)
		return
	}
	// The reader types on while the server answers. An edit then lands
	// on text the answer never saw, so it is dropped.
	if (
		name === undefined ||
		document.version !== version ||
		!editor.selection.isEmpty ||
		!editor.selection.active.isEqual(at)
	) {
		return
	}
	await editor.insertSnippet(new SnippetString(`$0</${name}>`), at)
}

/**
 * Enter between an opening and a closing tag puts each tag on its own
 * line, with the caret on an indented line between them. VS Code owns
 * the rule, so the server never sees the keystroke.
 */
function markupEnterRule(): Disposable {
	return languages.setLanguageConfiguration(ALX, {
		onEnterRules: [
			{
				beforeText: /<[A-Za-z_][\w.]*(?:\s[^<>]*)?>$/,
				afterText: /^<\/[A-Za-z_][\w.]*>/,
				action: { indentAction: IndentAction.IndentOutdent },
			},
		],
	})
}

let generating = false
let generateAgain = false

/**
 * Runs the sourcemap generator in the project root. A save during a run
 * queues one more run, so the file always reflects the last save.
 */
async function generateSourcemap(): Promise<void> {
	const root = workspace.workspaceFolders?.[0]?.uri.fsPath
	if (root === undefined) {
		return
	}
	if (generating) {
		generateAgain = true
		return
	}
	generating = true
	const config = workspace.getConfiguration('alloy-luau.sourcemap')
	const file = config.get<string>('file', 'sourcemap.json')
	// `alloy build` writes the sourcemap of a project with mounts; the
	// server reads it, so the generator has nothing to do.
	if (
		existsSync(join(root, '.alloy', 'sourcemap.json')) &&
		!existsSync(join(root, file))
	) {
		output ??= window.createOutputChannel('Alloy')
		output.appendLine('sourcemap: using .alloy/sourcemap.json from alloy build')
		generating = false
		return
	}
	const command = config
		.get<string>('generatorCommand', 'rojo sourcemap --output ${sourcemapFile}')
		.replace('${sourcemapFile}', file)
	output ??= window.createOutputChannel('Alloy')
	const log = output
	await new Promise<void>((resolve) => {
		exec(command, { cwd: root, env: serverEnv() }, (error, stdout, stderr) => {
			if (error !== null) {
				log.appendLine(
					`sourcemap: ${command} failed: ${stderr.trim() || error.message}`,
				)
			} else if (stdout.trim().length > 0) {
				log.appendLine(`sourcemap: ${stdout.trim()}`)
			}
			resolve()
		})
	})
	generating = false
	if (generateAgain) {
		generateAgain = false
		await generateSourcemap()
	}
}

async function startClient(): Promise<void> {
	output ??= window.createOutputChannel('Alloy')
	const { command, args } = await serverCommand()
	output.appendLine(`starting: ${command} ${args.join(' ')}`)
	const options = { env: serverEnv() }
	const serverOptions: ServerOptions = {
		run: { command, args, options },
		debug: { command, args, options },
	}
	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: 'file', language: 'alloy-luau' },
			{ scheme: 'file', language: 'alloy-luau-config' },
			{ scheme: 'file', language: 'alloy-luau-declaration' },
			{ scheme: 'file', language: 'alloy-luau-jsx' },
		],
		initializationOptions: await serverSettings(),
		outputChannel: output,
		synchronize: {
			fileEvents: [
				workspace.createFileSystemWatcher('**/*.{aly,alx,luau,lua,json,toml}'),
				workspace.createFileSystemWatcher('**/.luaurc'),
			],
		},
	}
	client = new LanguageClient(
		'alloy-luau',
		'Alloy',
		serverOptions,
		clientOptions,
	)
	try {
		await client.start()
	} catch (error) {
		client = undefined
		const detail = error instanceof Error ? error.message : String(error)
		output.appendLine(`cannot start ${command}: ${detail}`)
		window.showErrorMessage(`Alloy: cannot start ${command}: ${detail}`)
	}
}

/** One restart per burst of saves. */
const CONFIG_RESTART_DELAY = 500

/** The files a project reads its configuration from. */
const CONFIG_FILES = ['alloy.toml', '.config.aly']

let configRestart: NodeJS.Timeout | undefined

/**
 * Restarts the server after a save of `alloy.toml` or `.config.aly`. The child luau-lsp
 * takes the mount aliases, the solver flag, and the definitions as
 * command line arguments, so only a new process reads the new file.
 * The restart stays quiet: one line in the output channel, no popup.
 */
function restartForConfig(): void {
	if (configRestart !== undefined) {
		clearTimeout(configRestart)
	}
	configRestart = setTimeout(() => {
		configRestart = undefined
		const running = client
		if (running === undefined) {
			return
		}
		output?.appendLine('the configuration changed: restarting the server')
		running.restart().catch((error: unknown) => {
			const detail = error instanceof Error ? error.message : String(error)
			output?.appendLine(`cannot restart the server: ${detail}`)
		})
	}, CONFIG_RESTART_DELAY)
}

async function stopClient(): Promise<void> {
	if (configRestart !== undefined) {
		clearTimeout(configRestart)
		configRestart = undefined
	}
	if (client === undefined) {
		return
	}
	const running = client
	client = undefined
	await running.stop()
}

export async function activate(context: ExtensionContext): Promise<void> {
	storage = context.globalStorageUri.fsPath
	context.subscriptions.push(
		commands.registerCommand('alloy-luau.restartServer', async () => {
			await stopClient()
			await startClient()
		}),
		commands.registerCommand('alloy-luau.generateSourcemap', generateSourcemap),
		markupEnterRule(),
		workspace.onDidChangeTextDocument(closeTag),
		workspace.onDidChangeTextDocument(matchArmIndent),
		workspace.onDidChangeTextDocument(signatureEnter),
		workspace.onDidSaveTextDocument(async (document) => {
			if (
				CONFIG_FILES.includes(basename(document.uri.fsPath)) &&
				workspace.getWorkspaceFolder(document.uri) !== undefined
			) {
				restartForConfig()
			}
			const config = workspace.getConfiguration('alloy-luau.sourcemap')
			const scripts = [
				'alloy-luau',
				'alloy-luau-jsx',
				'alloy-luau-declaration',
				'luau',
				'lua',
			]
			if (
				config.get<boolean>('autogenerate', false) &&
				scripts.includes(document.languageId)
			) {
				await generateSourcemap()
			}
		}),
		workspace.onDidChangeConfiguration(async (event) => {
			if (
				event.affectsConfiguration('alloy-luau.server') ||
				event.affectsConfiguration('alloy-luau.fflags') ||
				event.affectsConfiguration('alloy-luau.types') ||
				event.affectsConfiguration('luau-lsp.types') ||
				event.affectsConfiguration('luau-lsp.platform')
			) {
				await stopClient()
				await startClient()
				return
			}
			if (
				client !== undefined &&
				(event.affectsConfiguration('alloy-luau.inlayHints') ||
					event.affectsConfiguration('alloy-luau.studioPlugin') ||
					event.affectsConfiguration('alloy-luau.sourcemap.file') ||
					event.affectsConfiguration('alloy-luau.autoCloseTags') ||
					event.affectsConfiguration('alloy-luau.autoEnd') ||
					event.affectsConfiguration('alloy-luau.hideRobloxDeprecated') ||
					event.affectsConfiguration('alloy-luau.hideAllDeprecated') ||
					event.affectsConfiguration('alloy-luau.arrowReturnHints') ||
					event.affectsConfiguration('luau-lsp'))
			) {
				await client.sendNotification('workspace/didChangeConfiguration', {
					settings: await serverSettings(),
				})
			}
		}),
	)
	await startClient()
}

export function deactivate(): Promise<void> {
	return stopClient()
}
