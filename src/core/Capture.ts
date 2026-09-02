import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	CaptureEventMap,
	CaptureInterface,
	CaptureLevel,
	CaptureOptions,
	CapturedMessage,
	RetentionInterface,
	SinkInterface,
	ConsoleMethod,
} from './types.js'
import { Emitter } from '@orkestrel/emitter'
import { CAPTURE_LEVEL_MAP, CAPTURE_LEVELS, DEFAULT_CAPTURE_LIMIT } from './constants.js'
import { formatArgs } from './helpers.js'
import { Retention } from './Retention.js'

/**
 * An observable console interceptor — it takes control of the global `console.*` on
 * the read side. While `active`, every configured `console.x` call is captured as a frozen
 * {@link CapturedMessage}, buffered (total + by level, bounded), emitted on `capture`, and — per
 * options — mirrored to the real console and/or forwarded to a {@link SinkInterface}.
 *
 * @remarks
 * - **Snapshot-at-start (the no-capture-loop principle).** `start()` snapshots the current
 *   `console[level]` for each configured {@link CaptureLevel}, then installs the wrappers. The
 *   mirror writes through that snapshot — so our own console sink output (the Logger / Reporter,
 *   which snapshot the real `console` at creation) is never recaptured: `Capture` catches
 *   third-party `console.*`, not our writes. Create your loggers before installing a capture.
 * - **Idempotent + process-global + non-reentrant.** `start()` while already `active` is a no-op
 *   (never double-patches); `stop()` while inactive is a no-op. It patches the one global
 *   `console`, so at most one capture may be active at a time — running two concurrently
 *   interleaves their buffers and clobbers each other's restore.
 * - **Bounded buffers.** `messages()` / `messages(level)` — the total buffer and each by-level
 *   bucket are each capped at `limit`
 *   (oldest dropped first), never unbounded — the same retention precedent as {@link Logger}.
 * - **Lifecycle.** `start` / `stop` toggle interception (emitting `start` / `stop`);
 *   `destroy()` stops (restoring `console`) then destroys the emitter.
 *
 * @example
 * ```ts
 * const capture = new Capture({ levels: ['warn', 'error'], mirror: true })
 * capture.start()
 * console.warn('third-party noise') // captured and mirrored to the real console
 * capture.messages('warn') // [{ level: 'warn', text: 'third-party noise', time: … }]
 * capture.stop() // console.warn restored
 * ```
 */
export class Capture implements CaptureInterface {
	// The push observation surface — owned, never inherited. The emitter isolates a listener
	// throw (routing it to the `error` handler), so a buggy `capture` listener can never escape into
	// the underlying program's `console.*` call.
	readonly #emitter: Emitter<CaptureEventMap>
	readonly #levels: readonly CaptureLevel[]
	readonly #mirror: boolean
	readonly #sink: SinkInterface | undefined
	// The bounded buffers — the total one and one per configured CaptureLevel — owned by the shared
	// retention engine the server's ProcessCapture composes too.
	readonly #retention: RetentionInterface<CapturedMessage>
	// The snapshot-original console methods, captured at start() and restored at stop(); empty
	// while inactive.
	readonly #originals = new Map<CaptureLevel, ConsoleMethod>()
	// Stored rather than derived from #originals: an empty `levels` list patches no console method,
	// so a started capture configured with no level leaves #originals empty while still being active.
	#active = false

	constructor(options?: CaptureOptions) {
		this.#emitter = new Emitter<CaptureEventMap>({
			...(options?.on !== undefined ? { on: options.on } : {}),
			...(options?.error !== undefined ? { error: options.error } : {}),
		})
		this.#levels = options?.levels ?? CAPTURE_LEVELS
		this.#mirror = options?.mirror ?? false
		this.#sink = options?.sink
		this.#retention = new Retention<CapturedMessage>(
			this.#levels,
			options?.limit ?? DEFAULT_CAPTURE_LIMIT,
		)
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
			// Snapshot the current method reference before replacing it — stop() restores exactly this
			// reference, leaving `console` pristine (the wrapper is never snapshotted as the original).
			const original = target[level]
			this.#originals.set(level, original)
			// The mirror target is the snapshot original bound to `console`, computed once here — so a
			// mirrored call reaches the real method with its proper receiver, through the snapshot and
			// never the live (patched) `console` (no capture loop). The restore reference stays the
			// pristine unbound `original` above; only the mirror uses the bound form.
			const mirror = original.bind(console)
			target[level] = this.#captureCall.bind(this, level, mirror)
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

	messages(): readonly CapturedMessage[]
	messages(level: CaptureLevel): readonly CapturedMessage[]
	messages(level?: CaptureLevel): readonly CapturedMessage[] {
		if (level === undefined) return this.#retention.records()
		return this.#retention.records(level)
	}

	clear(): void {
		this.#retention.clear()
	}

	destroy(): void {
		this.stop()
		this.#emitter.destroy()
	}

	// Adapt the patched console's variadic call shape to the captured argument collection consumed
	// by #intercept. Binding level and mirror in start() leaves the exact ConsoleMethod signature.
	#captureCall(level: CaptureLevel, mirror: ConsoleMethod, ...args: unknown[]): void {
		this.#intercept(level, args, mirror)
	}

	// The wrapper body behind every patched `console.x`: build the frozen message, buffer it
	// (total + by level, bounded), emit `capture`, then — per options — mirror to the real console
	// and forward to the sink. `mirror` is the snapshot original bound to `console` (computed at
	// start()); the program's own call is replayed through it (with its proper receiver) only when
	// the `mirror` option is set.
	#intercept(level: CaptureLevel, args: unknown[], mirror: ConsoleMethod): void {
		const message = this.#capture(level, args)
		this.#retention.add(message)
		this.#emitter.emit('capture', message)
		if (this.#mirror) mirror(...args)
		// The wrapper never throws into the patched global — a misbehaving sink is best-effort
		// and swallowed, never allowed to break the underlying program's own console.* call.
		if (this.#sink !== undefined) {
			try {
				this.#sink.write(message.text, CAPTURE_LEVEL_MAP[level])
			} catch {
				// Swallowed — see comment above.
			}
		}
	}

	// Build the immutable, serializable captured message — args stringified to one line (total,
	// never throws — see formatArgs), stamped with the capture instant. Frozen so a consumer (or
	// the `capture` listener) can never mutate it after the fact.
	#capture(level: CaptureLevel, args: readonly unknown[]): CapturedMessage {
		return Object.freeze({ level, text: formatArgs(args), time: Date.now() })
	}
}
