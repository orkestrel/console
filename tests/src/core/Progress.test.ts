import { createProgress, createStyler, Progress, strip } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createErrorRecorder, createRecordingSink, recordEmitterEvents } from '../../../setup.js'

// Progress — the update-driven, observable progress bar. update(current) recomputes the bar via
// renderBar, writes `\r` + bar to its sink, and emits { current, total } on `update`; complete/failure
// commit a final line. NO self-timer (the caller drives it) — so these tests need no fake clock.
// UNIVERSAL (the one styler + the one sink — no node:*). A disabled styler is used for content
// assertions so the bar reads plainly; one case uses an enabled styler and asserts via strip().

// The bar lines a recording sink received, with the leading `\r` (and any trailing `\n`) stripped.
function bars(sink: ReturnType<typeof createRecordingSink>): readonly string[] {
	return sink.calls.map(([text]) => text.replace(/^\r/, '').replace(/\n$/, ''))
}

const PLAIN = createStyler({ enabled: false })

describe('Progress', () => {
	describe('update — recompute + the leading \\r (redraw deferred to the sink)', () => {
		it('writes `\\r` + the rendered bar and emits the { current, total }', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			const events = recordEmitterEvents(progress.emitter, ['update'])

			progress.update(5)

			// The sink write carries the leading \r the TTY sink overwrites on; no trailing newline
			// mid-progress (the line is still live).
			expect(sink.calls).toEqual([['\r█████░░░░░ 50% (5/10)', undefined]])
			expect(events.update.calls).toEqual([[{ current: 5, total: 10 }]])
		})

		it('appends the message after the bar', () => {
			const sink = createRecordingSink()
			const progress = new Progress({
				total: 10,
				width: 10,
				message: 'downloading',
				sink,
				styler: PLAIN,
			})
			progress.update(3)
			expect(bars(sink)).toEqual(['███░░░░░░░ 30% (3/10) downloading'])
		})

		it('an update message overrides the initial message for subsequent renders', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, message: 'a', sink, styler: PLAIN })
			progress.update(2, 'b')
			progress.update(4) // keeps 'b'
			expect(bars(sink)).toEqual(['██░░░░░░░░ 20% (2/10) b', '████░░░░░░ 40% (4/10) b'])
		})

		it('tracks several updates in order', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 4, width: 4, sink, styler: PLAIN })
			progress.update(1)
			progress.update(2)
			progress.update(3)
			expect(bars(sink)).toEqual(['█░░░ 25% (1/4)', '██░░ 50% (2/4)', '███░ 75% (3/4)'])
		})
	})

	describe('clamping — current bounded to [0, total]', () => {
		it('clamps an overrun to total', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 5, sink, styler: PLAIN })
			progress.update(50)
			expect(progress.current).toBe(10)
			expect(bars(sink)).toEqual(['█████ 100% (10/10)'])
		})

		it('clamps a negative to zero', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 5, sink, styler: PLAIN })
			progress.update(-3)
			expect(progress.current).toBe(0)
			expect(bars(sink)).toEqual(['░░░░░ 0% (0/10)'])
		})

		it('the emitted progress carries the CLAMPED current', () => {
			const progress = new Progress({ total: 10, sink: createRecordingSink(), styler: PLAIN })
			const events = recordEmitterEvents(progress.emitter, ['update'])
			progress.update(999)
			expect(events.update.calls).toEqual([[{ current: 10, total: 10 }]])
		})
	})

	describe('getters', () => {
		it('exposes total, current, active, completed', () => {
			const progress = new Progress({ total: 100, sink: createRecordingSink(), styler: PLAIN })
			expect(progress.total).toBe(100)
			expect(progress.current).toBe(0)
			expect(progress.active).toBe(true)
			expect(progress.completed).toBe(false)
			progress.update(40)
			expect(progress.current).toBe(40)
		})
	})

	describe('complete — finish FULL, commit, signal completion', () => {
		it('renders a full bar + newline, emits a final update then complete, marks completed', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			const events = recordEmitterEvents(progress.emitter, ['update', 'complete'])

			progress.update(3)
			progress.complete('done')

			expect(progress.completed).toBe(true)
			expect(progress.active).toBe(false)
			expect(progress.current).toBe(10) // driven to total
			// The final write is a FULL bar + message, committed with a trailing newline.
			expect(sink.calls.at(-1)).toEqual(['\r██████████ 100% (10/10) done\n', undefined])
			// update fired for the 3 AND the final 10; complete fired once, after the final update.
			expect(events.update.calls).toEqual([
				[{ current: 3, total: 10 }],
				[{ current: 10, total: 10 }],
			])
			expect(events.complete.count).toBe(1)
		})

		it('complete() with no argument keeps the current message', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 4, width: 4, message: 'kept', sink, styler: PLAIN })
			progress.complete()
			expect(sink.calls.at(-1)).toEqual(['\r████ 100% (4/4) kept\n', undefined])
		})
	})

	describe('failure — finish at current fill, error stream, NO complete', () => {
		it('renders the bar at its current fill + newline to the error stream, no complete event', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			const events = recordEmitterEvents(progress.emitter, ['update', 'complete'])

			progress.update(4)
			progress.failure('broke')

			expect(progress.active).toBe(false)
			expect(progress.completed).toBe(false) // failure is NOT completion
			expect(progress.current).toBe(4) // stays at the current fill, not driven to total
			// Final write: the CURRENT-fill bar + message + newline, on the error stream.
			expect(sink.calls.at(-1)).toEqual(['\r████░░░░░░ 40% (4/10) broke\n', 'error'])
			expect(events.complete.count).toBe(0) // the work did not finish
		})
	})

	describe('terminal — later updates are ignored', () => {
		it('ignores update after complete', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			progress.complete('done')
			const after = sink.calls.length
			progress.update(5) // ignored — already terminal
			expect(sink.calls.length).toBe(after)
			expect(progress.current).toBe(10)
		})

		it('ignores update and a second complete/failure after failure', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			progress.update(2)
			progress.failure('x')
			const after = sink.calls.length
			progress.update(9)
			progress.complete('late')
			progress.failure('late')
			expect(sink.calls.length).toBe(after) // nothing more written
			expect(progress.completed).toBe(false)
		})
	})

	describe('styling', () => {
		it('colors the filled run through the styler (asserted via strip)', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: createStyler() })
			progress.update(5)
			const [text] = sink.calls[0] ?? ['']
			expect(strip(text)).not.toBe(text) // cyan escapes present on the filled run
			// Strip ANSI via the framework helper; remove the leading \r.
			expect(strip(text).replace(/^\r/, '')).toBe('█████░░░░░ 50% (5/10)')
		})
	})

	describe('the update / complete events — the observation seam (§13)', () => {
		it('initial on-hooks subscribe at construction', () => {
			const seen: { current: number; total: number }[] = []
			const progress = new Progress({
				total: 10,
				sink: createRecordingSink(),
				styler: PLAIN,
				on: { update: (p) => seen.push({ current: p.current, total: p.total }) },
			})
			progress.update(5)
			expect(seen).toEqual([{ current: 5, total: 10 }])
		})

		it('a throwing update listener is isolated and routed to the error handler', () => {
			const errors = createErrorRecorder()
			const progress = new Progress({
				total: 10,
				sink: createRecordingSink(),
				styler: PLAIN,
				error: errors.handler,
			})
			progress.emitter.on('update', () => {
				throw new Error('bad listener')
			})
			expect(() => progress.update(1)).not.toThrow()
			expect(errors.count).toBe(1)
			expect(errors.calls[0]?.[1]).toBe('update')
		})
	})

	describe('degenerate total — bounds at total <= 0', () => {
		it('a total of 0 renders a FULL bar on update (nothing to fill toward)', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 0, width: 4, sink, styler: PLAIN })
			progress.update(0)
			// renderBar treats total <= 0 as already complete: a full track at 100%.
			expect(bars(sink)).toEqual(['████ 100% (0/0)'])
		})

		it('a total of 0 clamps current to 0 (min(0, current)) and stays full', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 0, width: 4, sink, styler: PLAIN })
			progress.update(5) // clamped to [0, 0] ⇒ 0
			expect(progress.current).toBe(0)
			expect(bars(sink)).toEqual(['████ 100% (0/0)'])
		})

		it('a negative total renders a full bar and the literal total in the count', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: -1, width: 4, sink, styler: PLAIN })
			progress.update(0)
			expect(bars(sink)).toEqual(['████ 100% (0/-1)'])
		})
	})

	describe('complete / failure idempotency (terminal is sticky)', () => {
		it('a second complete() after complete() is ignored — no extra write, no extra event', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			const events = recordEmitterEvents(progress.emitter, ['complete'])
			progress.complete('done')
			const after = sink.calls.length
			progress.complete('again') // ignored — already terminal
			expect(sink.calls.length).toBe(after)
			expect(events.complete.count).toBe(1)
		})

		it('complete() after failure() is ignored (failure already made it terminal)', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			const events = recordEmitterEvents(progress.emitter, ['complete'])
			progress.failure('broke')
			const after = sink.calls.length
			progress.complete('late')
			expect(sink.calls.length).toBe(after)
			expect(events.complete.count).toBe(0) // failure never completes
			expect(progress.completed).toBe(false)
		})

		it('failure() after complete() is ignored (complete already made it terminal)', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			progress.complete('done')
			const after = sink.calls.length
			progress.failure('too late')
			expect(sink.calls.length).toBe(after)
			expect(progress.completed).toBe(true) // still completed; failure did nothing
		})
	})

	describe('update at the exact boundary', () => {
		it('update(total) fills the bar to 100% without marking completed', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			progress.update(10)
			expect(progress.current).toBe(10)
			expect(progress.completed).toBe(false) // update(total) is not complete()
			expect(progress.active).toBe(true)
			expect(bars(sink)).toEqual(['██████████ 100% (10/10)'])
		})

		it('update(0) renders an empty bar at 0%', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			progress.update(0)
			expect(bars(sink)).toEqual(['░░░░░░░░░░ 0% (0/10)'])
		})
	})

	describe('destroy', () => {
		it('destroys the emitter', () => {
			const progress = new Progress({ total: 10, sink: createRecordingSink(), styler: PLAIN })
			progress.destroy()
			expect(progress.emitter.destroyed).toBe(true)
		})

		it('is idempotent — a second destroy() does not throw', () => {
			const progress = new Progress({ total: 10, sink: createRecordingSink(), styler: PLAIN })
			progress.destroy()
			expect(() => progress.destroy()).not.toThrow()
			expect(progress.emitter.destroyed).toBe(true)
		})

		it('update after destroy still advances (destroy tears down only the emitter, not the bar)', () => {
			// destroy() destroys the emitter but leaves `active` true — an update still clamps + writes
			// (the emit is safe on a destroyed emitter). Documents the post-destroy shape.
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			progress.destroy()
			expect(() => progress.update(5)).not.toThrow()
			expect(progress.current).toBe(5)
			expect(bars(sink)).toEqual(['█████░░░░░ 50% (5/10)'])
		})
	})

	describe('factory parity', () => {
		it('createProgress yields a working bar', () => {
			const sink = createRecordingSink()
			const progress = createProgress({ total: 4, width: 4, sink, styler: PLAIN })
			progress.update(2)
			expect(bars(sink)).toEqual(['██░░ 50% (2/4)'])
		})
	})
})
