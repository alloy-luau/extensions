import { exec } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import {
	commands,
	type Disposable,
	type ExtensionContext,
	extensions,
	IndentAction,
	languages,
	type OutputChannel,
	SnippetString,
	type TextDocumentChangeEvent,
	window,
	workspace,
} from 'vscode'
import {
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
} from 'vscode-languageclient/node'

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

async function serverCommand(): Promise<{ command: string; args: string[] }> {
	const config = workspace.getConfiguration('alloy-luau')
	const configured = config.get<string>('server.path', '').trim()
	const luauLsp =
		config.get<string>('server.luauLspPath', '').trim() || bundledLuauLsp()
	const roblox = await robloxDefinitions()
	const definitions = [
		...roblox.definitions,
		...workspace
			.getConfiguration('luau-lsp')
			.get<string[]>('types.definitionFiles', []),
		...config.get<string[]>('types.definitionFiles', []),
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
	args.push(...config.get<string[]>('server.args', []))
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
async function fflagsSection(): Promise<Record<string, unknown>> {
	const config = workspace.getConfiguration('alloy-luau.fflags')
	const override: Record<string, string> = {}
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
						override[name.slice(kind.length)] = String(value)
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
	return {
		luauLsp: JSON.parse(JSON.stringify(luauLsp)),
		fflags: await fflagsSection(),
		autoCloseTags: alloy.get<boolean>('autoCloseTags', true),
		autoEnd: alloy.get<boolean>('autoEnd', true),
		hideRobloxDeprecated: alloy.get<boolean>('hideRobloxDeprecated', false),
		hideAllDeprecated: alloy.get<boolean>('hideAllDeprecated', false),
		inlayHints: {
			variableTypes: hints.get<boolean>('variableTypes', true),
			parameterTypes: hints.get<boolean>('parameterTypes', true),
			functionReturnTypes: hints.get<boolean>('functionReturnTypes', true),
			parameterNames: hints.get<string>('parameterNames', 'literals'),
			makeInsertable: hints.get<boolean>('makeInsertable', true),
		},
		studioPlugin: {
			enabled: plugin.get<boolean>('enabled', false),
			port: plugin.get<number>('port', 3667),
		},
		sourcemap: {
			file: sourcemap.get<string>('file', 'sourcemap.json'),
		},
	}
}

/** The language of a `.alx` file, the only one that holds markup. */
const ALX = 'alloy-luau-jsx'

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

async function stopClient(): Promise<void> {
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
		workspace.onDidSaveTextDocument(async (document) => {
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
