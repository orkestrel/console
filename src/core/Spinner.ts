import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	SinkInterface,
	SpinnerEventMap,
	SpinnerInterface,
	SpinnerOptions,
	StylerInterface,
} from './types.js'
import { Emitter } from '@orkestrel/emitter'
import {
	DEFAULT_SPINNER_INTERVAL,
	SPINNER_FRAMES,
	STATUS_COLORS,
	STATUS_ICONS,
} from './constants.js'
import { createConsoleSink, createStyler } from './factories.js'

/**
 * A self-driving, observable activity spinner (AGENTS §13) — a glyph cycle that advances on a
 * periodic timer, writing each `\r` + frame line to its {@link SinkInterface} and emitting it on
 * `frame`. The leading `\r` is what an overwrite-capable sink (the C-g TTY sink) redraws on; a plain
 * sink (C-f) degrades to a fresh, non-overwriting line — the line-OVERWRITE is the SINK's job, never
 * the spinner's. UNIVERSAL — `setInterval` + the one {@link StylerInterface} + the one
 * {@link SinkInterface}, no `node:*`, no `process.stdout`.
 *
 * @remarks
 * - **Self-driving but deterministically testable.** `start()` arms a `setInterval` that calls
 *   {@link tick} each `interval`; each {@link tick} builds the styled `glyph + message` line for the
 *   current frame, emits it on `frame`, writes `'\r' + line` to the sink, then advances the frame
 *   index (wrapping). A test drives frames by calling {@link tick} directly (NO real clock) and proves
 *   the timer arms / clears with fake timers.
 * - **Leak-free timer.** The interval is ALWAYS cleared on {@link success} / {@link failure} /
 *   {@link stop} / {@link destroy} — `#handle` is the single source of `active`, set on arm and unset
 *   on clear, so a spinner never leaks a running interval.
 * - **Idempotent `start`.** A {@link start} while already `active` is a no-op (it never arms a second
 *   timer).
 * - **Outcome lines.** {@link success} / {@link failure} clear the timer then write + emit a FINAL line —
 *   the {@link STATUS_ICONS} `✔` / `✖` (colored via {@link STATUS_COLORS}) + the message — terminated
 *   by a newline (the activity is over; the line is committed, not overwritten). {@link failure} routes to
 *   the sink's error stream.
 * - **Lifecycle (§10).** {@link stop} clears the timer and LEAVES the current line; {@link destroy}
 *   stops then destroys the emitter. {@link update} swaps the message and re-renders immediately when
 *   `active`.
 *
 * @example
 * ```ts
 * const spinner = new Spinner({ message: 'building' })
 * spinner.start() // arms the timer, paints the first frame to the sink
 * spinner.update('bundling') // message changes, re-rendered at once
 * spinner.success('built in 1.2s') // ✔ built in 1.2s — timer cleared, line committed
 * ```
 */
export class Spinner implements SpinnerInterface {
	// The PUSH observation surface (§13) — owned, never inherited. The emitter isolates a listener
	// throw (routing it to the `error` handler), so a buggy `frame` listener can never escape the tick.
	readonly #emitter: Emitter<SpinnerEventMap>
	readonly #frames: readonly string[]
	readonly #interval: number
	readonly #sink: SinkInterface
	readonly #styler: StylerInterface
	#message: string
	// The running interval handle — undefined while inactive. Its presence IS `active`; the timer is
	// armed in start() and cleared everywhere the spinner stops, so it is never leaked.
	#handle: ReturnType<typeof setInterval> | undefined
	// The current frame index into #frames — advanced (wrapping) after each rendered tick.
	#index = 0

	constructor(options?: SpinnerOptions) {
		this.#emitter = new Emitter<SpinnerEventMap>({ on: options?.on, error: options?.error })
		// An explicitly-EMPTY `frames` array falls back to the default cycle too — an empty cycle
		// would divide by zero on every wrap in tick() (AGENTS §16 hardening).
		const frames = options?.frames ?? SPINNER_FRAMES
		this.#frames = frames.length === 0 ? SPINNER_FRAMES : frames
		this.#interval = options?.interval ?? DEFAULT_SPINNER_INTERVAL
		this.#sink = options?.sink ?? createConsoleSink()
		this.#styler = options?.styler ?? createStyler()
		this.#message = options?.message ?? ''
	}

	get emitter(): EmitterInterface<SpinnerEventMap> {
		return this.#emitter
	}

	get active(): boolean {
		return this.#handle !== undefined
	}

	get message(): string {
		return this.#message
	}

	start(): void {
		// Idempotent — never arm a second interval over a running one (that would leak the first handle).
		if (this.#handle !== undefined) return
		this.#handle = setInterval(() => this.tick(), this.#interval)
		this.#emitter.emit('start')
		// Paint the first frame immediately so the spinner shows at once, not only after one interval.
		this.tick()
	}

	tick(): void {
		// Render the CURRENT frame, then advance — so the first tick() shows frame 0.
		this.#paint(this.#line())
		this.#index = (this.#index + 1) % this.#frames.length
	}

	update(message: string): void {
		this.#message = message
		// Re-render the CURRENT frame (no advance) so the new message shows without waiting for a tick.
		if (this.#handle !== undefined) this.#paint(this.#line())
	}

	success(message?: string): void {
		this.#finish('success', message)
	}

	failure(message?: string): void {
		this.#finish('error', message)
	}

	stop(): void {
		// Clear the timer and leave the current line untouched — a no-op when not active.
		if (this.#handle === undefined) return
		clearInterval(this.#handle)
		this.#handle = undefined
		this.#emitter.emit('stop')
	}

	destroy(): void {
		this.stop()
		this.#emitter.destroy()
	}

	// Stop the timer (emitting `stop` when it was running) and write + emit the FINAL outcome line —
	// the status icon + message, colored through the styler, terminated by a newline (the activity is
	// over, so the line is committed, not overwritten). `error` routes to the sink's error stream. The
	// shared body of success()/failure() (AGENTS §5 — single home for the outcome path).
	#finish(level: 'success' | 'error', message?: string): void {
		this.stop()
		const text = message ?? this.#message
		if (message !== undefined) this.#message = message
		const color = this.#styler[STATUS_COLORS[level]]
		const line = `${color(STATUS_ICONS[level])} ${color(text)}`
		this.#emitter.emit('frame', line)
		// The trailing newline commits the line; `error` is the one outcome routed to the error stream.
		this.#sink.write(`\r${line}\n`, level === 'error' ? 'error' : undefined)
	}

	// Build the styled frame line for the CURRENT index — the colored spinner glyph, then the message
	// when present (a bare glyph otherwise). Kept off the public surface (a render fragment, AGENTS §5).
	#line(): string {
		const glyph = this.#styler.cyan(this.#frames[this.#index] ?? '')
		return this.#message === '' ? glyph : `${glyph} ${this.#message}`
	}

	// Emit the frame line and write it to the sink with the leading `\r` an overwrite-capable sink
	// redraws on — the SAME line both places, the `\r` added only on the write (the event carries the
	// bare line). The single per-tick render path shared by tick() and update().
	#paint(line: string): void {
		this.#emitter.emit('frame', line)
		this.#sink.write(`\r${line}`)
	}
}
