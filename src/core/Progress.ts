import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	ProgressEventMap,
	ProgressInterface,
	ProgressOptions,
	SinkInterface,
	StylerInterface,
} from './types.js'
import { Emitter } from '@orkestrel/emitter'
import { DEFAULT_BAR_WIDTH } from './constants.js'
import { createConsoleSink, createStyler } from './factories.js'
import { renderBar } from './helpers.js'

/**
 * An update-driven, observable progress bar (AGENTS §13) — {@link update} recomputes the bar via
 * {@link renderBar}, writes `\r` + bar to its {@link SinkInterface}, and emits the `{ current, total }`
 * on `update`. The leading `\r` is what an overwrite-capable sink (the C-g TTY sink) redraws on; a
 * plain sink (C-f) degrades to a fresh, non-overwriting line — the line-OVERWRITE is the SINK's job.
 * UNIVERSAL — the one {@link StylerInterface} + the one {@link SinkInterface}, no `node:*`, no
 * `process.stdout`. NO self-timer (unlike {@link import('./Spinner.js').Spinner}) — the caller drives it.
 *
 * @remarks
 * - **Update-driven.** Each {@link update} clamps `current` to `[0, total]`, renders the bar (filled
 *   to `current / total`, with the trailing `percent (current/total)` + message) via {@link renderBar},
 *   emits `update`, and writes `'\r' + bar`. Progress advances only when the caller reports it.
 * - **Outcome lines.** {@link complete} renders a FULL bar (`current = total`) + message, terminated by
 *   a newline, emits a final `update` then `complete`, and marks `completed`. {@link failure} renders the
 *   bar at its CURRENT fill + message + newline and routes to the sink's error stream (no `complete` —
 *   the work did not finish). Both are terminal: a later {@link update} is ignored once `active` is false.
 * - **Bounded.** `current` is always clamped to `[0, total]`; {@link completed} reports whether
 *   {@link complete} has run; {@link active} is `true` until a {@link complete} / {@link failure}.
 * - **Lifecycle (§10).** {@link destroy} destroys the emitter (there is no timer to clear).
 *
 * @example
 * ```ts
 * const progress = new Progress({ total: 100, message: 'downloading' })
 * progress.update(40) // ████████████░░░░░░░░░░░░░░░░░░ 40% (40/100) downloading
 * progress.update(80, 'almost there')
 * progress.complete('done') // a full bar, committed with a newline
 * ```
 */
export class Progress implements ProgressInterface {
	// The PUSH observation surface (§13) — owned, never inherited. The emitter isolates a listener
	// throw (routing it to the `error` handler), so a buggy `update` listener can never escape a report.
	readonly #emitter: Emitter<ProgressEventMap>
	readonly #total: number
	readonly #width: number
	readonly #sink: SinkInterface
	readonly #styler: StylerInterface
	#message: string
	#current = 0
	#active = true
	#completed = false

	constructor(options: ProgressOptions) {
		this.#emitter = new Emitter<ProgressEventMap>({ on: options.on, error: options.error })
		this.#total = options.total
		this.#width = options.width ?? DEFAULT_BAR_WIDTH
		this.#sink = options.sink ?? createConsoleSink()
		this.#styler = options.styler ?? createStyler()
		this.#message = options.message ?? ''
	}

	get emitter(): EmitterInterface<ProgressEventMap> {
		return this.#emitter
	}

	get active(): boolean {
		return this.#active
	}

	get completed(): boolean {
		return this.#completed
	}

	get current(): number {
		return this.#current
	}

	get total(): number {
		return this.#total
	}

	update(current: number, message?: string): void {
		// Terminal bars ignore further updates — a complete()/failure() has committed the final line.
		if (!this.#active) return
		this.#advance(current, message)
		this.#paint(false)
	}

	complete(message?: string): void {
		if (!this.#active) return
		// Finish FULL — drive to `total`, commit the line, then signal completion.
		this.#advance(this.#total, message)
		this.#active = false
		this.#completed = true
		this.#paint(true)
		this.#emitter.emit('complete')
	}

	failure(message?: string): void {
		if (!this.#active) return
		// Finish at the CURRENT fill (the work stopped short) — commit to the error stream, NO complete.
		// #advance emits a final `update` at the current fill (identical current/total), same as complete().
		this.#advance(this.#current, message)
		this.#active = false
		this.#paint(true, 'error')
	}

	destroy(): void {
		this.#emitter.destroy()
	}

	// Clamp `current` into [0, total], adopt the optional message, and emit the `update` progress —
	// the shared state-advance behind update()/complete() (AGENTS §5). The clamp keeps `current`
	// bounded regardless of the value the caller reports (an overrun saturates, a negative floors).
	#advance(current: number, message?: string): void {
		this.#current = Math.max(0, Math.min(this.#total, current))
		if (message !== undefined) this.#message = message
		this.#emitter.emit('update', { current: this.#current, total: this.#total })
	}

	// Render the bar at the current state and write `\r` + bar to the sink — the leading `\r` an
	// overwrite-capable sink redraws on. `final` appends a newline that commits the line (a finished
	// bar is not overwritten); `level` routes a failure() write to the error stream. The single render
	// path shared by update()/complete()/failure().
	#paint(final: boolean, level?: 'error'): void {
		const bar = renderBar({
			current: this.#current,
			total: this.#total,
			width: this.#width,
			styler: this.#styler.cyan,
		})
		const line = this.#message === '' ? bar : `${bar} ${this.#message}`
		this.#sink.write(`\r${line}${final ? '\n' : ''}`, level)
	}
}
