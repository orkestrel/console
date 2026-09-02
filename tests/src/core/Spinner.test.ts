import type { SpinnerEventMap } from '@src/core'
import type { RecordingSinkInterface } from '../../setup.js'
import { createStyler, createTheme, DEFAULT_THEME, SPINNER_FRAMES, Spinner, strip } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createRecorder, createRecorders, waitForDelay } from '@orkestrel/test'
import { createRecordingSink } from '../../setup.js'

// Spinner — the self-driving, observable activity spinner. start() arms a setInterval that advances
// a glyph cycle, writing each `\r` + frame line to its sink and emitting it on `frame`; succeed/fail
// commit a final ✔/✖ line. UNIVERSAL (setInterval + the one styler + the one sink — no node:*).
//
// DETERMINISM: frame-CONTENT is driven by calling tick() directly, so content assertions never wait.
// The internal timer's arming / firing / clearing is proven on the REAL host clock at a short PERIOD:
// every test that arms the timer closes with the leak guard — wait several periods and assert the
// recording sink received nothing further, which is what a still-armed interval would contradict. A
// disabled styler is used for content assertions so the glyph reads plainly; one case uses an enabled
// styler and asserts via strip().

const PLAIN = createStyler({ enabled: false })

// The real spinner period every timer test configures — short enough to keep the suite fast (canon:
// 10–50 ms), long enough that a wait of several periods is unambiguous.
const PERIOD = 10

// The leak-guard window, several periods wide. A still-armed interval paints a frame every PERIOD,
// so an unchanged sink across this window is the observable proof that no timer survived.
const SETTLE = PERIOD * 4

// The longest any test waits for frames it expects to arrive. Reached only when the timer never
// fired, which is the defect the wait exists to surface.
const FRAME_DEADLINE = 2000

// The texts a recording sink received, with the leading `\r` (and any trailing `\n`) stripped — the
// VISIBLE frame content, which is what every content assertion is about.
function frames(sink: RecordingSinkInterface): readonly string[] {
	return sink.calls.map(([text]) => text.replace(/^\r/, '').replace(/\n$/, ''))
}

// Wait until `sink` has recorded at least `count` writes, or until the deadline passes. The real
// clock decides when each frame lands, so a test that needs a running timer waits for the frames it
// needs rather than for a fixed span a loaded host can miss.
async function waitForFrames(sink: RecordingSinkInterface, count: number): Promise<void> {
	const deadline = performance.now() + FRAME_DEADLINE
	while (sink.calls.length < count && performance.now() < deadline) await waitForDelay(PERIOD)
}

describe('Spinner', () => {
	describe('tick — frame content + the leading \\r (redraw deferred to the sink)', () => {
		it('writes `\\r` + the current glyph and message, and emits the bare line', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'building', sink, styler: PLAIN })
			const events = createRecorders<SpinnerEventMap, 'frame'>(spinner.emitter, ['frame'])

			spinner.tick()

			// The sink write carries the leading \r the TTY sink overwrites on; the event carries the
			// bare line (no \r) — the redraw is the sink's job, not the spinner's.
			expect(sink.calls).toEqual([['\r⠋ building', undefined]])
			expect(events.frame.calls).toEqual([['⠋ building']])
		})

		it('advances through the frame cycle, wrapping back to the first', () => {
			const sink = createRecordingSink()
			const frameSet = ['a', 'b', 'c']
			const spinner = new Spinner({ message: 'x', frames: frameSet, sink, styler: PLAIN })

			spinner.tick()
			spinner.tick()
			spinner.tick()
			spinner.tick() // wraps to 'a'

			expect(frames(sink)).toEqual(['a x', 'b x', 'c x', 'a x'])
		})

		it('renders a bare glyph (no trailing space) when the message is empty', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['*'], sink, styler: PLAIN })

			spinner.tick()

			expect(frames(sink)).toEqual(['*'])
		})

		it('colors the glyph through the styler (asserted via strip)', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'go', frames: ['*'], sink, styler: createStyler() })

			spinner.tick()

			const [text] = sink.calls[0] ?? ['']
			// The raw write carries ANSI escapes around the glyph…
			expect(strip(text)).not.toBe(text)
			// …but the visible content (escapes stripped via the framework helper) is the plain frame
			// line, with the leading \r removed.
			expect(strip(text).replace(/^\r/, '')).toBe('* go')
		})

		it('uses the theme accent for the glyph and leaves the message unchanged', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({
				message: 'go',
				frames: ['*'],
				sink,
				styler: createStyler(),
				theme: createTheme({ accent: createStyler().brightMagenta.bold.style }),
			})
			spinner.tick()
			expect(sink.calls[0]?.[0]).toBe('\r\x1b[1;95m*\x1b[0m go')
		})

		it('pins the exact default-theme bytes for a tick frame', () => {
			const sink = createRecordingSink()
			new Spinner({ message: 'spin', sink }).tick()
			expect(sink.calls).toEqual([['\r\x1b[36m⠋\x1b[0m spin', undefined]])
		})
	})

	describe('update — change the message', () => {
		it('changes the message; the next tick renders it', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'first', frames: ['*'], sink, styler: PLAIN })

			spinner.update('second')
			expect(spinner.message).toBe('second')
			spinner.tick()

			expect(frames(sink)).toEqual(['* second'])
		})

		it('re-renders immediately (without advancing the frame) when active', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({
				message: 'a',
				frames: ['x', 'y'],
				interval: PERIOD,
				sink,
				styler: PLAIN,
			})
			// start / update / stop run in one synchronous block, so no interval fires between them.
			spinner.start() // paints frame 0 ('x a') immediately, index now at 'y'
			spinner.update('b') // re-renders the CURRENT frame ('y') — update does not advance
			spinner.stop()

			// start → 'x a' (index advanced to y), update re-renders current glyph (y) with new message.
			expect(frames(sink)).toEqual(['x a', 'y b'])

			// Leak guard — a surviving interval would paint several more frames across this window.
			await waitForDelay(SETTLE)
			expect(frames(sink)).toEqual(['x a', 'y b'])
		})

		it('does not write on update when inactive (no timer running)', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'a', sink, styler: PLAIN })
			spinner.update('b')
			expect(sink.calls).toEqual([])
			expect(spinner.message).toBe('b')
		})
	})

	describe('start / stop — the self-driving timer (real clock + leak guard)', () => {
		it('is inactive until start(), active between start and stop', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ interval: PERIOD, sink })
			expect(spinner.active).toBe(false)
			spinner.start()
			expect(spinner.active).toBe(true)
			spinner.stop()
			expect(spinner.active).toBe(false)

			const stopped = sink.calls.length
			await waitForDelay(SETTLE)
			expect(sink.calls.length).toBe(stopped) // leak guard — no interval left armed
		})

		it('paints the first frame immediately on start, then one per interval', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({
				message: 'm',
				frames: ['a', 'b', 'c'],
				interval: PERIOD,
				sink,
				styler: PLAIN,
			})

			spinner.start() // immediate first frame: 'a m'
			expect(frames(sink)).toEqual(['a m'])

			// The host clock decides how many further frames land before stop(), so the assertion pins
			// the property that must hold at every length: each frame is the next glyph in the cycle.
			await waitForFrames(sink, 3)
			spinner.stop()

			const painted = frames(sink)
			expect(painted.length).toBeGreaterThanOrEqual(3)
			const cycle = ['a m', 'b m', 'c m']
			expect(painted).toEqual(painted.map((_line, index) => cycle[index % cycle.length]))

			const stopped = sink.calls.length
			await waitForDelay(SETTLE)
			expect(sink.calls.length).toBe(stopped)
		})

		it('stop() clears the timer and leaves the line — no further frames fire', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['a', 'b'], interval: PERIOD, sink, styler: PLAIN })

			spinner.start()
			await waitForFrames(sink, 2) // the interval is genuinely firing before it is stopped
			spinner.stop()
			const after = sink.calls.length

			await waitForDelay(SETTLE) // no timer armed → nothing more is written
			expect(sink.calls.length).toBe(after)
		})

		it('start() is idempotent — a second start does not arm a second timer', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['a'], interval: PERIOD, sink, styler: PLAIN })

			spinner.start()
			spinner.start() // no-op — must not arm a second interval
			expect(spinner.active).toBe(true)

			await waitForFrames(sink, 2)
			// One stop() clears one handle. A second armed interval would have orphaned the first and
			// kept painting past this stop, so silence across the window proves only one was ever armed.
			spinner.stop()
			const after = sink.calls.length

			await waitForDelay(SETTLE)
			expect(sink.calls.length).toBe(after)
		})

		it('stop() while inactive is a safe no-op', () => {
			const spinner = new Spinner({ sink: createRecordingSink() })
			expect(() => spinner.stop()).not.toThrow()
			expect(spinner.active).toBe(false)
		})
	})

	describe('succeed / fail — the final outcome line, timer always cleared', () => {
		it('succeed() stops the timer and writes ✔ + message + newline', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({
				message: 'work',
				frames: ['*'],
				interval: PERIOD,
				sink,
				styler: PLAIN,
			})

			spinner.start()
			spinner.succeed('done')

			expect(spinner.active).toBe(false)
			// Final write: \r + ✔ + message + newline, on the default stream.
			expect(sink.calls.at(-1)).toEqual(['\r✔ done\n', undefined])
			expect(spinner.message).toBe('done')

			// Leak guard — a surviving interval would paint over the committed outcome line.
			const after = sink.calls.length
			await waitForDelay(SETTLE)
			expect(sink.calls.length).toBe(after)
			expect(sink.calls.at(-1)).toEqual(['\r✔ done\n', undefined])
		})

		it('fail() stops the timer and writes ✖ + message + newline to the error stream', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['*'], interval: PERIOD, sink, styler: PLAIN })

			spinner.start()
			spinner.fail('broke')

			expect(spinner.active).toBe(false)
			expect(sink.calls.at(-1)).toEqual(['\r✖ broke\n', 'error']) // error routes to the error stream

			const after = sink.calls.length
			await waitForDelay(SETTLE)
			expect(sink.calls.length).toBe(after)
			expect(sink.calls.at(-1)).toEqual(['\r✖ broke\n', 'error'])
		})

		it('succeed() with no argument reuses the current message', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'kept', frames: ['*'], sink, styler: PLAIN })
			spinner.succeed()
			expect(sink.calls.at(-1)).toEqual(['\r✔ kept\n', undefined])
		})

		it('succeed() on a never-started spinner still writes the final line (and arms no timer)', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'x', interval: PERIOD, sink, styler: PLAIN })
			spinner.succeed('ok')
			expect(frames(sink)).toEqual(['✔ ok'])

			// Nothing armed a timer, so the window adds no frame.
			await waitForDelay(SETTLE)
			expect(frames(sink)).toEqual(['✔ ok'])
		})

		it('colors the icon + message through the styler (asserted via strip)', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['*'], sink, styler: createStyler() })
			spinner.succeed('green')
			const [text] = sink.calls.at(-1) ?? ['']
			expect(strip(text)).not.toBe(text) // escapes present
			// Strip ANSI via the framework helper; remove the leading \r + trailing newline.
			expect(strip(text).replace(/^\r/, '').replace(/\n$/, '')).toBe('✔ green')
		})

		it('pins the exact default-theme bytes for a success outcome line', () => {
			const sink = createRecordingSink()
			new Spinner({ sink }).succeed('done')
			expect(sink.calls).toEqual([['\r\x1b[32m✔\x1b[0m \x1b[32mdone\x1b[0m\n', undefined]])
		})

		it('uses the theme status icon and style for outcome lines', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({
				sink,
				styler: createStyler(),
				theme: createTheme({
					statuses: {
						success: { icon: '+', style: createStyler().brightBlue.underline.style },
						error: { icon: '-', style: createStyler().brightMagenta.bold.style },
					},
				}),
			})
			spinner.succeed('done')
			spinner.fail('failed')
			expect(sink.calls).toEqual([
				['\r\x1b[4;94m+\x1b[0m \x1b[4;94mdone\x1b[0m\n', undefined],
				['\r\x1b[1;95m-\x1b[0m \x1b[1;95mfailed\x1b[0m\n', 'error'],
			])
		})

		it('keeps frame and outcome bytes identical with the explicit default theme', () => {
			const implicitSink = createRecordingSink()
			const explicitSink = createRecordingSink()
			new Spinner({ sink: implicitSink, message: 'spin' }).tick()
			new Spinner({ sink: explicitSink, message: 'spin', theme: DEFAULT_THEME }).tick()
			new Spinner({ sink: implicitSink }).succeed('done')
			new Spinner({ sink: explicitSink, theme: DEFAULT_THEME }).succeed('done')
			new Spinner({ sink: implicitSink }).fail('failed')
			new Spinner({ sink: explicitSink, theme: DEFAULT_THEME }).fail('failed')
			expect(implicitSink.calls).toEqual(explicitSink.calls)
		})
	})

	describe('the frame / start / stop events — the observation seam (§13)', () => {
		it('emits a frame per tick and a final frame on succeed', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'm', frames: ['a', 'b'], sink, styler: PLAIN })
			const events = createRecorders<SpinnerEventMap, 'frame'>(spinner.emitter, ['frame'])

			spinner.tick()
			spinner.tick()
			spinner.succeed('ok')

			expect(events.frame.calls.map(([line]) => line)).toEqual(['a m', 'b m', '✔ ok'])
		})

		it('emits start / stop around the timer lifecycle (once each, idempotent)', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['a'], interval: PERIOD, sink, styler: PLAIN })
			const events = createRecorders<SpinnerEventMap, 'start' | 'stop' | 'frame'>(spinner.emitter, [
				'start',
				'stop',
				'frame',
			])

			spinner.start()
			spinner.start() // idempotent — no second start
			spinner.stop()
			spinner.stop() // no-op — no second stop

			expect(events.start.count).toBe(1)
			expect(events.stop.count).toBe(1)

			const painted = events.frame.count
			await waitForDelay(SETTLE)
			expect(events.frame.count).toBe(painted) // leak guard — nothing is still painting
		})

		it('succeed emits stop exactly once (the timer transition), then the final frame', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['a'], interval: PERIOD, sink, styler: PLAIN })
			const events = createRecorders<SpinnerEventMap, 'start' | 'stop' | 'frame'>(spinner.emitter, [
				'start',
				'stop',
				'frame',
			])

			spinner.start()
			spinner.succeed('ok')

			expect(events.start.count).toBe(1)
			expect(events.stop.count).toBe(1)
			expect(events.frame.calls.map(([line]) => line)).toEqual(['a', '✔ ok'])

			await waitForDelay(SETTLE)
			expect(events.frame.calls.map(([line]) => line)).toEqual(['a', '✔ ok']) // leak guard
		})

		it('initial on-hooks subscribe at construction', () => {
			const received: string[] = []
			const spinner = new Spinner({
				frames: ['*'],
				styler: PLAIN,
				sink: createRecordingSink(),
				on: { frame: (line) => received.push(line) },
			})
			spinner.tick()
			expect(received).toEqual(['*'])
		})

		it('a throwing frame listener is isolated and routed to the error handler', () => {
			const errors = createRecorder<readonly [error: unknown, event: string]>()
			const spinner = new Spinner({
				frames: ['*'],
				styler: PLAIN,
				sink: createRecordingSink(),
				error: errors.handler,
			})
			spinner.emitter.on('frame', () => {
				throw new Error('bad listener')
			})
			// The tick must not throw despite the bad listener.
			expect(() => spinner.tick()).not.toThrow()
			expect(errors.count).toBe(1)
			expect(errors.calls[0]?.[1]).toBe('frame')
		})
	})

	describe('operations after stop are safe — no timer, no surprise re-arm', () => {
		it('tick() after stop() still renders a frame but arms NO timer (manual advance only)', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['a', 'b'], interval: PERIOD, sink, styler: PLAIN })
			spinner.start()
			spinner.stop()

			const stopped = sink.calls.length
			await waitForDelay(SETTLE)
			expect(sink.calls.length).toBe(stopped) // stop() cleared the interval

			spinner.tick() // a manual tick renders, but does not re-arm the interval
			expect(sink.calls.length).toBe(stopped + 1)

			await waitForDelay(SETTLE)
			expect(sink.calls.length).toBe(stopped + 1) // still no timer
		})

		it('update() after stop() changes the message but writes nothing (inactive ⇒ no paint)', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'a', frames: ['*'], sink, styler: PLAIN })
			spinner.start()
			spinner.stop()
			const before = sink.calls.length
			spinner.update('b')
			expect(spinner.message).toBe('b')
			expect(sink.calls.length).toBe(before) // no write while inactive
		})

		it('a second succeed() after stop writes another final line and arms no timer', async () => {
			// succeed()/fail() are NOT idempotent: each commits a fresh final line (stop() inside is the
			// no-op part). Documents that calling succeed twice writes two lines (the timer stays cleared).
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['*'], interval: PERIOD, sink, styler: PLAIN })
			spinner.start()
			spinner.succeed('one')
			const afterFirst = sink.calls.length
			spinner.succeed('two')
			expect(sink.calls.length).toBe(afterFirst + 1)
			expect(sink.calls.at(-1)).toEqual(['\r✔ two\n', undefined])

			await waitForDelay(SETTLE)
			expect(sink.calls.length).toBe(afterFirst + 1) // leak guard
		})

		it('fail() after succeed() commits a failure line to the error stream (no timer leak)', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['*'], interval: PERIOD, sink, styler: PLAIN })
			spinner.start()
			spinner.succeed('ok')
			spinner.fail('then broke')
			expect(sink.calls.at(-1)).toEqual(['\r✖ then broke\n', 'error'])

			const after = sink.calls.length
			await waitForDelay(SETTLE)
			expect(sink.calls.length).toBe(after)
		})
	})

	describe('destroy', () => {
		it('stops the timer (clearing it) and destroys the emitter', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['a'], interval: PERIOD, sink, styler: PLAIN })
			spinner.start()
			spinner.destroy()
			expect(spinner.active).toBe(false)
			expect(spinner.emitter.destroyed).toBe(true)

			// A destroyed emitter emits nothing, but a surviving interval still writes to the sink on
			// every tick — so the sink is where a leak past destroy() shows.
			const after = sink.calls.length
			await waitForDelay(SETTLE)
			expect(sink.calls.length).toBe(after)
		})

		it('is idempotent — a second destroy() does not throw and leaves no timer', async () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['a'], interval: PERIOD, sink, styler: PLAIN })
			spinner.start()
			spinner.destroy()
			expect(() => spinner.destroy()).not.toThrow()
			expect(spinner.active).toBe(false)

			const after = sink.calls.length
			await waitForDelay(SETTLE)
			expect(sink.calls.length).toBe(after)
		})

		it('destroy() on a never-started spinner is a safe no-op', () => {
			const spinner = new Spinner({ frames: ['a'], sink: createRecordingSink(), styler: PLAIN })
			expect(() => spinner.destroy()).not.toThrow()
			expect(spinner.active).toBe(false)
			expect(spinner.emitter.destroyed).toBe(true)
		})
	})

	describe('empty frame set — defensive (no crash on a degenerate cycle)', () => {
		it('a single-frame set repeats that frame on every tick (no wrap drift)', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['x'], message: 'm', sink, styler: PLAIN })
			spinner.tick()
			spinner.tick()
			expect(frames(sink)).toEqual(['x m', 'x m'])
		})

		it('an explicitly-empty frames array falls back to the default cycle (no div-by-zero NaN)', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: [], message: 'm', sink, styler: PLAIN })
			expect(() => spinner.tick()).not.toThrow()
			const [line] = frames(sink)
			expect(line).not.toContain('NaN')
			expect(line).toBe(`${SPINNER_FRAMES[0]} m`)
			// It cycles through the full default set, not a degenerate one-frame loop.
			for (let n = 1; n < SPINNER_FRAMES.length; n += 1) spinner.tick()
			const all = frames(sink)
			expect(all).toHaveLength(SPINNER_FRAMES.length)
			expect(all.every((text) => !text.includes('NaN'))).toBe(true)
		})
	})
})
