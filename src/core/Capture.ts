import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	CaptureEventMap,
	CaptureInterface,
	CaptureLevel,
	CaptureOptions,
	CapturedMessage,
	SinkInterface,
	ConsoleMethod,
} from './types.js'
import { Emitter } from '@orkestrel/emitter'
import { CAPTURE_LEVEL_MAP, DEFAULT_CAPTURE_LEVELS, DEFAULT_CAPTURE_LIMIT } from './constants.js'
import { formatArgs } from './helpers.js'

/**
 * An observable console interceptor (AGENTS §13) — it takes control of the global `console.*` on
 * the READ side. While `active`, every configured `console.x` call is captured as a frozen
 * {@link CapturedMessage}, buffered (total + by level, bounded), emitted on `capture`, and — per
 * options — mirrored to the real console and/or forwarded to a {@link SinkInterface}.
 *
 * @remarks
 * - **Snapshot-at-start (the no-capture-loop principle).** `start()` snapshots the CURRENT
 *   `console[level]` for each configured {@link CaptureLevel}, then installs the wrappers. The
 *   mirror writes through that snapshot — so our OWN console sink output (the Logger / Reporter,
 *   which snapshot the real `console` at creation) is never recaptured: `Capture` catches
 *   THIRD-PARTY `console.*`, not our writes. Create your loggers BEFORE installing a capture.
 * - **Idempotent + PROCESS-GLOBAL + NON-REENTRANT.** `start()` while already `active` is a no-op
 *   (never double-patches); `stop()` while inactive is a no-op. It patches the ONE global
 *   `console`, so at most ONE capture may be active at a time — running two concurrently
 *   interleaves their buffers and clobbers each other's restore.
 * - **Bounded buffers.** The total buffer and each by-level bucket are each capped at `limit`
 *   (oldest dropped first), never unbounded — the same retention precedent as {@link Logger}.
 * - **Lifecycle (§10).** `start` / `stop` toggle interception (emitting `start` / `stop`);
 *   `destroy()` stops (restoring `console`) then destroys the emitter.
 *
 * @example
 * ```ts
 * const capture = new Capture({ levels: ['warn', 'error'], mirror: true })
 * capture.start()
 * console.warn('third-party noise') // captured AND mirrored to the real console
 * capture.byLevel('warn') // [{ level: 'warn', text: 'third-party noise', time: … }]
 * capture.stop() // console.warn restored
 * ```
 */
export class Capture implements CaptureInterface {
	// The PUSH observation surface (§13) — owned, never inherited. The emitter isolates a listener
	// throw (routing it to the `error` handler), so a buggy `capture` listener can never escape into
	// the underlying program's `console.*` call.
	readonly #emitter: Emitter<CaptureEventMap>
	readonly #levels: readonly CaptureLevel[]
	readonly #mirror: boolean
	readonly #sink: SinkInterface | undefined
	readonly #limit: number
	// The bounded total buffer — every captured message, oldest first, capped at #limit.
	readonly #messages: CapturedMessage[] = []
	// The bounded per-level buckets — one capped buffer per configured CaptureLevel.
	readonly #buckets = new Map<CaptureLevel, CapturedMessage[]>()
	// The snapshot-original console methods, captured at start() and restored at stop(); empty
	// while inactive. The presence of an entry is what `active` reads.
	readonly #originals = new Map<CaptureLevel, ConsoleMethod>()
	#active = false

	constructor(options?: CaptureOptions) {
		this.#emitter = new Emitter<CaptureEventMap>({ on: options?.on, error: options?.error })
		this.#levels = options?.levels ?? DEFAULT_CAPTURE_LEVELS
		this.#mirror = options?.mirror ?? false
		this.#sink = options?.sink
		this.#limit = options?.limit ?? DEFAULT_CAPTURE_LIMIT
		for (const level of this.#levels) this.#buckets.set(level, [])
	}

	get emitter(): EmitterInterface<CaptureEventMap> {
		return this.#emitter
	}

	get active(): boolean {
		return this.#active
	}

	start(): void {
		// Idempotent — never double-patch an already-active capture (that would snapshot the
		// wrappers as the "originals" and break restore).
		if (this.#active) return
		this.#active = true
		const target: Record<CaptureLevel, ConsoleMethod> = console
		for (const level of this.#levels) {
			// Snapshot the CURRENT method reference BEFORE replacing it — stop() restores EXACTLY this
			// reference, leaving `console` pristine (the wrapper is never snapshotted as the original).
			const original = target[level]
			this.#originals.set(level, original)
			// The mirror target is the snapshot original BOUND to `console`, computed once here — so a
			// mirrored call reaches the real method with its proper receiver, through the snapshot and
			// never the live (patched) `console` (no capture loop). The restore reference stays the
			// pristine unbound `original` above; only the mirror uses the bound form.
			const mirror = original.bind(console)
			target[level] = (...args: unknown[]): void => this.#intercept(level, args, mirror)
		}
		this.#emitter.emit('start')
	}

	stop(): void {
		// Safe when not active — nothing to restore.
		if (!this.#active) return
		this.#active = false
		const target: Record<CaptureLevel, ConsoleMethod> = console
		for (const [level, original] of this.#originals) target[level] = original
		this.#originals.clear()
		this.#emitter.emit('stop')
	}

	messages(): readonly CapturedMessage[] {
		return [...this.#messages]
	}

	byLevel(level: CaptureLevel): readonly CapturedMessage[] {
		return [...(this.#buckets.get(level) ?? [])]
	}

	clear(): void {
		this.#messages.length = 0
		for (const bucket of this.#buckets.values()) bucket.length = 0
	}

	destroy(): void {
		this.stop()
		this.#emitter.destroy()
	}

	// The wrapper body behind every patched `console.x`: build the frozen message, buffer it
	// (total + by level, bounded), emit `capture`, then — per options — mirror to the real console
	// and forward to the sink. `mirror` is the snapshot original bound to `console` (computed at
	// start()); the program's own call is replayed through it (with its proper receiver) only when
	// the `mirror` option is set.
	#intercept(level: CaptureLevel, args: unknown[], mirror: ConsoleMethod): void {
		const message = this.#capture(level, args)
		this.#retain(message)
		this.#emitter.emit('capture', message)
		if (this.#mirror) mirror(...args)
		if (this.#sink !== undefined) this.#sink.write(message.text, CAPTURE_LEVEL_MAP[level])
	}

	// Build the immutable, serializable captured message — args stringified to one line (total,
	// never throws — see formatArgs), stamped with the capture instant. Frozen so a consumer (or
	// the `capture` listener) can never mutate it after the fact.
	#capture(level: CaptureLevel, args: readonly unknown[]): CapturedMessage {
		return Object.freeze({ level, text: formatArgs(args), time: Date.now() })
	}

	// Push onto the total buffer and the level's bucket, evicting the oldest of each when at
	// capacity — both stay capped at #limit, never growing without bound.
	#retain(message: CapturedMessage): void {
		this.#push(this.#messages, message)
		const bucket = this.#buckets.get(message.level)
		if (bucket !== undefined) this.#push(bucket, message)
	}

	// Bounded push — append, then drop the oldest while over the cap.
	#push(buffer: CapturedMessage[], message: CapturedMessage): void {
		buffer.push(message)
		if (buffer.length > this.#limit) buffer.shift()
	}
}
