import type { EmitterInterface, SinkInterface } from '@src/core'
import type {
	CapturedChunk,
	ProcessCaptureEventMap,
	ProcessCaptureInterface,
	ProcessCaptureOptions,
	StreamLevel,
	StreamWrite,
	StreamWriteCallback,
} from './types.js'
import { Emitter } from '@src/core'
import { DEFAULT_CAPTURE_LEVELS, DEFAULT_CAPTURE_LIMIT, STREAM_LEVEL_MAP } from './constants.js'
import { decodeChunk } from './helpers.js'

/**
 * An observable interceptor of the RAW process output streams (AGENTS §13) — it takes control of
 * `process.stdout.write` / `process.stderr.write` on the WRITE side. While `active`, every write to
 * a configured {@link StreamLevel} is captured as a frozen {@link CapturedChunk}, buffered (total +
 * per-stream, bounded), emitted on `capture`, and — per options — mirrored to the real stream and/or
 * forwarded to a {@link SinkInterface}.
 *
 * @remarks
 * Where the core `Capture` patches `console.*` (the high-level read side), this patches the
 * low-level stream `write`, so it owns ALL server output: a direct `process.stdout.write`, a
 * third-party library's writes, a child-process pipe — not only `console.*`.
 *
 * - **Snapshot-at-start (the no-capture-loop principle).** `start()` snapshots the CURRENT
 *   `process[stream].write` for each configured level, then installs the wrappers. The mirror
 *   replays through that snapshot (bound to its stream) — so a server sink created from the same
 *   streams BEFORE the capture is never re-captured: this catches OTHER writers, not the mirror's
 *   own replay. Create your sinks before installing a capture.
 * - **Idempotent + PROCESS-GLOBAL + NON-REENTRANT.** `start()` while `active` is a no-op (never
 *   double-patches — that would snapshot the wrapper as the "original" and break restore); `stop()`
 *   while inactive is a no-op. It patches the ONE global `process`, so at most ONE process capture
 *   may be active at a time — two concurrently would interleave buffers and clobber each other's
 *   restore.
 * - **The wrapper NEVER throws and passes backpressure through.** A throw inside
 *   `process.stdout.write` would crash the host, so the wrapper decodes the chunk through the total
 *   {@link decodeChunk}, and returns the snapshot-original's `boolean` when mirroring (so a caller's
 *   `write` backpressure handling still works) or `true` when capture-only (the buffer never fills).
 * - **Bounded buffers.** The total buffer and each per-stream bucket are each capped at `limit`
 *   (oldest dropped first), never unbounded — the same retention precedent as the core `Capture`.
 * - **Lifecycle (§10).** `start` / `stop` toggle interception (emitting `start` / `stop`);
 *   `destroy()` stops (restoring the PRISTINE `write`) then destroys the emitter.
 *
 * @example
 * ```ts
 * const capture = new ProcessCapture({ levels: ['stderr'], mirror: true })
 * capture.start()
 * process.stderr.write('a library diagnostic\n') // captured AND still written to the terminal
 * capture.byLevel('stderr') // [{ level: 'stderr', text: 'a library diagnostic\n', time: … }]
 * capture.stop() // process.stderr.write restored
 * ```
 */
export class ProcessCapture implements ProcessCaptureInterface {
	// The PUSH observation surface (§13) — owned, never inherited. The emitter isolates a listener
	// throw (routing it to the `error` handler), so a buggy `capture` listener can never escape into
	// the host program's `process.*.write` call.
	readonly #emitter: Emitter<ProcessCaptureEventMap>
	readonly #levels: readonly StreamLevel[]
	readonly #mirror: boolean
	readonly #sink: SinkInterface | undefined
	readonly #limit: number
	// The bounded total buffer — every captured chunk, oldest first, capped at #limit.
	readonly #messages: CapturedChunk[] = []
	// The bounded per-stream buckets — one capped buffer per configured StreamLevel.
	readonly #buckets = new Map<StreamLevel, CapturedChunk[]>()
	// The snapshot-original `write` references, captured at start() and restored at stop(); empty
	// while inactive. The presence of an entry is what `active` reads.
	readonly #originals = new Map<StreamLevel, StreamWrite>()
	#active = false

	constructor(options?: ProcessCaptureOptions) {
		this.#emitter = new Emitter<ProcessCaptureEventMap>({ on: options?.on, error: options?.error })
		this.#levels = options?.levels ?? DEFAULT_CAPTURE_LEVELS
		this.#mirror = options?.mirror ?? false
		this.#sink = options?.sink
		this.#limit = options?.limit ?? DEFAULT_CAPTURE_LIMIT
		for (const level of this.#levels) this.#buckets.set(level, [])
	}

	get emitter(): EmitterInterface<ProcessCaptureEventMap> {
		return this.#emitter
	}

	get active(): boolean {
		return this.#active
	}

	start(): void {
		// Idempotent — never double-patch an already-active capture (that would snapshot the wrappers
		// as the "originals" and break restore).
		if (this.#active) return
		this.#active = true
		for (const level of this.#levels) {
			const stream = this.#stream(level)
			// Snapshot the CURRENT write reference BEFORE replacing it — stop() restores EXACTLY this
			// reference, leaving the stream pristine (the wrapper is never snapshotted as the original).
			const original = stream.write
			this.#originals.set(level, original)
			// The mirror target is the snapshot original BOUND to its stream, computed once here — so a
			// mirrored write reaches the real method with its proper receiver, through the snapshot and
			// never the live (patched) `write` (no capture loop). The restore reference stays the pristine
			// unbound `original` above; only the mirror uses the bound form.
			const mirror = original.bind(stream)
			// The replacement matches the Node `write` overload shape exactly — `(chunk, encoding?, cb?)`
			// where the 2nd arg is either a `BufferEncoding` or the completion callback — so it assigns to
			// the stream's `write` slot AND its args forward cleanly to `mirror` (no `as`, no untyped
			// spread).
			stream.write = (
				chunk: string | Uint8Array,
				encoding?: BufferEncoding | StreamWriteCallback,
				callback?: StreamWriteCallback,
			): boolean => this.#intercept(level, chunk, encoding, callback, mirror)
		}
		this.#emitter.emit('start')
	}

	stop(): void {
		// Safe when not active — nothing to restore.
		if (!this.#active) return
		this.#active = false
		for (const [level, original] of this.#originals) this.#stream(level).write = original
		this.#originals.clear()
		this.#emitter.emit('stop')
	}

	messages(): readonly CapturedChunk[] {
		return [...this.#messages]
	}

	byLevel(level: StreamLevel): readonly CapturedChunk[] {
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

	// The global WriteStream for a StreamLevel — `process[level]` indexes it directly, since a
	// StreamLevel IS the `process` property key (`'stdout'` / `'stderr'`); no `as`, no lookup map.
	#stream(level: StreamLevel): NodeJS.WriteStream {
		return process[level]
	}

	// The wrapper body behind every patched stream write: build the frozen chunk record, buffer it
	// (total + per-stream, bounded), emit `capture`, then — per options — forward to the sink and
	// mirror to the real stream. NEVER throws (decodeChunk is total; the emitter isolates listeners);
	// the program's own write is replayed through `mirror` (the bound snapshot original) only when the
	// `mirror` option is set, and the original's backpressure boolean is returned. Capture-only
	// returns `true` (output is swallowed into the buffer, so the kernel buffer never fills). The
	// chunk is decoded using `encoding` only (a callback in that slot is ignored for decode); the
	// `encoding` / `callback` tail is then forwarded to the mirror BRANCHED on whether the 2nd arg
	// is the callback or an encoding (the two Node overloads), so a caller's completion callback fires.
	#intercept(
		level: StreamLevel,
		chunk: string | Uint8Array,
		encoding: BufferEncoding | StreamWriteCallback | undefined,
		callback: StreamWriteCallback | undefined,
		mirror: StreamWrite,
	): boolean {
		const message = this.#capture(level, chunk, encoding)
		this.#retain(message)
		this.#emitter.emit('capture', message)
		if (this.#sink !== undefined) this.#sink.write(message.text, STREAM_LEVEL_MAP[level])
		if (!this.#mirror) return true
		// `write(chunk, cb)` when the 2nd arg is the callback; `write(chunk, encoding, cb)` otherwise —
		// matching the two Node overloads so the forward stays typed.
		if (typeof encoding === 'function') return mirror(chunk, encoding)
		return mirror(chunk, encoding, callback)
	}

	// Build the immutable, serializable captured chunk — the chunk decoded to text (total, never
	// throws — see decodeChunk; a callback in the encoding slot is ignored, falling back to utf-8),
	// stamped with the capture instant. Frozen so a consumer (or the `capture` listener) can never
	// mutate it after the fact.
	#capture(
		level: StreamLevel,
		chunk: string | Uint8Array,
		encoding: BufferEncoding | StreamWriteCallback | undefined,
	): CapturedChunk {
		return Object.freeze({ level, text: decodeChunk(chunk, encoding), time: Date.now() })
	}

	// Push onto the total buffer and the stream's bucket, evicting the oldest of each when at
	// capacity — both stay capped at #limit, never growing without bound.
	#retain(message: CapturedChunk): void {
		this.#push(this.#messages, message)
		const bucket = this.#buckets.get(message.level)
		if (bucket !== undefined) this.#push(bucket, message)
	}

	// Bounded push — append, then drop the oldest while over the cap.
	#push(buffer: CapturedChunk[], message: CapturedChunk): void {
		buffer.push(message)
		if (buffer.length > this.#limit) buffer.shift()
	}
}
