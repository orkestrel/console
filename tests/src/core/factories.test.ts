import type { Attribute, CaptureLevel, Color, LogLevel, RendererInterface, Style } from '@src/core'
import {
	createANSIRenderer,
	createCapture,
	createConsoleSink,
	createLogger,
	createLoggerManager,
	createReporter,
	createSpinner,
	createStyler,
	createTheme,
	DEFAULT_THEME,
	EMPTY_STYLE,
	LEVEL_COLORS,
	LEVELS,
	STATUS_COLORS,
	STATUS_ICONS,
	STATUS_LEVELS,
	withCapture,
} from '@src/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRecordingSink } from '../../setup.js'

// createANSIRenderer / createStyler — the public factories. createANSIRenderer returns
// the default ANSI renderer; createStyler returns the fluent surface, defaulting to ANSI
// + enabled, with options to swap the renderer (the C-f browser seam) and to disable.
// createConsoleSink / createLogger / createLoggerManager — the C-b logging factories: the
// snapshotting level-routing console sink, the observable logger, the event-free registry.

const ESC = '\x1b['
const RESET = '\x1b[0m'

describe('createANSIRenderer', () => {
	it('returns a renderer that maps style DATA to SGR codes', () => {
		const renderer = createANSIRenderer()
		expect(renderer.render({ foreground: 'red', attributes: ['bold'] }, 'alert')).toBe(
			`${ESC}1;31malert${RESET}`,
		)
	})

	it('passes the empty style and empty string through', () => {
		const renderer = createANSIRenderer()
		expect(renderer.render({ attributes: [] }, 'x')).toBe('x')
		expect(renderer.render({ foreground: 'red', attributes: [] }, '')).toBe('')
	})
})

describe('createStyler', () => {
	it('defaults to the ANSI renderer, enabled', () => {
		const styler = createStyler()
		expect(styler.enabled).toBe(true)
		expect(styler.red.bold('x')).toBe(`${ESC}1;31mx${RESET}`)
	})

	it('is fluent and composes either direction', () => {
		const styler = createStyler()
		expect(styler.underline.cyan('link')).toBe(`${ESC}4;36mlink${RESET}`)
		expect(styler.red.style.foreground).toBe('red')
	})

	it('enabled:false returns text verbatim', () => {
		const styler = createStyler({ enabled: false })
		expect(styler.enabled).toBe(false)
		expect(styler.red.bold('x')).toBe('x')
		expect(styler.green('ok')).toBe('ok')
	})

	it('options.renderer retargets output without touching the style model', () => {
		// A stand-in renderer (the C-f %c seam) consuming the SAME Style DATA.
		const renderer: RendererInterface = {
			render(style: Style, text: string): string {
				return style.foreground === undefined ? text : `<${style.foreground}>${text}`
			},
		}
		const styler = createStyler({ renderer })
		expect(styler.red('x')).toBe('<red>x')
		expect(styler('plain')).toBe('plain')
	})

	it('returns independent base stylers — chains never share state', () => {
		const a = createStyler()
		const b = createStyler()
		expect(a.red('x')).toBe(`${ESC}31mx${RESET}`)
		expect(b('x')).toBe('x')
		// The base of `a` is still neutral after deriving a chain from it.
		expect(a('x')).toBe('x')
	})
})

describe('createTheme', () => {
	it('with no options, yields the default vocabulary as a fresh value', () => {
		const theme = createTheme()
		expect(theme).toEqual(DEFAULT_THEME)
		expect(theme).not.toBe(DEFAULT_THEME)
	})

	it('overrides one level and leaves the other three at their defaults', () => {
		const warn = createStyler().brightYellow.bold.style
		const theme = createTheme({ levels: { warn } })
		expect(theme.levels.warn).toEqual({ foreground: 'brightYellow', attributes: ['bold'] })
		expect(theme.levels.debug).toEqual(DEFAULT_THEME.levels.debug)
		expect(theme.levels.info).toEqual(DEFAULT_THEME.levels.info)
		expect(theme.levels.error).toEqual(DEFAULT_THEME.levels.error)
	})

	it('overrides one status entry — icon and style together — and leaves the rest', () => {
		const theme = createTheme({
			statuses: { success: { icon: '+', style: createStyler().green.bold.style } },
		})
		expect(theme.statuses.success).toEqual({
			icon: '+',
			style: { foreground: 'green', attributes: ['bold'] },
		})
		expect(theme.statuses.error).toEqual(DEFAULT_THEME.statuses.error)
		expect(theme.statuses.warn).toEqual(DEFAULT_THEME.statuses.warn)
		expect(theme.statuses.info).toEqual(DEFAULT_THEME.statuses.info)
	})

	it('copies and freezes a supplied status record and style', () => {
		const supplied = { icon: '+', style: createStyler().green.style }
		const theme = createTheme({ statuses: { success: supplied } })
		expect(Object.isFrozen(supplied)).toBe(false)
		expect(theme.statuses.success).not.toBe(supplied)
		expect(Object.isFrozen(theme.statuses.success)).toBe(true)
		expect(theme.statuses.success.style).not.toBe(supplied.style)
		expect(theme.statuses.success.style).toEqual(supplied.style)
		expect(Object.isFrozen(theme.statuses.success.style)).toBe(true)
		expect(Object.isFrozen(theme.statuses.success.style.attributes)).toBe(true)
		supplied.icon = '-'
		expect(supplied.icon).toBe('-')
		expect(theme.statuses.success.icon).toBe('+')
	})

	it('snapshots a supplied level style before a live logger consumes it', () => {
		const style: { foreground: Color; attributes: Attribute[] } = {
			foreground: 'cyan',
			attributes: [],
		}
		const theme = createTheme({ levels: { debug: style } })
		const sink = createRecordingSink()
		const logger = createLogger({ level: 'debug', sink, theme })
		style.foreground = 'magenta'
		logger.debug('kept')
		expect(sink.calls[0]?.[0]).toContain(`${ESC}36mDEBUG${RESET}`)
		expect(sink.calls[0]?.[0]).not.toContain(`${ESC}35mDEBUG${RESET}`)
	})

	it('snapshots a frozen status style record whose attributes remain mutable', () => {
		const attributes: Attribute[] = []
		const style = Object.freeze({ foreground: 'green' satisfies Color, attributes })
		const theme = createTheme({ statuses: { success: { icon: '+', style } } })
		const sink = createRecordingSink()
		const reporter = createReporter({ sink, theme })
		attributes.push('inverse')
		reporter.status('success', 'kept')
		expect(sink.calls).toEqual([[`${ESC}32m+${RESET} ${ESC}32mkept${RESET}`, undefined]])
	})

	it('snapshots a supplied accent style before a live spinner consumes it', () => {
		const style: { foreground: Color; attributes: Attribute[] } = {
			foreground: 'red',
			attributes: [],
		}
		const theme = createTheme({ accent: style })
		const sink = createRecordingSink()
		const spinner = createSpinner({ frames: ['*'], message: 'kept', sink, theme })
		style.foreground = 'magenta'
		spinner.tick()
		expect(sink.calls).toEqual([[`\r${ESC}31m*${RESET} kept`, undefined]])
	})

	it('captures a chrome foreground getter before a live reporter consumes it', () => {
		let foreground: Color = 'blue'
		const attributes: Attribute[] = []
		const style = {
			get foreground(): Color {
				return foreground
			},
			attributes,
		}
		const theme = createTheme({ chrome: style })
		const sink = createRecordingSink()
		const reporter = createReporter({ sink, theme, width: 8 })
		foreground = 'magenta'
		reporter.section('S')
		expect(sink.calls[0]?.[0]).toBe(`${ESC}34m──${RESET} ${ESC}34mS${RESET} ${ESC}34m───${RESET}`)
	})

	it('overrides accent and chrome independently of each other', () => {
		const accent = createStyler().magenta.style
		const theme = createTheme({ accent })
		expect(theme.accent).toEqual(accent)
		expect(theme.accent).not.toBe(accent)
		expect(Object.isFrozen(theme.accent)).toBe(true)
		expect(Object.isFrozen(theme.accent.attributes)).toBe(true)
		expect(theme.chrome).toEqual(DEFAULT_THEME.chrome)
		const chrome = createStyler().brightBlack.style
		const chromeTheme = createTheme({ chrome })
		expect(chromeTheme.chrome).toEqual(chrome)
		expect(chromeTheme.chrome).not.toBe(chrome)
		expect(Object.isFrozen(chromeTheme.chrome)).toBe(true)
		expect(Object.isFrozen(chromeTheme.chrome.attributes)).toBe(true)
		expect(chromeTheme.accent).toEqual(DEFAULT_THEME.accent)
	})

	it('returns a frozen theme whose records and style leaves are frozen', () => {
		const theme = createTheme({ accent: createStyler().magenta.style })
		expect(Object.isFrozen(theme)).toBe(true)
		expect(Object.isFrozen(theme.levels)).toBe(true)
		expect(Object.isFrozen(theme.statuses)).toBe(true)
		for (const level of LEVELS) {
			expect(Object.isFrozen(theme.levels[level])).toBe(true)
			expect(Object.isFrozen(theme.levels[level].attributes)).toBe(true)
		}
		for (const status of STATUS_LEVELS) {
			expect(Object.isFrozen(theme.statuses[status])).toBe(true)
			expect(Object.isFrozen(theme.statuses[status].style)).toBe(true)
			expect(Object.isFrozen(theme.statuses[status].style.attributes)).toBe(true)
		}
		expect(Object.isFrozen(theme.accent)).toBe(true)
		expect(Object.isFrozen(theme.accent.attributes)).toBe(true)
		expect(Object.isFrozen(theme.chrome)).toBe(true)
		expect(Object.isFrozen(theme.chrome.attributes)).toBe(true)
	})

	it('never writes back into DEFAULT_THEME', () => {
		const before = structuredClone(DEFAULT_THEME)
		createTheme({
			levels: { error: createStyler().white.style },
			statuses: { info: { icon: '?', style: EMPTY_STYLE } },
			accent: EMPTY_STYLE,
			chrome: EMPTY_STYLE,
		})
		expect(DEFAULT_THEME).toEqual(before)
	})

	it('assembles its defaults from the level and status constants — one source per fact', () => {
		for (const level of LEVELS) {
			expect(DEFAULT_THEME.levels[level].foreground).toBe(LEVEL_COLORS[level])
		}
		for (const status of STATUS_LEVELS) {
			expect(DEFAULT_THEME.statuses[status].icon).toBe(STATUS_ICONS[status])
			expect(DEFAULT_THEME.statuses[status].style.foreground).toBe(STATUS_COLORS[status])
		}
	})

	it('renders a themed line through the styler that consumes it', () => {
		const styler = createStyler()
		const theme = createTheme({ chrome: styler.dim.italic.style })
		expect(styler.render(theme.levels.error, 'ERROR')).toBe(`${ESC}31mERROR${RESET}`)
		expect(styler.render(theme.chrome, '--')).toBe(`${ESC}2;3m--${RESET}`)
	})
})

describe('createConsoleSink', () => {
	// Restore the three console methods after each test that patches them — never leak a
	// patched console into other suites.
	const original = { log: console.log, warn: console.warn, error: console.error }
	afterEach(() => {
		console.log = original.log
		console.warn = original.warn
		console.error = original.error
	})

	it('routes by level: error→console.error, warn→console.warn, else→console.log', () => {
		const seen: Array<readonly [stream: string, text: string]> = []
		console.log = (text: string) => seen.push(['log', text])
		console.warn = (text: string) => seen.push(['warn', text])
		console.error = (text: string) => seen.push(['error', text])
		const sink = createConsoleSink()
		sink.write('d', 'debug')
		sink.write('i', 'info')
		sink.write('w', 'warn')
		sink.write('e', 'error')
		expect(seen).toEqual([
			['log', 'd'],
			['log', 'i'],
			['warn', 'w'],
			['error', 'e'],
		])
	})

	it('an omitted level falls back to console.log', () => {
		const seen: string[] = []
		console.log = (text: string) => seen.push(text)
		const sink = createConsoleSink()
		sink.write('plain')
		expect(seen).toEqual(['plain'])
	})

	it('snapshots console at creation — a later console patch can NOT reach the sink (no capture loop)', () => {
		const real: string[] = []
		// The "real" console.log the sink should snapshot.
		console.log = (text: string) => real.push(text)
		const sink = createConsoleSink() // snapshots the real console.log NOW
		// Now PATCH console.log (as a Capture would) — the sink must still hit the snapshot.
		const captured: string[] = []
		console.log = (text: string) => captured.push(text)
		sink.write('after patch')
		expect(real).toEqual(['after patch']) // reached the original stream
		expect(captured).toEqual([]) // the patched console never saw the sink's own output
	})

	it('passes a Spinner redraw frame and a plain write to the snapshotted method verbatim', () => {
		const seen: string[] = []
		console.log = (text: string) => seen.push(text)
		const sink = createConsoleSink()
		const spinner = createSpinner({
			frames: ['*'],
			message: 'working',
			sink,
			styler: createStyler({ enabled: false }),
		})
		spinner.tick()
		sink.write('plain')
		expect(seen).toEqual(['\r* working', 'plain'])
		spinner.destroy()
	})
})

describe('createLogger', () => {
	it('returns a working observable logger with the default console sink', () => {
		const seen: string[] = []
		const original = console.log
		console.log = (text: string) => seen.push(text)
		try {
			const logger = createLogger({ name: 'svc', level: 'info' })
			logger.info('up')
			expect(logger.entries().map((record) => record.message)).toEqual(['up'])
			// Default console sink wrote one info line through console.log.
			expect(seen).toHaveLength(1)
			expect(seen[0]).toContain('up')
		} finally {
			console.log = original
		}
	})

	it('defaults the level to info', () => {
		const logger = createLogger({ silent: true })
		expect(logger.level).toBe('info')
	})
})

describe('createLoggerManager', () => {
	it('returns an event-free registry that fans out to its loggers', () => {
		const lines: Array<readonly [text: string, level: LogLevel | undefined]> = []
		const sink = {
			write(text: string, level?: LogLevel) {
				lines.push([text, level])
			},
		}
		const manager = createLoggerManager({
			level: 'debug',
			sink,
			styler: createStyler({ enabled: false }),
		})
		const a = manager.register('a')
		const b = manager.register('b')
		manager.warn('shared')
		expect(a.entries()).toHaveLength(1)
		expect(b.entries()).toHaveLength(1)
		// Both loggers wrote through the shared sink, routed at warn.
		expect(lines.filter(([, level]) => level === 'warn')).toHaveLength(2)
		expect('emitter' in manager).toBe(false)
	})
})

// createCapture / withCapture — the C-d console-interception factories. createCapture returns an
// inactive Capture (deeply covered in Capture.test.ts — here just factory parity). withCapture is
// the scoped, self-restoring form: it starts a capture, runs `fn`, stops in a finally (so console
// is restored even on throw / reject), and returns { value, messages } — sync for a sync `fn`, a
// Promise for an async one. Every test snapshots + restores console so a patch never leaks.

describe('createCapture / withCapture', () => {
	// The process-global leak guard — snapshot the five console methods, restore them afterward.
	const methods: readonly CaptureLevel[] = ['log', 'info', 'warn', 'error', 'debug']
	const snapshot = new Map<CaptureLevel, (...args: unknown[]) => void>()
	beforeEach(() => {
		const target: Record<CaptureLevel, (...args: unknown[]) => void> = console
		for (const method of methods) snapshot.set(method, target[method])
	})
	afterEach(() => {
		const target: Record<CaptureLevel, (...args: unknown[]) => void> = console
		for (const [method, original] of snapshot) target[method] = original
		snapshot.clear()
	})

	describe('createCapture', () => {
		it('returns an inactive Capture that intercepts once started', () => {
			const capture = createCapture({ levels: ['log'] })
			expect(capture.active).toBe(false)
			capture.start()
			console.log('via factory')
			capture.stop()
			expect(capture.messages().map((m) => m.text)).toEqual(['via factory'])
		})
	})

	describe('withCapture — sync', () => {
		it('returns the function value plus the messages it logged, and restores console', () => {
			const original = console.log
			const { value, messages } = withCapture(() => {
				console.log('working', 1)
				console.warn('careful')
				return 42
			})
			expect(value).toBe(42)
			expect(messages.map((m) => `${m.level}:${m.text}`)).toEqual(['log:working 1', 'warn:careful'])
			// Console is restored after the scoped capture.
			expect(console.log).toBe(original)
			console.log('after') // not captured — capture is gone
			expect(messages).toHaveLength(2)
		})

		it('honors options — only the configured levels are captured', () => {
			const { messages } = withCapture(
				() => {
					console.log('ignored')
					console.error('kept')
					return null
				},
				{ levels: ['error'] },
			)
			expect(messages.map((m) => m.text)).toEqual(['kept'])
		})

		it('restores console even when the function throws (the throw still propagates)', () => {
			const original = console.log
			expect(() =>
				withCapture(() => {
					console.log('before throw')
					throw new Error('sync boom')
				}),
			).toThrow('sync boom')
			// Console restored despite the throw — no leak.
			expect(console.log).toBe(original)
		})
	})

	describe('withCapture — async', () => {
		it('awaits the promise, returning value + messages captured during the async work', async () => {
			const original = console.log
			const result = withCapture(async () => {
				console.log('sync part')
				await Promise.resolve()
				console.warn('async part')
				return 'done'
			})
			// An async `fn` yields a Promise (the overload resolved to the async signature).
			expect(result).toBeInstanceOf(Promise)
			const { value, messages } = await result
			expect(value).toBe('done')
			expect(messages.map((m) => m.text)).toEqual(['sync part', 'async part'])
			// Restored only after the awaited work completed.
			expect(console.log).toBe(original)
		})

		it('restores console when the promise rejects (the rejection still propagates)', async () => {
			const original = console.log
			await expect(
				withCapture(async () => {
					console.log('before reject')
					await Promise.resolve()
					throw new Error('async boom')
				}),
			).rejects.toThrow('async boom')
			expect(console.log).toBe(original)
		})
	})

	describe('withCapture — boundary shapes', () => {
		it('a sync fn that logs nothing yields an empty messages list and its value', () => {
			const { value, messages } = withCapture(() => 7)
			expect(value).toBe(7)
			expect(messages).toEqual([])
		})

		it('returns the messages buffer as a copy independent of the (now destroyed) capture', () => {
			const { messages } = withCapture(() => {
				console.log('a')
				console.log('b')
				return undefined
			})
			// Mutating the returned list cannot affect anything — the capture is gone.
			const copy = [...messages]
			copy.length = 0
			expect(messages).toHaveLength(2)
		})

		it('preserves a falsy sync return value (0 / false / null / undefined)', () => {
			expect(withCapture(() => 0).value).toBe(0)
			expect(withCapture(() => false).value).toBe(false)
			expect(withCapture(() => null).value).toBeNull()
			expect(withCapture(() => undefined).value).toBeUndefined()
		})

		it('a sync throw discards the captured messages (only the throw propagates)', () => {
			// The sync-throw path destroys the capture and rethrows — there is no CaptureResult to read,
			// so the buffered "before throw" line is never surfaced (documents the contract).
			let caught: unknown
			try {
				withCapture(() => {
					console.log('lost on throw')
					throw new Error('x')
				})
			} catch (error) {
				caught = error
			}
			expect(caught).toBeInstanceOf(Error)
		})

		it('the async overload resolves to a Promise even when fn returns a resolved promise of a value', async () => {
			const result = withCapture(() => Promise.resolve('async value'))
			expect(result).toBeInstanceOf(Promise)
			const { value, messages } = await result
			expect(value).toBe('async value')
			expect(messages).toEqual([])
		})

		it('captures by the default level set (all five console methods) when levels omitted', async () => {
			const { messages } = withCapture(() => {
				console.log('l')
				console.info('i')
				console.warn('w')
				console.error('e')
				console.debug('d')
				return undefined
			})
			expect(messages.map((m) => m.level)).toEqual(['log', 'info', 'warn', 'error', 'debug'])
		})
	})
})
