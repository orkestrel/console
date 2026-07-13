import type { CaptureLevel, CapturedMessage } from '@src/core'
import { Capture, createCapture, createLogger, createStyler } from '@src/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createErrorRecorder, createRecordingSink, recordEmitterEvents } from '../../../setup.js'

// Capture — the observable console interceptor. While active it snapshots the configured
// console.* methods, replaces them with wrappers that buffer each call (total + by level,
// bounded), emit `capture`, and — per options — mirror to the snapshot-original console and/or
// forward to a sink. It is PROCESS-GLOBAL: every test snapshots the five console methods in
// `beforeEach` and restores them in `afterEach`, so a patched console NEVER leaks into the vitest
// reporter (or a sibling test), regardless of whether the test itself calls stop().

const CONSOLE_METHODS: readonly CaptureLevel[] = ['log', 'info', 'warn', 'error', 'debug']

describe('Capture', () => {
	// Snapshot every console method we might patch, and restore them all afterward — the leak guard.
	const snapshot = new Map<CaptureLevel, (...args: unknown[]) => void>()
	beforeEach(() => {
		const target: Record<CaptureLevel, (...args: unknown[]) => void> = console
		for (const method of CONSOLE_METHODS) snapshot.set(method, target[method])
	})
	afterEach(() => {
		const target: Record<CaptureLevel, (...args: unknown[]) => void> = console
		for (const [method, original] of snapshot) target[method] = original
		snapshot.clear()
	})

	describe('start / stop — patch and restore', () => {
		it('is inactive until start(), active between start and stop', () => {
			const capture = new Capture()
			expect(capture.active).toBe(false)
			capture.start()
			expect(capture.active).toBe(true)
			capture.stop()
			expect(capture.active).toBe(false)
		})

		it('start() replaces the configured console methods; stop() restores the originals', () => {
			const before = { log: console.log, warn: console.warn }
			const capture = new Capture({ levels: ['log', 'warn'] })
			capture.start()
			// The methods are now the wrappers, not the originals.
			expect(console.log).not.toBe(before.log)
			expect(console.warn).not.toBe(before.warn)
			capture.stop()
			// Exactly the original references are back.
			expect(console.log).toBe(before.log)
			expect(console.warn).toBe(before.warn)
		})

		it('only patches the configured levels — an unlisted method is left untouched', () => {
			const beforeError = console.error
			const capture = new Capture({ levels: ['log'] })
			capture.start()
			expect(console.error).toBe(beforeError) // error was not in `levels`
			capture.stop()
		})

		it('stop() while inactive is a safe no-op', () => {
			const capture = new Capture()
			expect(() => capture.stop()).not.toThrow()
			expect(capture.active).toBe(false)
		})
	})

	describe('buffering — total + by level, captured silently by default', () => {
		it('captures each intercepted call as a frozen message (level, text, numeric time)', () => {
			const before = Date.now()
			const capture = new Capture()
			capture.start()
			console.log('hello', 42)
			capture.stop()
			const after = Date.now()
			const [message] = capture.messages()
			expect(message?.level).toBe('log')
			expect(message?.text).toBe('hello 42')
			expect(typeof message?.time).toBe('number')
			expect(message?.time).toBeGreaterThanOrEqual(before)
			expect(message?.time).toBeLessThanOrEqual(after)
			// Frozen — a consumer reads but never mutates it.
			expect(Object.isFrozen(message)).toBe(true)
		})

		it('does NOT mirror by default — the real console method is not called', () => {
			const seen: string[] = []
			console.log = (...args: unknown[]) => seen.push(args.join(' '))
			const capture = new Capture({ levels: ['log'] }) // mirror defaults to false
			capture.start()
			console.log('swallowed')
			capture.stop()
			// Captured, but the snapshot-original log never ran.
			expect(capture.messages().map((m) => m.text)).toEqual(['swallowed'])
			expect(seen).toEqual([])
		})

		it('buckets messages by their originating level, in order', () => {
			const capture = new Capture()
			capture.start()
			console.log('a')
			console.warn('b')
			console.error('c')
			console.warn('d')
			capture.stop()
			expect(capture.messages().map((m) => `${m.level}:${m.text}`)).toEqual([
				'log:a',
				'warn:b',
				'error:c',
				'warn:d',
			])
			expect(capture.byLevel('warn').map((m) => m.text)).toEqual(['b', 'd'])
			expect(capture.byLevel('error').map((m) => m.text)).toEqual(['c'])
			expect(capture.byLevel('log').map((m) => m.text)).toEqual(['a'])
		})

		it('byLevel for a captured-but-empty level is an empty list; for an unconfigured level too', () => {
			const capture = new Capture({ levels: ['log'] })
			capture.start()
			console.log('only')
			capture.stop()
			expect(capture.byLevel('warn')).toEqual([]) // not configured → no bucket → empty copy
			expect(capture.byLevel('log')).toEqual([
				{ level: 'log', text: 'only', time: expect.any(Number) },
			])
		})

		it('captures debug and info as their own levels', () => {
			const capture = new Capture()
			capture.start()
			console.info('i')
			console.debug('d')
			capture.stop()
			expect(capture.byLevel('info').map((m) => m.text)).toEqual(['i'])
			expect(capture.byLevel('debug').map((m) => m.text)).toEqual(['d'])
		})

		it('does NOT intercept after stop() — later console calls pass through untouched', () => {
			const capture = new Capture({ levels: ['log'] })
			capture.start()
			console.log('during')
			capture.stop()
			console.log('after') // restored original — not captured
			expect(capture.messages().map((m) => m.text)).toEqual(['during'])
		})

		it('messages() / byLevel() return copies — mutating them cannot corrupt the buffers', () => {
			const capture = new Capture()
			capture.start()
			console.log('x')
			capture.stop()
			const all = capture.messages()
			const warns = capture.byLevel('log')
			expect(() => {
				const a = [...all]
				a.length = 0
				const w = [...warns]
				w.length = 0
			}).not.toThrow()
			expect(capture.messages()).toHaveLength(1)
			expect(capture.byLevel('log')).toHaveLength(1)
		})
	})

	describe('the capture event — the observation seam (§13)', () => {
		it('emits the frozen message for every intercepted call', () => {
			const capture = new Capture()
			const events = recordEmitterEvents(capture.emitter, ['capture'])
			capture.start()
			console.log('one')
			console.error('two')
			capture.stop()
			expect(events.capture.count).toBe(2)
			const first = events.capture.calls[0]?.[0]
			expect(first?.text).toBe('one')
			expect(first?.level).toBe('log')
			expect(Object.isFrozen(first)).toBe(true)
		})

		it('emits start and stop around the global patch lifecycle (once each, idempotent)', () => {
			const capture = new Capture()
			const events = recordEmitterEvents(capture.emitter, ['start', 'stop'])
			capture.start()
			capture.start() // idempotent — no second start
			capture.stop()
			capture.stop() // no-op — no second stop
			expect(events.start.count).toBe(1)
			expect(events.stop.count).toBe(1)
		})

		it('initial on-hooks subscribe at construction', () => {
			const received: CapturedMessage[] = []
			const capture = new Capture({ on: { capture: (message) => received.push(message) } })
			capture.start()
			console.log('hooked')
			capture.stop()
			expect(received.map((m) => m.text)).toEqual(['hooked'])
		})

		it('a throwing capture listener is isolated and routed to the error handler (never escapes the console call)', () => {
			const errors = createErrorRecorder()
			const capture = new Capture({ levels: ['log'], error: errors.handler })
			capture.start()
			capture.emitter.on('capture', () => {
				throw new Error('bad listener')
			})
			// The underlying console.log must not throw despite the bad listener.
			expect(() => console.log('safe')).not.toThrow()
			capture.stop()
			expect(errors.count).toBe(1)
			expect(errors.calls[0]?.[1]).toBe('capture')
			// The message was still buffered despite the throwing listener.
			expect(capture.messages().map((m) => m.text)).toEqual(['safe'])
		})
	})

	describe('mirror — fan out to the snapshot-original console', () => {
		it('forwards each call to the snapshot-original method with the ORIGINAL args (not the stringified text)', () => {
			const seen: (readonly unknown[])[] = []
			console.warn = (...args: unknown[]) => seen.push(args)
			const capture = new Capture({ levels: ['warn'], mirror: true })
			capture.start()
			console.warn('alert', { code: 1 })
			capture.stop()
			// Mirrored verbatim — the original receives the raw args, not the captured line.
			expect(seen).toEqual([['alert', { code: 1 }]])
			// And still captured (stringified).
			expect(capture.byLevel('warn').map((m) => m.text)).toEqual(['alert {"code":1}'])
		})

		it('mirrors through the snapshot taken at start(), never a later re-patch (no echo loop)', () => {
			const real: string[] = []
			console.log = (text: string) => real.push(text)
			const capture = new Capture({ levels: ['log'], mirror: true })
			capture.start() // snapshots the `real` log NOW; console.log is now the wrapper
			// The wrapper must call the snapshot original, not console.log (itself) — proven by the
			// fact that one call produces exactly one `real` entry, not infinite recursion.
			console.log('echo')
			capture.stop()
			expect(real).toEqual(['echo'])
		})
	})

	describe('sink forward — tee captured output into a sink', () => {
		it('writes each captured call to the sink with the mapped LogLevel', () => {
			const sink = createRecordingSink()
			const capture = new Capture({ sink })
			capture.start()
			console.log('l')
			console.info('i')
			console.warn('w')
			console.error('e')
			console.debug('d')
			capture.stop()
			expect(sink.calls).toEqual([
				['l', 'info'], // log maps to the default/info stream
				['i', 'info'],
				['w', 'warn'],
				['e', 'error'],
				['d', 'debug'],
			])
		})

		it('mirror and sink fan out together', () => {
			const seen: string[] = []
			console.error = (text: string) => seen.push(text)
			const sink = createRecordingSink()
			const capture = new Capture({ levels: ['error'], mirror: true, sink })
			capture.start()
			console.error('boom')
			capture.stop()
			expect(seen).toEqual(['boom']) // mirrored
			expect(sink.calls).toEqual([['boom', 'error']]) // forwarded
			expect(capture.byLevel('error').map((m) => m.text)).toEqual(['boom']) // buffered
		})
	})

	describe('bounded buffer', () => {
		it('keeps at most `limit` messages in the total buffer, dropping the oldest first', () => {
			const capture = new Capture({ levels: ['log'], limit: 3 })
			capture.start()
			for (const n of [1, 2, 3, 4, 5]) console.log(`m${n}`)
			capture.stop()
			expect(capture.messages().map((m) => m.text)).toEqual(['m3', 'm4', 'm5'])
		})

		it('bounds each by-level bucket independently', () => {
			const capture = new Capture({ levels: ['warn', 'error'], limit: 2 })
			capture.start()
			console.warn('w1')
			console.warn('w2')
			console.warn('w3')
			console.error('e1')
			capture.stop()
			expect(capture.byLevel('warn').map((m) => m.text)).toEqual(['w2', 'w3'])
			expect(capture.byLevel('error').map((m) => m.text)).toEqual(['e1'])
		})
	})

	describe('clear — empties buffers but keeps interception running', () => {
		it('drops every buffered message yet stays active and keeps capturing', () => {
			const capture = new Capture({ levels: ['log'] })
			capture.start()
			console.log('before clear')
			capture.clear()
			expect(capture.messages()).toHaveLength(0)
			expect(capture.byLevel('log')).toHaveLength(0)
			expect(capture.active).toBe(true)
			console.log('after clear')
			capture.stop()
			expect(capture.messages().map((m) => m.text)).toEqual(['after clear'])
		})
	})

	describe('idempotent start — never double-patches', () => {
		it('a second start() does not re-snapshot (the first original survives an intervening patch)', () => {
			const original = console.log
			const capture = new Capture({ levels: ['log'] })
			capture.start()
			const wrapper = console.log
			capture.start() // no-op — must NOT snapshot `wrapper` as the original
			capture.stop()
			// If the second start had re-snapshotted, stop() would restore `wrapper`, not `original`.
			expect(console.log).toBe(original)
			expect(console.log).not.toBe(wrapper)
		})
	})

	describe('total stringify — adversarial args can never crash the captured program', () => {
		it('captures a circular argument as [Circular] without throwing the console call', () => {
			const capture = new Capture({ levels: ['log'] })
			capture.start()
			const cycle: Record<string, unknown> = { name: 'root' }
			cycle.self = cycle
			expect(() => console.log('cyclic', cycle)).not.toThrow()
			capture.stop()
			const text = capture.messages()[0]?.text ?? ''
			expect(text).toContain('cyclic')
			expect(text).toContain('[Circular]')
		})

		it('captures a BigInt / symbol / function argument via String fallback, never throwing', () => {
			const capture = new Capture({ levels: ['log'] })
			capture.start()
			expect(() => console.log({ big: 10n }, Symbol('s'), function named() {})).not.toThrow()
			capture.stop()
			const text = capture.messages()[0]?.text ?? ''
			// The BigInt-bearing object falls back to String(...) ('[object Object]'); the symbol to
			// 'Symbol(s)'; the function to its source — all space-joined, nothing raised.
			expect(text).toContain('[object Object]')
			expect(text).toContain('Symbol(s)')
			expect(text).toContain('named')
		})

		it('captures an Error argument as `name: message`', () => {
			const capture = new Capture({ levels: ['error'] })
			capture.start()
			console.error(new TypeError('boom'))
			capture.stop()
			expect(capture.byLevel('error').map((m) => m.text)).toEqual(['TypeError: boom'])
		})

		it('captures a throwing-toJSON argument via String fallback, never propagating the throw', () => {
			const capture = new Capture({ levels: ['log'] })
			capture.start()
			const hostile = {
				toJSON(): never {
					throw new Error('hostile')
				},
			}
			expect(() => console.log(hostile)).not.toThrow()
			capture.stop()
			expect(capture.messages().map((m) => m.text)).toEqual(['[object Object]'])
		})

		it('captures an empty console.log() as a blank line', () => {
			const capture = new Capture({ levels: ['log'] })
			capture.start()
			console.log()
			capture.stop()
			expect(capture.messages().map((m) => m.text)).toEqual([''])
		})
	})

	describe('bounded buffer — exact boundary', () => {
		it('retains EXACTLY `limit` messages (at the cap, nothing dropped)', () => {
			const capture = new Capture({ levels: ['log'], limit: 3 })
			capture.start()
			console.log('m1')
			console.log('m2')
			console.log('m3') // exactly at the cap
			capture.stop()
			expect(capture.messages().map((m) => m.text)).toEqual(['m1', 'm2', 'm3'])
		})

		it('drops exactly the oldest when ONE over the cap (total + the bucket together)', () => {
			const capture = new Capture({ levels: ['log'], limit: 2 })
			capture.start()
			console.log('a')
			console.log('b')
			console.log('c') // one over → 'a' evicted from both the total and the bucket
			capture.stop()
			expect(capture.messages().map((m) => m.text)).toEqual(['b', 'c'])
			expect(capture.byLevel('log').map((m) => m.text)).toEqual(['b', 'c'])
		})
	})

	describe('clear after stop — buffers emptied, no interception to keep', () => {
		it('clear() while inactive empties the buffers and leaves active false', () => {
			const capture = new Capture({ levels: ['log'] })
			capture.start()
			console.log('x')
			capture.stop()
			expect(capture.messages()).toHaveLength(1)
			capture.clear()
			expect(capture.messages()).toHaveLength(0)
			expect(capture.active).toBe(false)
		})
	})

	describe('destroy', () => {
		it('stops interception (restoring console) and destroys the emitter', () => {
			const original = console.log
			const capture = new Capture({ levels: ['log'] })
			capture.start()
			capture.destroy()
			expect(capture.active).toBe(false)
			expect(console.log).toBe(original) // restored
			expect(capture.emitter.destroyed).toBe(true)
		})

		it('is idempotent — a second destroy() does not throw and console stays restored', () => {
			const original = console.log
			const capture = new Capture({ levels: ['log'] })
			capture.start()
			capture.destroy()
			expect(() => capture.destroy()).not.toThrow()
			expect(console.log).toBe(original)
			expect(capture.active).toBe(false)
		})

		it('destroy() on a never-started capture is a safe no-op', () => {
			const capture = new Capture({ levels: ['log'] })
			expect(() => capture.destroy()).not.toThrow()
			expect(capture.active).toBe(false)
			expect(capture.emitter.destroyed).toBe(true)
		})
	})

	describe('the no-capture-loop principle — does NOT recapture our own sink output', () => {
		it('a Logger created before the Capture writes through the snapshot console and is not captured', () => {
			// The headline interplay (C-b ⇄ C-d): the default console sink snapshots `console` at
			// creation, so a Capture installed AFTERWARD catches third-party `console.*` but never the
			// logger's own writes.
			const real: string[] = []
			console.log = (text: string) => real.push(text)
			console.info = (text: string) => real.push(text)
			// Logger built FIRST — its console sink snapshots the real console.log now.
			const logger = createLogger({ level: 'info', styler: createStyler({ enabled: false }) })
			const capture = new Capture()
			capture.start() // patches console AFTER the logger snapshotted it
			console.log('third-party') // captured
			logger.info('our own line') // routed through the snapshot — NOT captured
			capture.stop()
			// The capture saw only the third-party call, never the logger's output (no loop).
			expect(capture.messages().map((m) => m.text)).toEqual(['third-party'])
			// And the logger's line still reached the real stream.
			expect(real.some((line) => line.includes('our own line'))).toBe(true)
			logger.destroy()
		})
	})

	describe('factory parity', () => {
		it('createCapture yields a working interceptor', () => {
			const capture = createCapture({ levels: ['log'] })
			capture.start()
			console.log('via factory')
			capture.stop()
			expect(capture.messages().map((m) => m.text)).toEqual(['via factory'])
		})
	})
})
