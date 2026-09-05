import { exec } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import {
	commands,
	type ExtensionContext,
	extensions,
	type OutputChannel,
	type TextDocumentChangeEvent,
	window,
	workspace,
} from 'vscode'
import {
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
} from 'vscode-languageclient/node'
import * as alloyToml from './alloyToml'

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

/**
 * What the server needs from the editor's settings: the whole `luau-lsp`
 * section, if the user has one, and the Alloy inlay hint choices on top.
 * The server answers the child's configuration requests from this.
 */
function serverSettings(): Record<string, unknown> {
	const luauLsp = workspace.getConfiguration('luau-lsp')
	const hints = workspace.getConfiguration('alloy-luau.inlayHints')
	const plugin = workspace.getConfiguration('alloy-luau.studioPlugin')
	const sourcemap = workspace.getConfiguration('alloy-luau.sourcemap')
	return {
		luauLsp: JSON.parse(JSON.stringify(luauLsp)),
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
		initializationOptions: serverSettings(),
		outputChannel: output,
		synchronize: {
			fileEvents: [
				workspace.createFileSystemWatcher('**/*.{aly,alx,luau,lua,json}'),
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

const ALLOY_LANGUAGES = new Set([
	'alloy-luau',
	'alloy-luau-jsx',
	'alloy-luau-declaration',
])

/**
 * After Enter on a line that opens a block, the server says whether the
 * block still lacks its `end`, and the `end` lands a line below the
 * cursor with the opener's indentation. The inserted text starts with a
 * newline too, so an edit that ends in `end` is skipped.
 */
async function maybeInsertEnd(event: TextDocumentChangeEvent): Promise<void> {
	if (client === undefined || !ALLOY_LANGUAGES.has(event.document.languageId)) {
		return
	}
	const on = workspace
		.getConfiguration('alloy-luau.completion')
		.get<boolean>('autocompleteEnd', true)
	if (!on || event.contentChanges.length !== 1) {
		return
	}
	const change = event.contentChanges[0]
	if (
		!change.text.startsWith('\n') ||
		change.text.trimEnd().endsWith('end') ||
		change.rangeLength !== 0
	) {
		return
	}
	const line = change.range.start.line
	const answer = await client.sendRequest<{ indent: string } | null>(
		'alloy/blockEnd',
		{ textDocument: { uri: event.document.uri.toString() }, line },
	)
	if (answer === null || answer === undefined) {
		return
	}
	const editor = window.activeTextEditor
	if (editor === undefined || editor.document !== event.document) {
		return
	}
	const newLine = line + 1
	if (newLine >= editor.document.lineCount) {
		return
	}
	const at = editor.document.lineAt(newLine).range.end
	await editor.edit((builder) => builder.insert(at, `\n${answer.indent}end`), {
		undoStopBefore: false,
		undoStopAfter: true,
	})
}

export async function activate(context: ExtensionContext): Promise<void> {
	storage = context.globalStorageUri.fsPath
	context.subscriptions.push(
		workspace.onDidChangeTextDocument((event) => {
			void maybeInsertEnd(event)
		}),
		commands.registerCommand('alloy-luau.restartServer', async () => {
			await stopClient()
			await startClient()
		}),
		commands.registerCommand('alloy-luau.generateSourcemap', generateSourcemap),
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
					event.affectsConfiguration('luau-lsp'))
			) {
				await client.sendNotification('workspace/didChangeConfiguration', {
					settings: serverSettings(),
				})
			}
		}),
	)
	alloyToml.register(context, serverEnv())
	await startClient()
}

export function deactivate(): Promise<void> {
	return stopClient()
}
