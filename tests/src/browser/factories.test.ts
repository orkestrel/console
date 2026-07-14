import type { ConsoleCaptureInterface } from '../../setupBrowser.js'
import { COLOR_HEX, createBrowserSink } from '@src/browser'
import { createCapture, createLogger, createStyler } from '@src/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRecorder } from '../../setup.js'
import { captureConsole } from '../../setupBrowser.js'

// The browser `%c` console sink (`src/browser/console/factories.ts`), exercised against the REAL
// headless-Chromium console. `captureConsole()` (setupBrowser, §16.1) swaps `console.log` / `warn`
// / `error` for recorders (a real call-recording callback, not a framework mock) and restores them,
// so no spy leaks. We assert: ANSI runs become a `console[method](format, ...styles)` call with the
// right CSS; the level routes to the matching console method; a leading `\r` (animation redraw)
// degrades to a non-overwriting line; the sink snapshots `console` at creation (no capture loop);
// and a real `createLogger({ sink })` writes one styled line end to end.

let consoleSwap: ConsoleCaptureInterface
let log: ConsoleCaptureInterface['log']
let warn: ConsoleCaptureInterface['warn']
let error: ConsoleCaptureInterface['error']

beforeEach(() => {
	consoleSwap = captureConsole()
	;({ log, warn, error } = consoleSwap)
})

afterEach(() => {
	consoleSwap.restore()
})

describe('createBrowserSink', () => {
	it('returns a SinkInterface (a write method)', () => {
		const sink = createBrowserSink()
		expect(typeof sink.write).toBe('function')
	})

	it('translates an ANSI run into a console.log(%c, css) call', () => {
		const sink = createBrowserSink()
		const styler = createStyler()
		sink.write(styler.red('alert'))
		expect(log.calls).toEqual([['%calert', `color:${COLOR_HEX.red}`]])
	})

	it('writes a plain string with no %c and no extra args', () => {
		const sink = createBrowserSink()
		sink.write('plain line')
		expect(log.calls).toEqual([['plain line']])
	})

	it('%-escapes literal text so the console never misreads a directive', () => {
		const sink = createBrowserSink()
		sink.write('done 50%')
		expect(log.calls).toEqual([['done 50%%']])
	})

	it('routes error → console.error', () => {
		const sink = createBrowserSink()
		sink.write('boom', 'error')
		expect(error.calls).toEqual([['boom']])
		expect(log.count).toBe(0)
		expect(warn.count).toBe(0)
	})

	it('routes warn → console.warn', () => {
		const sink = createBrowserSink()
		sink.write('careful', 'warn')
		expect(warn.calls).toEqual([['careful']])
		expect(log.count).toBe(0)
		expect(error.count).toBe(0)
	})

	it('routes debug / info / an omitted level → console.log', () => {
		const sink = createBrowserSink()
		sink.write('d', 'debug')
		sink.write('i', 'info')
		sink.write('none')
		expect(log.calls).toEqual([['d'], ['i'], ['none']])
		expect(warn.count).toBe(0)
		expect(error.count).toBe(0)
	})

	it('passes the error-level styling args through to console.error', () => {
		const sink = createBrowserSink()
		const styler = createStyler()
		sink.write(styler.red('fail'), 'error')
		expect(error.calls).toEqual([['%cfail', `color:${COLOR_HEX.red}`]])
	})

	it('degrades a leading \\r (animation redraw) to a non-overwriting line', () => {
		const sink = createBrowserSink()
		sink.write('\rframe one')
		// The \r is stripped — the console receives a fresh line, never a carriage return.
		expect(log.calls).toEqual([['frame one']])
	})

	it('degrades a styled \\r animation frame, keeping the CSS', () => {
		const sink = createBrowserSink()
		const styler = createStyler()
		sink.write('\r' + styler.green('working'))
		expect(log.calls).toEqual([['%cworking', `color:${COLOR_HEX.green}`]])
	})

	it('strips only a LEADING \\r, leaving an interior one to the console', () => {
		const sink = createBrowserSink()
		sink.write('a\rb')
		expect(log.calls).toEqual([['a\rb']])
	})

	it('snapshots console at creation — a later patch never feeds the sink (no capture loop)', () => {
		// Create the sink against the CURRENT console.log recorder…
		const sink = createBrowserSink()
		const replaced = createRecorder<readonly [string, ...string[]]>()
		// …then PATCH console.log (as a Capture would).
		console.log = replaced.handler
		sink.write('snapshotted')
		// The sink still hit the recorder captured at creation, not the replacement.
		expect(log.calls).toEqual([['snapshotted']])
		expect(replaced.count).toBe(0)
	})

	it('drives a real createLogger end to end — one styled info line via console.log', () => {
		const logger = createLogger({ name: 'app', sink: createBrowserSink() })
		logger.info('ready')
		expect(log.count).toBe(1)
		const [format, ...styles] = log.calls[0] ?? ['']
		// The formatted log line is styled (level label + dim timestamp), so it carries %c + CSS.
		expect(format).toContain('%c')
		expect(format).toContain('ready')
		expect(styles.length).toBeGreaterThan(0)
		// The blue info label's color is present among the run styles (LEVEL_COLORS.info = blue).
		expect(styles.some((css) => css.includes(COLOR_HEX.blue))).toBe(true)
		logger.destroy()
	})

	it('routes a logger error line to console.error end to end', () => {
		const logger = createLogger({ name: 'app', sink: createBrowserSink() })
		logger.error('exploded')
		expect(error.count).toBe(1)
		expect(log.count).toBe(0)
		const [format] = error.calls[0] ?? ['']
		expect(format).toContain('exploded')
		logger.destroy()
	})

	it('keeps a styled WARN line’s CSS when routing to console.warn', () => {
		const sink = createBrowserSink()
		const styler = createStyler()
		sink.write(styler.yellow('careful'), 'warn')
		expect(warn.calls).toEqual([['%ccareful', `color:${COLOR_HEX.yellow}`]])
		expect(log.count).toBe(0)
		expect(error.count).toBe(0)
	})

	it('snapshots ALL THREE console methods at creation — a later patch of each never feeds the sink', () => {
		// Create the sink against the CURRENT recorders, then replace every console method.
		const sink = createBrowserSink()
		const replacedLog = createRecorder<readonly [string, ...string[]]>()
		const replacedWarn = createRecorder<readonly [string, ...string[]]>()
		const replacedError = createRecorder<readonly [string, ...string[]]>()
		console.log = replacedLog.handler
		console.warn = replacedWarn.handler
		console.error = replacedError.handler
		sink.write('l')
		sink.write('w', 'warn')
		sink.write('e', 'error')
		// Each call reached the recorder snapshotted at creation, not the replacement.
		expect(log.calls).toEqual([['l']])
		expect(warn.calls).toEqual([['w']])
		expect(error.calls).toEqual([['e']])
		expect(replacedLog.count).toBe(0)
		expect(replacedWarn.count).toBe(0)
		expect(replacedError.count).toBe(0)
	})

	it('survives a REAL createCapture patching console.* — no capture loop, the program log still mirrors', () => {
		// The production threat the snapshot defends against: a Capture (C-d) patches the global
		// console AFTER the sink exists. The sink must still hit the snapshot-original recorders, and
		// the capture must NOT see the sink's own writes — only a genuine third-party console call.
		const sink = createBrowserSink()
		const capture = createCapture({ mirror: true })
		capture.start()
		// The sink writes — these must NOT be captured (they go through the pre-patch snapshot).
		sink.write('sink line one')
		sink.write('sink error', 'error')
		// A genuine third-party console call DOES get captured (and, with mirror, reaches our recorder).
		console.log('third party')
		capture.stop()
		// The sink's two writes landed on the snapshot recorders, never re-entering the capture.
		expect(log.calls).toContainEqual(['sink line one'])
		expect(error.calls).toContainEqual(['sink error'])
		// The capture buffered ONLY the third-party call, not the sink's two writes.
		const captured = capture.messages().map((message) => message.text)
		expect(captured).toEqual(['third party'])
		capture.destroy()
	})

	it('degrades only a LEADING \\r — an interior \\r in the same line is preserved', () => {
		const sink = createBrowserSink()
		sink.write('\rstart\rmiddle')
		// Leading \r stripped; the interior one survives untouched.
		expect(log.calls).toEqual([['start\rmiddle']])
	})

	it('%-escapes a plain line through the sink so the console never misreads a directive', () => {
		const sink = createBrowserSink()
		sink.write('progress: 50% (%s)')
		expect(log.calls).toEqual([['progress: 50%% (%%s)']])
	})

	it('passes unicode (emoji / CJK) through the sink verbatim', () => {
		const sink = createBrowserSink()
		const styler = createStyler()
		sink.write(styler.green('done ✅ 日本語'))
		expect(log.calls).toEqual([['%cdone ✅ 日本語', `color:${COLOR_HEX.green}`]])
	})

	it('a leading \\r on an empty payload writes a bare empty line (no throw)', () => {
		const sink = createBrowserSink()
		sink.write('\r')
		expect(log.calls).toEqual([['']])
	})

	it('each write is independent — sequential writes do not bleed accumulated style', () => {
		const sink = createBrowserSink()
		const styler = createStyler()
		sink.write(styler.red('a'))
		sink.write('b')
		// The second (plain) write carries NO leftover red — a fresh translation per write.
		expect(log.calls).toEqual([['%ca', `color:${COLOR_HEX.red}`], ['b']])
	})
})
