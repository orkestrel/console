// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest — one row (Console) spanning the
// core/browser/server faces as a multi-dir `GuideModule` — one guide per package. The
// constants that follow are this package's own, and are the only part a sibling package
// changes.

import { describe, expect, it } from 'vitest'
import {
	computeSymbolKey,
	createGuide,
	createSource,
	createSourceManager,
	extractFenceImports,
	findMissing,
	findMissingSymbols,
	findUnexampled,
	findUnlisted,
	isExternalLink,
	parseManifest,
	resolveLink,
} from '@orkestrel/guide'
import { readFileSync } from 'node:fs'
import { requireValue } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'
import {
	ANSIRenderer,
	Capture,
	cellAt,
	createStyler,
	createTheme,
	formatDuration,
	formatTime,
	Logger,
	LoggerManager,
	Progress,
	Reporter,
	Retention,
	Spinner,
	width,
} from '@src/core'
import {
	createServerSink,
	DEFAULT_COLUMNS,
	inferColumns,
	isBufferEncoding,
	isStreamTarget,
	ProcessCapture,
} from '@src/server'
import { createRecordingSink, normalizeVisible } from './setup.js'
import { createStreamTarget, createWriteProbe } from './setupServer.js'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/**
 * Each import specifier this package's own guides may resolve against. The fences import
 * each face through its published specifier — the core barrel, the `/browser` subpath, and
 * the `/server` subpath — so the fence-import check resolves each specifier to ITS OWN
 * face's exports.
 */
const MODULES = Object.freeze({
	'@orkestrel/console': 'src/core',
	'@orkestrel/console/browser': 'src/browser',
	'@orkestrel/console/server': 'src/server',
})
/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its single consumer cannot become a
 * local, so it stays exported without being public. Naming it here is what makes that
 * intentional rather than forgotten — and the second assertion below fails when a name
 * here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze(['class Styler'])

/** Root-level files this package's guides link to. `readInventory` walks directories only. */
const ROOT_FILES = Object.freeze(['AGENTS.md'])

/** This package's own guide — the file the flagship-fence transcriptions are copied from. */
const CONSOLE_GUIDE = 'guides/console.md'

const root = new URL('../', import.meta.url)
const files: Record<string, string> = {
	...readInventory(root, ['src', 'guides', 'tests'], { extensions: ['.ts', '.md'] }),
}
for (const name of ROOT_FILES) files[name] = readFileSync(new URL(name, root), 'utf8')
const manifest = parseManifest(
	requireValue(files['guides/README.md'], 'Missing file: guides/README.md'),
	'guides',
)
const sources = createSourceManager({ files, modules: MODULES })

it('manifest lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
})

for (const entry of manifest) {
	const guide = createGuide(requireValue(files[entry.spec], `Missing file: ${entry.spec}`))
	const source = createSource({ files, module: entry.source })

	describe(`${entry.concept}`, () => {
		it('uses only listed fence languages', () => {
			expect(findUnlisted(guide.fences(), FENCE_LANGUAGES)).toEqual([])
		})

		it('extracts a non-empty documented surface', () => {
			expect(guide.surface().length).toBeGreaterThan(0)
		})
		it('re-exports every direct declaration that is not named internal', () => {
			const stranded = findMissingSymbols(source.exports(), source.surface())
			expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
		})
		it('names no symbol internal that the barrel already exports', () => {
			const stranded = findMissingSymbols(source.exports(), source.surface())
			expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
		})
		it('re-exports only direct declarations', () => {
			expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
		})
		it('documents every barrel export', () => {
			expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
		})
		it('documents only barrel exports', () => {
			expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
		})

		it('exposes no hidden module-scope declarations', () => {
			expect(source.hidden().map(computeSymbolKey)).toEqual([])
		})

		for (const group of guide.methods()) {
			const members = source.methods(group.interface)
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface}`, () => {
				it('documents at least one method', () => {
					expect(group.methods.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, group.methods)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(group.methods, members)).toEqual([])
				})
				it(`${entity} exposes no undocumented method`, () => {
					const extra =
						entity === group.interface ? [] : findMissing(source.methods(entity), group.methods)
					expect(extra).toEqual([])
				})
			})
		}

		it('documents an example for every Surface function', () => {
			const fences = guide
				.fences()
				.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
				.map((fence) => fence.code)
			const names = guide
				.surface()
				.filter((symbol) => symbol.kind === 'function')
				.map((symbol) => symbol.name)
			expect(findUnexampled(names, fences, source.examples())).toEqual([])
		})

		for (const group of guide.methods()) {
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface} examples`, () => {
				it('documents an example for every method', () => {
					const fences = guide
						.fences()
						.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
						.map((fence) => fence.code)
					const examples =
						entity === group.interface
							? source.examples(group.interface)
							: source.examples(group.interface).concat(source.examples(entity))
					expect(findUnexampled(group.methods, fences, examples)).toEqual([])
				})
			})
		}

		it('imports only real exports in every ```ts fence', () => {
			const fences = guide.fences().filter((fence) => fence.language === EXAMPLE_LANGUAGE)
			for (const fence of fences) {
				for (const { specifier, names } of extractFenceImports(fence.code)) {
					const imported = sources.source(specifier)
					if (imported === undefined) continue
					const surface = imported.surface().map((symbol) => symbol.name)
					expect(findMissing(names, surface)).toEqual([])
				}
			}
		})

		it('resolves every relative link', () => {
			const broken = guide
				.links()
				.filter((href) => !isExternalLink(href))
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(broken).toEqual([])
		})
		it('links only to test files that exist', () => {
			const missing = guide
				.tests()
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(missing).toEqual([])
		})
	})
}

// The EXECUTED half. Every preceding check reads a NAME — from the guide text or from a
// prototype — and a name that resolves proves nothing about the sentence beside it, so a fence
// whose comment claims a value the code contradicts passes all of them. The cases here run the
// flagship fences of `guides/console.md` and assert the values their comments claim. Every entity
// is driven through a recording sink instead of the real console, so the suite stays output-clean
// and the assertion reads the exact bytes the fence would print. Change a fence, change the
// transcription beside it.
describe('flagship fences', () => {
	const guideText = requireValue(files[CONSOLE_GUIDE], `Missing file: ${CONSOLE_GUIDE}`)

	it('prints what the opening surface fence says it prints', () => {
		const archived: string[] = []
		const logs = createRecordingSink()
		const reports = createRecordingSink()
		const spins = createRecordingSink()

		const logger = new Logger({ name: 'http', level: 'info', sink: logs })
		logger.info('request', { method: 'GET', path: '/' })
		logger.emitter.on('entry', (record) => archived.push(record.message))

		const reporter = new Reporter({ sink: reports })
		reporter.section('Build')
		reporter.step('bundling', { index: 2, total: 5 })
		reporter.status('success', 'built in 1.2s')

		const spinner = new Spinner({ message: 'deploying', sink: spins })
		spinner.start()
		spinner.succeed('deployed')

		expect(normalizeVisible(logs.calls[0]?.[0] ?? '')).toMatch(
			/ INFO \[http\] request \{"method":"GET","path":"\/"\}$/,
		)
		expect(normalizeVisible(reports.calls[1]?.[0] ?? '')).toBe('[2/5] bundling')
		expect(normalizeVisible(reports.calls[2]?.[0] ?? '')).toBe('✔ built in 1.2s')
		expect(normalizeVisible(spins.calls.at(-1)?.[0] ?? '')).toBe('✔ deployed')
		// The fence subscribes AFTER the one record it logs, and the seam pushes each record once as
		// it is written — so nothing reaches this listener, and a replayed record would fail here.
		expect(archived).toEqual([])
	})

	it('carries the surface fence lines the transcription copies', () => {
		expect(guideText).toContain(
			"reporter.step('bundling', { index: 2, total: 5 }) // [2/5] bundling",
		)
		expect(guideText).toContain("reporter.status('success', 'built in 1.2s') // ✔ built in 1.2s")
		expect(guideText).toContain(
			"spinner.succeed('deployed') // ✔ deployed — the timer cleared, the line committed",
		)
	})

	it('narrates a deploy the way the reporter fence says it does', () => {
		const sink = createRecordingSink()
		const reporter = new Reporter({ sink })
		reporter.section('Deploy')
		reporter.step('uploading', { index: 1, total: 3 })
		reporter.timing('upload', 1234)
		reporter.tree({ root: { label: 'root', children: [{ label: 'a' }, { label: 'b' }] } })
		reporter.tree({
			root: { label: 'root', children: [{ label: 'a' }, { label: 'b' }] },
			border: 'double',
		})
		reporter.box({ content: 'hello', title: 'Note' })
		reporter.line('raw text')
		reporter.blank()
		reporter.status('success', 'all green')

		const lines = sink.calls.map(([text]) => normalizeVisible(text))
		expect(width(lines[0] ?? '')).toBe(80)
		expect(lines[0]).toContain('── Deploy ──')
		expect(lines[1]).toBe('[1/3] uploading')
		expect(lines[2]).toBe('upload … 1.23s')
		expect(lines[3]).toBe('root\n├─ a\n└─ b')
		expect(lines[4]).toBe('root\n╠═ a\n╚═ b')
		expect(lines[5]?.split('\n')[0]).toContain('Note')
		expect(lines[6]).toBe('raw text')
		expect(lines[7]).toBe('')
		expect(lines[8]).toBe('✔ all green')
	})

	it('carries the reporter fence lines the transcription copies', () => {
		expect(guideText).toContain(
			"reporter.step('uploading', { index: 1, total: 3 }) // [1/3] uploading",
		)
		expect(guideText).toContain("reporter.timing('upload', 1234) // upload … 1.23s")
		expect(guideText).toContain('}) // root / ├─ a / └─ b')
		expect(guideText).toContain('}) // the same tree, root / ╠═ a / ╚═ b')
		expect(guideText).toContain("reporter.line('raw text') // one raw line, no prefix, no icon")
		expect(guideText).toContain("reporter.status('success', 'all green') // ✔ all green")
	})

	it('speaks one theme across the logger, the reporter, the spinner, and the bar', () => {
		const theme = createTheme({
			statuses: { success: { icon: '+', style: createStyler().brightMagenta.style } },
			accent: createStyler().magenta.style,
		})
		const logs = createRecordingSink()
		const reports = createRecordingSink()
		const spins = createRecordingSink()
		const bars = createRecordingSink()
		const custom = createRecordingSink()

		new Logger({ name: 'http', theme, sink: logs }).warn('slow')
		new Reporter({ theme, sink: reports }).status('success', 'all green')
		new Spinner({ message: 'deploying', theme, sink: spins }).tick()
		new Spinner({ message: 'deploying', frames: ['-', '\\', '|', '/'], sink: custom }).tick()
		new Progress({ total: 10, width: 10, fill: '=', empty: '.', sink: bars }).update(4)

		expect(normalizeVisible(logs.calls[0]?.[0] ?? '')).toMatch(/ WARN \[http\] slow$/)
		expect(normalizeVisible(reports.calls[0]?.[0] ?? '')).toBe('+ all green')
		expect(normalizeVisible(spins.calls[0]?.[0] ?? '')).toBe('⠋ deploying')
		expect(normalizeVisible(custom.calls[0]?.[0] ?? '')).toBe('- deploying')
		expect(normalizeVisible(bars.calls[0]?.[0] ?? '')).toBe('====...... 40% (4/10)')
	})

	it('carries the theme fence lines the transcription copies', () => {
		expect(guideText).toContain(
			"new Reporter({ theme }).status('success', 'all green') // + all green — glyph and line both bright magenta",
		)
		expect(guideText).toContain(
			"new Spinner({ message: 'deploying', theme }).tick() // ⠋ deploying — the glyph in the accent",
		)
		expect(guideText).toContain(
			"new Spinner({ message: 'deploying', frames: ['-', '\\\\', '|', '/'] }).tick() // - deploying",
		)
		expect(guideText).toContain(
			"new Progress({ total: 10, width: 10, fill: '=', empty: '.' }).update(4) // ====...... 40% (4/10)",
		)
	})

	it('caps the retention engine on both axes the way its fence says', () => {
		const retention = new Retention<{ level: 'warn' | 'error'; text: string }>(['warn'], 2)
		retention.add({ level: 'warn', text: 'first' })
		retention.add({ level: 'error', text: 'second' })

		expect(retention.records().length).toBe(2)
		expect(retention.records('warn')).toEqual([{ level: 'warn', text: 'first' }])
		retention.add({ level: 'warn', text: 'third' })
		expect(retention.records().length).toBe(2)
		retention.add({ level: 'warn', text: 'fourth' })
		expect(retention.records('warn').length).toBe(2)
		retention.clear()
		expect(retention.records()).toEqual([])
	})

	it('carries the retention fence lines the transcription copies', () => {
		expect(guideText).toContain('retention.records().length // 2 — the whole buffer, oldest first')
		expect(guideText).toContain(
			"retention.records('warn') // [{ level: 'warn', text: 'first' }] — only that bucket",
		)
		expect(guideText).toContain(
			"retention.records().length // 2 — 'first' was evicted; the whole buffer is capped at 2",
		)
		expect(guideText).toContain('retention.records() // []')
	})

	it('commits the animation outcome lines the spinner and bar fence claims', () => {
		const spins = createRecordingSink()
		const failing = createRecordingSink()
		const bars = createRecordingSink()

		const spinner = new Spinner({ message: 'connecting', sink: spins })
		spinner.update('handshaking')
		spinner.succeed('connected')
		new Spinner({ message: 'connecting', sink: failing }).fail('unreachable')

		const progress = new Progress({ total: 100, message: 'downloading', sink: bars })
		progress.update(40)
		progress.succeed('done')

		expect(normalizeVisible(spins.calls.at(-1)?.[0] ?? '')).toBe('✔ connected')
		expect(failing.calls.at(-1)?.[1]).toBe('error')
		expect(normalizeVisible(failing.calls.at(-1)?.[0] ?? '')).toBe('✖ unreachable')
		expect(normalizeVisible(bars.calls[0]?.[0] ?? '')).toBe(
			'████████████░░░░░░░░░░░░░░░░░░ 40% (40/100) downloading',
		)
		expect(bars.calls.at(-1)?.[0].endsWith('\n')).toBe(true)
		expect(normalizeVisible(bars.calls.at(-1)?.[0] ?? '')).toBe(
			'██████████████████████████████ 100% (100/100) done',
		)
	})

	it('carries the animation fence lines the transcription copies', () => {
		expect(guideText).toContain(
			"spinner.succeed('connected') // ✔ connected — timer cleared, line committed",
		)
		expect(guideText).toContain(
			"failing.fail('unreachable') // ✖ unreachable — timer cleared, error stream",
		)
		expect(guideText).toContain(
			'progress.update(40) // ████████████░░░░░░░░░░░░░░░░░░ 40% (40/100) downloading',
		)
		expect(guideText).toContain("progress.succeed('done') // a full bar, committed with a newline")
	})

	it('returns what the pure-helper fence says each helper returns', () => {
		const renderer = new ANSIRenderer()

		expect(renderer.render({ foreground: 'red', attributes: [] }, 'hi')).toBe('\x1b[31mhi\x1b[0m')
		expect(cellAt(['a', 'b'], 5)).toBe('')
		expect(formatTime(0)).toBe('1970-01-01T00:00:00.000Z')
		expect(formatDuration(1230)).toBe('1.23s')
	})

	it('carries the pure-helper fence lines the transcription copies', () => {
		expect(guideText).toContain(
			"renderer.render({ foreground: 'red', attributes: [] }, 'hi') // wraps 'hi' in the red SGR codes",
		)
		expect(guideText).toContain(
			"cellAt(['a', 'b'], 5) // '' — past the end, so a short row pads instead of throwing",
		)
		expect(guideText).toContain("formatTime(0) // '1970-01-01T00:00:00.000Z'")
		expect(guideText).toContain("formatDuration(1230) // '1.23s'")
	})

	it('forces styling and owns the stderr stream the way the server fence claims', () => {
		const forced = createServerSink({ styled: true })
		expect(forced.styled).toBe(true)

		// A mirroring capture replays through the write reference it snapshots at `start`, so a
		// recording probe installed first keeps the mirrored diagnostic out of the runner's own
		// stderr while the real interception, buffering, and restore still run. The stream is
		// restored before the assertions, so a failing one can never leak the patch.
		const pristine = process.stderr.write
		const probe = createWriteProbe()
		process.stderr.write = probe.write
		const capture = new ProcessCapture({ levels: ['stderr'], mirror: true })
		capture.start()
		process.stderr.write('a library diagnostic\n')
		const captured = capture.messages('stderr').map((chunk) => ({
			level: chunk.level,
			text: chunk.text,
		}))
		capture.clear()
		const cleared = capture.messages('stderr')
		capture.stop()
		capture.destroy()
		process.stderr.write = pristine

		expect(captured).toEqual([{ level: 'stderr', text: 'a library diagnostic\n' }])
		expect(probe.texts).toEqual(['a library diagnostic\n'])
		expect(cleared).toEqual([])
	})

	it('carries the server fence lines the transcription copies', () => {
		expect(guideText).toContain(
			'forced.styled // true, whatever the environment and the streams say',
		)
		expect(guideText).toContain(
			"process.stderr.write('a library diagnostic\\n') // captured AND still shown (mirror: true)",
		)
		expect(guideText).toContain(
			"capture.messages('stderr') // [{ level: 'stderr', text: 'a library diagnostic\\n', time: … }]",
		)
		expect(guideText).toContain(
			'capture.clear() // drop buffered chunks; interception is unaffected',
		)
	})

	it('sizes a terminal the way the server-helper fence says', () => {
		// Each branch the fence names, driven through a stream target whose facts this test fixes: a
		// TTY reports its live width, a stream without one takes the DEFAULT_COLUMNS fallback. The
		// fence's own call reads whichever of the two the runner's stdout is.
		expect(inferColumns(createStreamTarget({ isTTY: true, columns: 100 }).target)).toBe(100)
		expect(inferColumns(createStreamTarget().target)).toBe(DEFAULT_COLUMNS)
		expect(inferColumns(process.stdout)).toBeGreaterThan(0)
	})

	it('carries the server-helper fence line the transcription copies', () => {
		expect(guideText).toContain(
			'inferColumns(process.stdout) // the live TTY width, or the DEFAULT_COLUMNS fallback off a TTY',
		)
	})

	it('answers the server boundary guards the way their fence says', () => {
		expect(isStreamTarget(process.stdout)).toBe(true)
		expect(isStreamTarget({})).toBe(false)
		expect(isBufferEncoding('utf8')).toBe(true)
		expect(isBufferEncoding('nope')).toBe(false)
	})

	it('carries the server-guard fence lines the transcription copies', () => {
		expect(guideText).toContain(
			'isStreamTarget(process.stdout) // true — a record with a callable `write`',
		)
		expect(guideText).toContain('isStreamTarget({}) // false — no `write`')
		expect(guideText).toContain(
			"isBufferEncoding('utf8') // true — a value accepted by Buffer#toString",
		)
		expect(guideText).toContain("isBufferEncoding('nope') // false")
	})

	it('gates, retains, and formats the way the logging fences claim', () => {
		const gated = createRecordingSink()
		const logger = new Logger({ name: 'http', level: 'info', sink: gated })
		logger.debug('verbose')
		logger.info('request', { method: 'GET', path: '/' })
		logger.warn('slow', { ms: 900 })
		expect(logger.entries().map((record) => record.message)).toEqual(['request', 'slow'])

		const formatted = createRecordingSink()
		new Logger({ sink: formatted, format: (record) => `${record.level}: ${record.message}` }).info(
			'ready',
		)
		expect(formatted.calls.map(([text]) => text)).toEqual(['info: ready'])

		const silent = createRecordingSink()
		const archived: string[] = []
		const quiet = new Logger({ sink: silent, silent: true, format: () => 'never built' })
		quiet.emitter.on('entry', (record) => archived.push(record.message))
		quiet.info('archived')
		expect(silent.calls).toEqual([])
		expect(archived).toEqual(['archived'])
	})

	it('carries the logging fence lines the transcription copies', () => {
		expect(guideText).toContain("logger.debug('verbose') // dropped — below the `info` threshold")
		expect(guideText).toContain(
			'logger.entries() // the bounded tail — [the info record, the warn record]',
		)
		expect(guideText).toContain("logger.info('ready') // info: ready")
		expect(guideText).toContain("quiet.info('archived') // nothing written, no formatter call")
	})

	it('registers and removes the way the registry fence claims', () => {
		const sink = createRecordingSink()
		const manager = new LoggerManager({ level: 'info', sink })
		const http = manager.register('http')
		manager.info('booted')
		expect(http.entries().map((record) => record.message)).toEqual(['booted'])
		expect(manager.remove('http')).toBe(true)
		expect(manager.count).toBe(0)
		manager.register('a')
		manager.remove()
		expect(manager.count).toBe(0)
	})

	it('intercepts and restores the way the capture-lifecycle fence claims', () => {
		const capture = new Capture()
		capture.start()
		console.log('hello')
		const captured = capture.messages()
		expect(captured.map((message) => ({ level: message.level, text: message.text }))).toEqual([
			{ level: 'log', text: 'hello' },
		])
		capture.clear()
		expect(capture.messages()).toEqual([])
		capture.stop()
		expect(capture.active).toBe(false)
		capture.destroy()
	})

	it('carries the capture fence lines the transcription copies', () => {
		expect(guideText).toContain(
			"capture.messages() // the whole buffer — [{ level: 'log', text: 'hello', time: … }]",
		)
		expect(guideText).toContain(
			'capture.clear() // drop every buffered message; does NOT stop interception',
		)
	})
})
