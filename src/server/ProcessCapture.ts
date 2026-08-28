import type { EmitterInterface } from '@orkestrel/emitter'
import type {
	CapturedChunk,
	ProcessCaptureEventMap,
	ProcessCaptureInterface,
	ProcessCaptureOptions,
	StreamLevel,
	StreamWriteCallback,
	StreamWriteFunction,
} from './types.js'
import type { RetentionInterface, SinkInterface } from '@src/core'
import { StringDecoder } from 'node:string_decoder'
import { Emitter } from '@orkestrel/emitter'
import { Retention } from '@src/core'
import { DEFAULT_CAPTURE_LEVELS, DEFAULT_CAPTURE_LIMIT, STREAM_LEVEL_MAP } from './constants.js'
import { decodeChunk } from './helpers.js'
import { isBufferEncoding } from './validators.js'

/**
 * An observable interceptor of the raw process output streams — it takes control of
 * `process.stdout.write` / `process.stderr.write` on the write side. While `active`, every write to
 * a configured {@link StreamLevel} is captured as a frozen {@link CapturedChunk}, buffered (total +
 * per-stream, bounded), emitted on `capture`, and — per options — mirrored to the real stream and/or
 * forwarded to a {@link SinkInterface}.
 *
 * @remarks
 * Where the core `Capture` patches `console.*` (the high-level read side), this patches the
 * low-level stream `write`, so it owns all server output: a direct `process.stdout.write`, a
 * third-party library's writes, a child-process pipe — not only `console.*`.
 *
 * - **Snapshot-at-start (the no-capture-loop principle).** `start()` snapshots the current
 *   `process[stream].write` for each configured level, then installs the wrappers. The mirror
 *   replays through that snapshot (bound to its stream) — so a server sink created from the same
 *   streams before the capture is never re-captured: this catches other writers, not the mirror's
 *   own replay. Create your sinks before installing a capture.
 * - **Idempotent + process-global + non-reentrant.** `start()` while `active` is a no-op (never
 *   double-patches — that would snapshot the wrapper as the "original" and break restore); `stop()`
 *   while inactive is a no-op. It patches the one global `process`, so at most one process capture
 *   may be active at a time — two concurrently would interleave buffers and clobber each other's
 *   restore.
 * - **The wrapper never throws and passes backpressure through.** A throw inside
 *   `process.stdout.write` would crash the host, so the wrapper decodes each chunk totally (a byte
 *   chunk through the per-level streaming decoder below, everything else through the total
 *   {@link decodeChunk}), and returns the snapshot-original's `boolean` when mirroring (so a caller's
 *   `write` backpressure handling still works) or `true` when capture-only (the buffer never fills).
 * - **Streaming UTF-8 decode (no split-codepoint corruption).** `start()` gives each configured
 *   {@link StreamLevel} a fresh persistent `StringDecoder`. A byte chunk with utf-8 or an omitted
 *   encoding decodes through it, so a multibyte codepoint split across two `write` byte chunks — a
 *   child-process pipe, a library, or OS buffering all produce this — carries its partial bytes to
 *   the next write instead of decoding each half to `U+FFFD`. `stop()` flushes each decoder once, so
 *   a codepoint left half-written at stop is still surfaced. A `string` chunk is already text and
 *   passes through; an explicit non-utf-8 buffer encoding (`latin1` / `hex` / `base64` / …) names a
 *   self-contained per-write decode and is honored one-shot through {@link decodeChunk}.
 * - **Bounded buffers.** The total buffer and each per-stream bucket are each capped at `limit`
 *   (oldest dropped first), never unbounded — the same retention precedent as the core `Capture`.
 * - **Lifecycle.** `start` / `stop` toggle interception (emitting `start` / `stop`);
 *   `destroy()` stops (restoring the pristine `write`) then destroys the emitter.
 *
 * @example
 * ```ts
 * const capture = new ProcessCapture({ levels: ['stderr'], mirror: true })
 * capture.start()
 * process.stderr.write('a library diagnostic\n') // captured and still written to the terminal
 * capture.messages('stderr') // [{ level: 'stderr', text: 'a library diagnostic\n', time: … }]
 * capture.stop() // process.stderr.write restored
 * ```
 */
export class ProcessCapture implements ProcessCaptureInterface {
	// The push observation surface — owned, never inherited. The emitter isolates a listener
	// throw (routing it to the `error` handler), so a buggy `capture` listener can never escape into
	// the host program's `process.*.write` call.
	readonly #emitter: Emitter<ProcessCaptureEventMap>
	readonly #levels: readonly StreamLevel[]
	readonly #mirror: boolean
	readonly #sink: SinkInterface | undefined
	// The bounded buffers — the total one and one per configured StreamLevel — owned by the shared
	// core retention engine the console `Capture` composes too.
	readonly #retention: RetentionInterface<CapturedChunk>
	// The snapshot-original `write` references, captured at start() and restored at stop(); empty
	// while inactive.
	readonly #originals = new Map<StreamLevel, StreamWriteFunction>()
	// One persistent streaming utf-8 decoder per configured level, created fresh in start() and
	// flushed + cleared in stop(). It carries a multibyte codepoint split across successive byte
	// writes so each half is not decoded to U+FFFD; empty while inactive.
	readonly #decoders = new Map<StreamLevel, StringDecoder>()
	// Stored rather than derived from #originals: an empty `levels` list patches no stream, so a
	// started capture configured with no level leaves #originals empty while still being active.
	#active = false

	constructor(options?: ProcessCaptureOptions) {
		this.#emitter = new Emitter<ProcessCaptureEventMap>({
			...(options?.on !== undefined ? { on: options.on } : {}),
			...(options?.error !== undefined ? { error: options.error } : {}),
		})
		this.#levels = options?.levels ?? DEFAULT_CAPTURE_LEVELS
		this.#mirror = options?.mirror ?? false
		this.#sink = options?.sink
		this.#retention = new Retention<CapturedChunk>(
			this.#levels,
			options?.limit ?? DEFAULT_CAPTURE_LIMIT,
		)
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
			// Snapshot the current write reference before replacing it — stop() restores exactly this
			// reference, leaving the stream pristine (the wrapper is never snapshotted as the original).
			const original = stream.write
			this.#originals.set(level, original)
			// The mirror target is the snapshot original bound to its stream, computed once here — so a
			// mirrored write reaches the real method with its proper receiver, through the snapshot and
			// never the live (patched) `write` (no capture loop). The restore reference stays the pristine
			// unbound `original` above; only the mirror uses the bound form.
			const mirror = original.bind(stream)
			// The replacement matches the Node `write` overload shape exactly — `(chunk, encoding?, cb?)`
			// where the 2nd arg is either a `BufferEncoding` or the completion callback — so it assigns to
			// the stream's `write` slot and its args forward cleanly to `mirror` (no `as`, no untyped
			// spread).
			stream.write = this.#captureWrite.bind(this, level, mirror)
			// A fresh streaming decoder per cycle — a stop → start pair starts clean, never carrying a
			// stale partial byte from a prior capture into the new one.
			this.#decoders.set(level, new StringDecoder('utf8'))
		}
		this.#emitter.emit('start')
	}

	stop(): void {
		// Safe when not active — nothing to restore.
		if (!this.#active) return
		this.#active = false
		for (const [level, original] of this.#originals) this.#stream(level).write = original
		this.#originals.clear()
		// Drain any trailing partial codepoint from each streaming decoder before the `stop` signal, so
		// a codepoint left half-written at stop is captured once rather than dropped.
		this.#flush()
		this.#emitter.emit('stop')
	}

	messages(): readonly CapturedChunk[]
	messages(level: StreamLevel): readonly CapturedChunk[]
	messages(level?: StreamLevel): readonly CapturedChunk[] {
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

	// The global WriteStream for a StreamLevel — `process[level]` indexes it directly, since a
	// StreamLevel is the `process` property key (`'stdout'` / `'stderr'`); no `as`, no lookup map.
	#stream(level: StreamLevel): NodeJS.WriteStream {
		return process[level]
	}

	// Adapt the patched stream's write signature to #intercept. Binding level and the pristine
	// mirror in start() leaves the canonical chunk / encoding / callback parameters.
	#captureWrite(
		level: StreamLevel,
		mirror: StreamWriteFunction,
		chunk: string | Uint8Array,
		encoding?: BufferEncoding | StreamWriteCallback,
		callback?: StreamWriteCallback,
	): boolean {
		return this.#intercept(level, chunk, encoding, callback, mirror)
	}

	// The wrapper body behind every patched stream write: decode the chunk to text (#decode — total,
	// streaming for byte chunks), record it (buffer bounded, emit `capture`, forward to the sink),
	// then — per options — mirror to the real stream. Never throws (#decode is total; the emitter
	// isolates listeners); the program's own write is replayed through `mirror` (the bound snapshot
	// original) only when the `mirror` option is set, and the original's backpressure boolean is
	// returned. Capture-only returns `true` (output is swallowed into the buffer, so the kernel buffer
	// never fills). The raw chunk (not the decoded text) is what mirrors, so the terminal still
	// receives the exact bytes; the `encoding` / `callback` tail is forwarded to the mirror branched
	// on whether the 2nd arg is the callback or an encoding (the two Node overloads), so a caller's
	// completion callback fires.
	#intercept(
		level: StreamLevel,
		chunk: string | Uint8Array,
		encoding: BufferEncoding | StreamWriteCallback | undefined,
		callback: StreamWriteCallback | undefined,
		mirror: StreamWriteFunction,
	): boolean {
		this.#record(level, this.#decode(level, chunk, encoding))
		if (!this.#mirror) {
			// Capture-only: the write never reaches the real stream, so fire the caller's completion
			// callback asynchronously (matching Node's own async completion semantics) rather than
			// silently dropping it — both call shapes (`write(chunk, cb)` and `write(chunk, encoding, cb)`)
			// are covered.
			const done = typeof encoding === 'function' ? encoding : callback
			if (done !== undefined) queueMicrotask(() => done())
			return true
		}
		// `write(chunk, cb)` when the 2nd arg is the callback; `write(chunk, encoding, cb)` otherwise —
		// matching the two Node overloads so the forward stays typed.
		if (typeof encoding === 'function') return mirror(chunk, encoding)
		return mirror(chunk, encoding, callback)
	}

	// Decode one write chunk to text — total, never throws (a throw here would escape into the patched
	// process.*.write and crash the host). A `string` chunk is already text and passes through. A byte
	// chunk with utf-8 / an omitted encoding / a callback in the encoding slot streams through the
	// level's persistent decoder, carrying a codepoint split across writes; an explicit non-utf-8
	// buffer encoding is self-contained per write and decoded one-shot through decodeChunk.
	#decode(
		level: StreamLevel,
		chunk: string | Uint8Array,
		encoding: BufferEncoding | StreamWriteCallback | undefined,
	): string {
		if (typeof chunk === 'string') return chunk
		const decoder = this.#decoders.get(level)
		if (decoder !== undefined && this.#streams(encoding)) {
			return decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
		}
		return decodeChunk(chunk, encoding)
	}

	// Whether a byte chunk with this encoding routes through the persistent streaming decoder rather
	// than the one-shot decodeChunk. True for an omitted encoding, a callback in the slot, an
	// unrecognized string (all utf-8 by decodeChunk's own fallback), or an explicit utf-8; false only
	// for a recognized non-utf-8 buffer encoding, whose per-write bytes are self-contained.
	#streams(encoding: BufferEncoding | StreamWriteCallback | undefined): boolean {
		if (!isBufferEncoding(encoding)) return true
		const normalized = encoding.toLowerCase()
		return normalized === 'utf8' || normalized === 'utf-8'
	}

	// Build the immutable, serializable captured chunk from already-decoded text, stamp it with the
	// capture instant, buffer it (total + per-stream, bounded), emit `capture`, then forward it to the
	// sink. Frozen so a consumer (or the `capture` listener) can never mutate it. Never throws into the
	// patched stream — the sink is a best-effort tee and the emitter isolates a listener throw.
	#record(level: StreamLevel, text: string): void {
		const message: CapturedChunk = Object.freeze({ level, text, time: Date.now() })
		this.#retention.add(message)
		this.#emitter.emit('capture', message)
		if (this.#sink !== undefined) {
			try {
				this.#sink.write(message.text, STREAM_LEVEL_MAP[level])
			} catch {
				// The sink is a best-effort tee; the wrapper never throws into the patched global stream —
				// a broken/throwing sink must not crash the host's process.stdout / process.stderr write.
			}
		}
	}

	// Drain each streaming decoder's trailing partial codepoint once — `decoder.end()` emits the
	// pending bytes' final text (U+FFFD for a genuinely truncated sequence) — so a codepoint left
	// half-written at stop is recorded, not silently dropped. An empty flush adds no record. Clears
	// the decoders so the next start() begins clean.
	#flush(): void {
		for (const [level, decoder] of this.#decoders) {
			const text = decoder.end()
			if (text !== '') this.#record(level, text)
		}
		this.#decoders.clear()
	}
}
