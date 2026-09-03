import type { ProgressEventMap } from '@src/core'
import { createStyler, createTheme, DEFAULT_THEME, Progress, strip } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createRecorder, createRecorders } from '@orkestrel/test'
import { createRecordingSink, normalizeVisible } from '../../setup.js'

// Progress — the update-driven, observable progress bar. update(current) recomputes the bar
// through renderBar, writes `\r` + bar to its sink, and emits { current, total } on `update`;
// succeed/fail commit a final line. NO self-timer (the caller drives it) — so these tests need no
// fake clock. UNIVERSAL (the one styler + the one sink — no node:*). A disabled styler is used for
// content assertions so the bar reads plainly; one case uses an enabled styler and asserts by
// stripping ANSI.

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
			const events = createRecorders<ProgressEventMap, 'update'>(progress.emitter, ['update'])

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
			const events = createRecorders<ProgressEventMap, 'update'>(progress.emitter, ['update'])
			progress.update(999)
			expect(events.update.calls).toEqual([[{ current: 10, total: 10 }]])
		})
	})

	describe('getters', () => {
		it('exposes total, current, active, succeeded', () => {
			const progress = new Progress({ total: 100, sink: createRecordingSink(), styler: PLAIN })
			expect(progress.total).toBe(100)
			expect(progress.current).toBe(0)
			expect(progress.active).toBe(true)
			expect(progress.succeeded).toBe(false)
			progress.update(40)
			expect(progress.current).toBe(40)
		})
	})

	describe('succeed — finish FULL, commit, signal the successful outcome', () => {
		it('renders a full bar + newline, emits a final update then succeed, marks succeeded', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			const events = createRecorders<ProgressEventMap, 'update' | 'succeed'>(progress.emitter, [
				'update',
				'succeed',
			])

			progress.update(3)
			progress.succeed('done')

			expect(progress.succeeded).toBe(true)
			expect(progress.active).toBe(false)
			expect(progress.current).toBe(10) // driven to total
			// The final write is a FULL bar + message, committed with a trailing newline.
			expect(sink.calls.at(-1)).toEqual(['\r██████████ 100% (10/10) done\n', undefined])
			// update fired for the 3 AND the final 10; succeed fired once, after the final update.
			expect(events.update.calls).toEqual([
				[{ current: 3, total: 10 }],
				[{ current: 10, total: 10 }],
			])
			expect(events.succeed.count).toBe(1)
		})

		it('succeed() with no argument keeps the current message', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 4, width: 4, message: 'kept', sink, styler: PLAIN })
			progress.succeed()
			expect(sink.calls.at(-1)).toEqual(['\r████ 100% (4/4) kept\n', undefined])
		})
	})

	describe('fail — finish at current fill, error stream, NO succeed', () => {
		it('renders the bar at its current fill + newline to the error stream, no succeed event', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			const events = createRecorders<ProgressEventMap, 'update' | 'succeed'>(progress.emitter, [
				'update',
				'succeed',
			])

			progress.update(4)
			progress.fail('broke')

			expect(progress.active).toBe(false)
			expect(progress.succeeded).toBe(false) // fail is NOT a successful finish
			expect(progress.current).toBe(4) // stays at the current fill, not driven to total
			// Final write: the CURRENT-fill bar + message + newline, on the error stream.
			expect(sink.calls.at(-1)).toEqual(['\r████░░░░░░ 40% (4/10) broke\n', 'error'])
			expect(events.succeed.count).toBe(0) // the work did not finish
		})

		it('emits exactly one terminal `update` at the current fill (no `succeed`)', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			const events = createRecorders<ProgressEventMap, 'update' | 'succeed'>(progress.emitter, [
				'update',
				'succeed',
			])
			progress.update(3) // one update event
			progress.fail('stopped') // one MORE terminal update event, still no succeed
			expect(events.update.count).toBe(2)
			expect(events.update.calls.at(-1)?.[0]).toEqual({ current: 3, total: 10 })
			expect(events.succeed.count).toBe(0)
		})
	})

	describe('terminal — later updates are ignored', () => {
		it('ignores update after succeed', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			progress.succeed('done')
			const after = sink.calls.length
			progress.update(5) // ignored — already terminal
			expect(sink.calls.length).toBe(after)
			expect(progress.current).toBe(10)
		})

		it('ignores update and a second succeed/fail after fail', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			progress.update(2)
			progress.fail('x')
			const after = sink.calls.length
			progress.update(9)
			progress.succeed('late')
			progress.fail('late')
			expect(sink.calls.length).toBe(after) // nothing more written
			expect(progress.succeeded).toBe(false)
		})
	})

	describe('styling', () => {
		it('colors the filled run through the styler (asserted by stripping ANSI)', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: createStyler() })
			progress.update(5)
			const [text] = sink.calls[0] ?? ['']
			expect(strip(text)).not.toBe(text) // cyan escapes present on the filled run
			// Strip ANSI through the framework helper; remove the leading \r.
			expect(normalizeVisible(text)).toBe('█████░░░░░ 50% (5/10)')
		})

		it('uses custom fill and empty glyphs and the theme accent only on the filled run', () => {
			const sink = createRecordingSink()
			const progress = new Progress({
				total: 4,
				width: 8,
				fill: '=',
				empty: '-',
				sink,
				styler: createStyler(),
				theme: createTheme({ accent: createStyler().brightMagenta.bold.style }),
			})
			progress.update(2)
			expect(sink.calls[0]?.[0]).toBe('\r\x1b[1;95m====\x1b[0m---- 50% (2/4)')
		})

		it('pins the exact default-theme bytes for an update frame', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 4, width: 4, message: 'work', sink })
			progress.update(2)
			expect(sink.calls).toEqual([['\r\x1b[36m██\x1b[0m░░ 50% (2/4) work', undefined]])
		})

		it('pins the exact default-theme bytes for a succeed line', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 4, width: 4, sink })
			progress.succeed('done')
			expect(sink.calls).toEqual([['\r\x1b[36m████\x1b[0m 100% (4/4) done\n', undefined]])
		})

		it('keeps update, success, and fail-line bytes identical with the explicit default theme', () => {
			const implicitSink = createRecordingSink()
			const explicitSink = createRecordingSink()
			const implicit = new Progress({ total: 4, message: 'work', sink: implicitSink })
			const explicit = new Progress({
				total: 4,
				message: 'work',
				sink: explicitSink,
				theme: DEFAULT_THEME,
			})
			implicit.update(2)
			explicit.update(2)
			implicit.succeed('done')
			explicit.succeed('done')
			const implicitFailure = new Progress({ total: 4, sink: implicitSink })
			const explicitFailure = new Progress({ total: 4, sink: explicitSink, theme: DEFAULT_THEME })
			implicitFailure.update(1)
			explicitFailure.update(1)
			implicitFailure.fail('failed')
			explicitFailure.fail('failed')
			expect(implicitSink.calls).toEqual(explicitSink.calls)
		})
	})

	describe('the update / succeed events — the observation seam', () => {
		it('initial on-hooks subscribe at construction', () => {
			const seen: Array<{ current: number; total: number }> = []
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
			const errors = createRecorder<readonly [error: unknown, event: string]>()
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
			// renderBar treats total <= 0 as already full: a full track at 100%.
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

	describe('succeed / fail idempotency (terminal is sticky)', () => {
		it('a second succeed() after succeed() is ignored — no extra write, no extra event', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			const events = createRecorders<ProgressEventMap, 'succeed'>(progress.emitter, ['succeed'])
			progress.succeed('done')
			const after = sink.calls.length
			progress.succeed('again') // ignored — already terminal
			expect(sink.calls.length).toBe(after)
			expect(events.succeed.count).toBe(1)
		})

		it('succeed() after fail() is ignored (fail already made it terminal)', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			const events = createRecorders<ProgressEventMap, 'succeed'>(progress.emitter, ['succeed'])
			progress.fail('broke')
			const after = sink.calls.length
			progress.succeed('late')
			expect(sink.calls.length).toBe(after)
			expect(events.succeed.count).toBe(0) // fail never succeeds
			expect(progress.succeeded).toBe(false)
		})

		it('fail() after succeed() is ignored (succeed already made it terminal)', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			progress.succeed('done')
			const after = sink.calls.length
			progress.fail('too late')
			expect(sink.calls.length).toBe(after)
			expect(progress.succeeded).toBe(true) // still succeeded; fail did nothing
		})
	})

	describe('update at the exact boundary', () => {
		it('update(total) fills the bar to 100% without marking succeeded', () => {
			const sink = createRecordingSink()
			const progress = new Progress({ total: 10, width: 10, sink, styler: PLAIN })
			progress.update(10)
			expect(progress.current).toBe(10)
			expect(progress.succeeded).toBe(false) // update(total) is not succeed()
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
})
