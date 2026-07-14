import { createSpinner, createStyler, SPINNER_FRAMES, Spinner, strip } from '@src/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createErrorRecorder, createRecordingSink, recordEmitterEvents } from '../../setup.js'

// Spinner — the self-driving, observable activity spinner. start() arms a setInterval that advances
// a glyph cycle, writing each `\r` + frame line to its sink and emitting it on `frame`; success/failure
// commit a final ✔/✖ line. UNIVERSAL (setInterval + the one styler + the one sink — no node:*).
//
// DETERMINISM: frame-CONTENT is driven by calling tick() directly (no real clock). The internal
// timer's arming / firing / clearing is proven with vitest FAKE timers, and EVERY test that arms the
// timer asserts vi.getTimerCount() === 0 afterward — the leak guard (no interval ever escapes). A
// disabled styler is used for content assertions so the glyph reads plainly; one case uses an enabled
// styler and asserts via strip().

// The texts a recording sink received, with the leading `\r` (and any trailing `\n`) stripped — the
// VISIBLE frame content, which is what every content assertion is about.
function frames(sink: ReturnType<typeof createRecordingSink>): readonly string[] {
	return sink.calls.map(([text]) => text.replace(/^\r/, '').replace(/\n$/, ''))
}

const PLAIN = createStyler({ enabled: false })

describe('Spinner', () => {
	describe('tick — frame content + the leading \\r (redraw deferred to the sink)', () => {
		it('writes `\\r` + the current glyph and message, and emits the bare line', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'building', sink, styler: PLAIN })
			const events = recordEmitterEvents(spinner.emitter, ['frame'])

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

		it('re-renders immediately (without advancing the frame) when active', () => {
			vi.useFakeTimers()
			try {
				const sink = createRecordingSink()
				const spinner = new Spinner({ message: 'a', frames: ['x', 'y'], sink, styler: PLAIN })
				spinner.start() // paints frame 0 ('x a') immediately, index now at 'y'
				spinner.update('b') // re-renders the CURRENT frame ('y'? no — update does not advance)
				spinner.stop()
				// start → 'x a' (index advanced to y), update re-renders current glyph (y) with new message.
				expect(frames(sink)).toEqual(['x a', 'y b'])
				expect(vi.getTimerCount()).toBe(0)
			} finally {
				vi.useRealTimers()
			}
		})

		it('does not write on update when inactive (no timer running)', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'a', sink, styler: PLAIN })
			spinner.update('b')
			expect(sink.calls).toEqual([])
			expect(spinner.message).toBe('b')
		})
	})

	describe('start / stop — the self-driving timer (fake timers + leak guard)', () => {
		afterEach(() => {
			vi.useRealTimers()
		})

		it('is inactive until start(), active between start and stop', () => {
			vi.useFakeTimers()
			const spinner = new Spinner({ sink: createRecordingSink() })
			expect(spinner.active).toBe(false)
			spinner.start()
			expect(spinner.active).toBe(true)
			spinner.stop()
			expect(spinner.active).toBe(false)
			expect(vi.getTimerCount()).toBe(0) // leak guard — no interval left armed
		})

		it('paints the first frame immediately on start, then one per interval', () => {
			vi.useFakeTimers()
			const sink = createRecordingSink()
			const spinner = new Spinner({
				message: 'm',
				frames: ['a', 'b', 'c'],
				interval: 80,
				sink,
				styler: PLAIN,
			})

			spinner.start() // immediate first frame: 'a m'
			expect(frames(sink)).toEqual(['a m'])

			vi.advanceTimersByTime(80) // → 'b m'
			vi.advanceTimersByTime(80) // → 'c m'
			expect(frames(sink)).toEqual(['a m', 'b m', 'c m'])

			spinner.stop()
			expect(vi.getTimerCount()).toBe(0)
		})

		it('stop() clears the timer and leaves the line — no further frames fire', () => {
			vi.useFakeTimers()
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['a', 'b'], interval: 50, sink, styler: PLAIN })

			spinner.start()
			spinner.stop()
			const after = sink.calls.length
			vi.advanceTimersByTime(50 * 5) // no timer armed → nothing more is written
			expect(sink.calls.length).toBe(after)
			expect(vi.getTimerCount()).toBe(0)
		})

		it('start() is idempotent — a second start does not arm a second timer', () => {
			vi.useFakeTimers()
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['a'], interval: 40, sink, styler: PLAIN })

			spinner.start()
			spinner.start() // no-op — must not arm a second interval
			expect(vi.getTimerCount()).toBe(1) // exactly one timer, not two

			spinner.stop()
			expect(vi.getTimerCount()).toBe(0)
		})

		it('stop() while inactive is a safe no-op', () => {
			const spinner = new Spinner({ sink: createRecordingSink() })
			expect(() => spinner.stop()).not.toThrow()
			expect(spinner.active).toBe(false)
		})
	})

	describe('success / failure — the final outcome line, timer always cleared', () => {
		afterEach(() => {
			vi.useRealTimers()
		})

		it('success() stops the timer and writes ✔ + message + newline', () => {
			vi.useFakeTimers()
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'work', frames: ['*'], sink, styler: PLAIN })

			spinner.start()
			spinner.success('done')

			expect(spinner.active).toBe(false)
			expect(vi.getTimerCount()).toBe(0) // leak guard
			// Final write: \r + ✔ + message + newline, on the default stream.
			const last = sink.calls.at(-1)
			expect(last).toEqual(['\r✔ done\n', undefined])
			expect(spinner.message).toBe('done')
		})

		it('failure() stops the timer and writes ✖ + message + newline to the error stream', () => {
			vi.useFakeTimers()
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['*'], sink, styler: PLAIN })

			spinner.start()
			spinner.failure('broke')

			expect(spinner.active).toBe(false)
			expect(vi.getTimerCount()).toBe(0)
			const last = sink.calls.at(-1)
			expect(last).toEqual(['\r✖ broke\n', 'error']) // error routes to the error stream
		})

		it('success() with no argument reuses the current message', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'kept', frames: ['*'], sink, styler: PLAIN })
			spinner.success()
			expect(sink.calls.at(-1)).toEqual(['\r✔ kept\n', undefined])
		})

		it('success() on a never-started spinner still writes the final line (and arms no timer)', () => {
			vi.useFakeTimers()
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'x', sink, styler: PLAIN })
			spinner.success('ok')
			expect(frames(sink)).toEqual(['✔ ok'])
			expect(vi.getTimerCount()).toBe(0)
		})

		it('colors the icon + message through the styler (asserted via strip)', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['*'], sink, styler: createStyler() })
			spinner.success('green')
			const [text] = sink.calls.at(-1) ?? ['']
			expect(strip(text)).not.toBe(text) // escapes present
			// Strip ANSI via the framework helper; remove the leading \r + trailing newline.
			expect(strip(text).replace(/^\r/, '').replace(/\n$/, '')).toBe('✔ green')
		})
	})

	describe('the frame / start / stop events — the observation seam (§13)', () => {
		afterEach(() => {
			vi.useRealTimers()
		})

		it('emits a frame per tick and a final frame on success', () => {
			const sink = createRecordingSink()
			const spinner = new Spinner({ message: 'm', frames: ['a', 'b'], sink, styler: PLAIN })
			const events = recordEmitterEvents(spinner.emitter, ['frame'])

			spinner.tick()
			spinner.tick()
			spinner.success('ok')

			expect(events.frame.calls.map(([line]) => line)).toEqual(['a m', 'b m', '✔ ok'])
		})

		it('emits start / stop around the timer lifecycle (once each, idempotent)', () => {
			vi.useFakeTimers()
			const spinner = new Spinner({ frames: ['a'], sink: createRecordingSink(), styler: PLAIN })
			const events = recordEmitterEvents(spinner.emitter, ['start', 'stop'])

			spinner.start()
			spinner.start() // idempotent — no second start
			spinner.stop()
			spinner.stop() // no-op — no second stop

			expect(events.start.count).toBe(1)
			expect(events.stop.count).toBe(1)
			expect(vi.getTimerCount()).toBe(0)
		})

		it('success emits stop exactly once (the timer transition), then the final frame', () => {
			vi.useFakeTimers()
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['a'], sink, styler: PLAIN })
			const events = recordEmitterEvents(spinner.emitter, ['start', 'stop', 'frame'])

			spinner.start()
			spinner.success('ok')

			expect(events.start.count).toBe(1)
			expect(events.stop.count).toBe(1)
			expect(events.frame.calls.map(([line]) => line)).toEqual(['a', '✔ ok'])
			expect(vi.getTimerCount()).toBe(0)
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
			const errors = createErrorRecorder()
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
		afterEach(() => {
			vi.useRealTimers()
		})

		it('tick() after stop() still renders a frame but arms NO timer (manual advance only)', () => {
			vi.useFakeTimers()
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['a', 'b'], sink, styler: PLAIN })
			spinner.start()
			spinner.stop()
			expect(vi.getTimerCount()).toBe(0)
			const before = sink.calls.length
			spinner.tick() // a manual tick renders, but does not re-arm the interval
			expect(sink.calls.length).toBe(before + 1)
			expect(vi.getTimerCount()).toBe(0) // still no timer
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

		it('a second success() after stop writes another final line and arms no timer', () => {
			// success()/failure() are NOT idempotent: each commits a fresh final line (stop() inside is the
			// no-op part). Documents that calling success twice writes two lines (the timer stays cleared).
			vi.useFakeTimers()
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['*'], sink, styler: PLAIN })
			spinner.start()
			spinner.success('one')
			const afterFirst = sink.calls.length
			spinner.success('two')
			expect(sink.calls.length).toBe(afterFirst + 1)
			expect(sink.calls.at(-1)).toEqual(['\r✔ two\n', undefined])
			expect(vi.getTimerCount()).toBe(0)
		})

		it('failure() after success() commits a failureure line to the error stream (no timer leak)', () => {
			vi.useFakeTimers()
			const sink = createRecordingSink()
			const spinner = new Spinner({ frames: ['*'], sink, styler: PLAIN })
			spinner.start()
			spinner.success('ok')
			spinner.failure('then broke')
			expect(sink.calls.at(-1)).toEqual(['\r✖ then broke\n', 'error'])
			expect(vi.getTimerCount()).toBe(0)
		})
	})

	describe('destroy', () => {
		afterEach(() => {
			vi.useRealTimers()
		})

		it('stops the timer (clearing it) and destroys the emitter', () => {
			vi.useFakeTimers()
			const spinner = new Spinner({ frames: ['a'], sink: createRecordingSink(), styler: PLAIN })
			spinner.start()
			spinner.destroy()
			expect(spinner.active).toBe(false)
			expect(spinner.emitter.destroyed).toBe(true)
			expect(vi.getTimerCount()).toBe(0) // leak guard — destroy never leaves a timer armed
		})

		it('is idempotent — a second destroy() does not throw and leaves no timer', () => {
			vi.useFakeTimers()
			const spinner = new Spinner({ frames: ['a'], sink: createRecordingSink(), styler: PLAIN })
			spinner.start()
			spinner.destroy()
			expect(() => spinner.destroy()).not.toThrow()
			expect(spinner.active).toBe(false)
			expect(vi.getTimerCount()).toBe(0)
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

	describe('factory parity', () => {
		it('createSpinner yields a working spinner', () => {
			const sink = createRecordingSink()
			const spinner = createSpinner({ message: 'via factory', frames: ['*'], sink, styler: PLAIN })
			spinner.tick()
			expect(frames(sink)).toEqual(['* via factory'])
		})
	})
})
