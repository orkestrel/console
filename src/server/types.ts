// Server-local types for the server console branch — the TTY sink + the process-stream capture.
// The core `src/core/console` owns the cross-environment contracts (`SinkInterface` / `LogLevel`
// + the style data model) and the console `Capture`; those are imported from `@src/core`,
// never redeclared. The types here are server-only: the injectable stream-target shape, the
// `createServerSink` options + its column-aware return, and the process-stream `Capture` family
// (whose "level" axis is the stream, `'stdout' | 'stderr'`, not a `console.*` method).

import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'
import type { SinkInterface } from '@src/core'

/**
 * Declares the minimal writable-stream shape the server sink and process capture address — exactly the
 * slice of a Node `tty.WriteStream` / `process.stdout` they touch, and no more. A
 * {@link ServerSinkOptions} target and a {@link ProcessCaptureInterface}'s patched streams are
 * narrowed to this through {@link import('./validators.js').isStreamTarget} (narrow the
 * boundary, never `as`), so a test can drive either with a hand-built fake stream that never
 * touches the real `process` streams.
 *
 * @remarks
 * - `write(text)` — the one required method: push a chunk to the stream, returning the host's
 *   backpressure boolean (`false` when the kernel buffer is full). A `process` stream returns it;
 *   a fake may return `void` (read as truthy / no backpressure).
 * - `isTTY` — present and `true` on a real terminal, absent / `false` when the stream is piped to a
 *   file or another process. When no explicit styling override exists, the sink reads it at
 *   construction to decide whether to keep ANSI or {@link import('@src/core').strip} it to clean
 *   text.
 * - `columns` — the terminal width in character cells when the stream is a TTY, `undefined`
 *   otherwise; the sink surfaces it as {@link ServerSinkInterface.columns} so a consumer can feed a
 *   `Reporter` / `Progress` its render width.
 */
export interface StreamTargetInterface {
	write(text: string): boolean | void
	readonly isTTY?: boolean
	readonly columns?: number
}

/**
 * Holds the options for {@link import('./factories.js').createServerSink} — all optional, so a bare
 * `createServerSink()` writes to the real process streams.
 *
 * @remarks
 * - `stdout` — the stream `info` / `debug` (and an omitted level) are written to; defaults to
 *   `process.stdout`, whose name it mirrors. Any {@link StreamTargetInterface} is accepted, so a
 *   test injects a fake.
 * - `stderr` — the stream `error` / `warn` are written to; defaults to `process.stderr`, whose
 *   name it mirrors.
 * - `styled` — an explicit styling decision for both targets. When omitted, each target infers its
 *   own fact from `FORCE_COLOR`, `NO_COLOR`, and `isTTY` at construction.
 * - `environment` — the environment used for inference; defaults to `process.env`.
 * - `columns` — an explicit width override for {@link ServerSinkInterface.columns}. When omitted,
 *   the sink reads the live `stdout.columns` (so it tracks a terminal resize), falling back to
 *   {@link import('./constants.js').DEFAULT_COLUMNS} when the `stdout` stream is not a TTY.
 */
export interface ServerSinkOptions {
	readonly stdout?: StreamTargetInterface
	readonly stderr?: StreamTargetInterface
	readonly styled?: boolean
	readonly environment?: Readonly<Record<string, string | undefined>>
	readonly columns?: number
}

/**
 * Declares a {@link SinkInterface} that also exposes the target terminal's {@link columns} width — the shape
 * {@link import('./factories.js').createServerSink} returns. It is a drop-in {@link SinkInterface}
 * (so a `Logger` / `Reporter` / `Spinner` / `Progress` takes it as `sink`) whose extra `columns`
 * getter lets a consumer size a `Reporter`'s layout to the live terminal. Its `styled` fact lets
 * the same consumer enable or disable its styler for the `stdout` target.
 *
 * @remarks
 * - `styled` is the `stdout` target's construction-time fact. The sink handles `stderr` through its
 *   own independently inferred fact because the two targets can differ.
 * - `columns` is a getter, re-read on every access — so it reflects the current terminal width (a
 *   resize is observed) unless a fixed `options.columns` was supplied, in which case it is constant.
 */
export interface ServerSinkInterface extends SinkInterface {
	readonly styled: boolean
	readonly columns: number
}

/**
 * Names which process stream a {@link CapturedChunk} came from — the "level" axis of the process-stream
 * {@link ProcessCaptureInterface}, the server analogue of the core `Capture`'s `CaptureLevel`.
 *
 * @remarks
 * distinct from {@link import('@src/core').LogLevel}: a `StreamLevel` names the originating process stream
 * (`process.stdout` vs `process.stderr`), not a severity. It is a named value family (it indexes
 * {@link import('./constants.js').STREAM_LEVEL_MAP} to a {@link import('@src/core').LogLevel} for the optional sink
 * forward), never a binary toggle — so it stays a union.
 */
export type StreamLevel = 'stdout' | 'stderr'

/**
 * Names the process-stream `write` method a {@link ProcessCaptureInterface} snapshots and swaps at
 * the patch boundary — the write-side analogue of {@link import('@src/core').ConsoleMethod}.
 *
 * @remarks
 * It is taken verbatim as `NodeJS.WriteStream['write']`, the overloaded
 * `(chunk, encoding?, callback?) => boolean` of `process.stdout.write` / `process.stderr.write`.
 * Using the canonical type rather than a hand-rolled approximation keeps snapshot and restore
 * exact and lets the wrapper assign cleanly. A {@link StreamLevel} (`'stdout' | 'stderr'`) is
 * itself the `process` property key, so `process[level]` indexes the matching `WriteStream`
 * directly, with no lookup map.
 */
export type StreamWriteFunction = NodeJS.WriteStream['write']

/**
 * Names the completion callback `process.*.write` accepts as its last argument — the Node `write`
 * callback shape, and the {@link StreamWriteFunction} companion.
 *
 * @remarks
 * The capture wrapper forwards the callback verbatim to the mirror, so a caller's
 * write-completion handler still fires.
 */
export type StreamWriteCallback = (error?: Error | null) => void

/**
 * Represents one intercepted process-stream write — the immutable, serializable record a
 * {@link ProcessCaptureInterface} buffers and emits, the server analogue of the core
 * `CapturedMessage`.
 *
 * @remarks
 * - `level` — the {@link StreamLevel} naming which stream (`stdout` / `stderr`) was written.
 * - `text` — the chunk decoded to a string (through {@link import('./helpers.js').decodeChunk} —
 *   total, never throws), verbatim: no trailing-newline trimming and no ANSI stripping, so the
 *   captured text is exactly the bytes the program emitted.
 * - `time` — the capture instant as epoch milliseconds (`Date.now()`); a plain number so the record
 *   stays serializable and orderable.
 * - Frozen at construction — a consumer (or a `capture` listener) reads it, never mutates it.
 */
export interface CapturedChunk {
	readonly level: StreamLevel
	readonly text: string
	readonly time: number
}

/**
 * Declares the observable events a {@link ProcessCaptureInterface} emits — mirrors the core
 * `Capture`'s `CaptureEventMap`, but the captured record is a {@link CapturedChunk} (stream-keyed).
 *
 * @remarks
 * - `capture` — an intercepted `process.stdout` / `process.stderr` write, carrying the frozen
 *   {@link CapturedChunk}. The hook a live log viewer / tee subscribes to.
 * - `start` / `stop` — the interception toggled on / off (pure signals, empty tuples).
 *
 * Listener isolation is the emitter's: a listener throw routes to the emitter's `error`
 * handler, never onto this map — so a buggy `capture` listener can never escape into the host's
 * `process.stdout.write` call (which would crash the program).
 *
 * Declared as a `type` alias (not `interface extends EventMap`): a type-literal satisfies the
 * `EventMap` constraint structurally, whereas an interface lacks the index signature.
 */
export type ProcessCaptureEventMap = {
	/** Fires on an intercepted process-stream write — the frozen {@link CapturedChunk}. */
	readonly capture: readonly [chunk: CapturedChunk]
	/** Fires after interception began (`process.*.write` patched). */
	readonly start: readonly []
	/** Fires after interception ended (`process.*.write` restored). */
	readonly stop: readonly []
}

/**
 * Holds the options for the {@link import('./ProcessCapture.js').ProcessCapture} constructor — every
 * field optional, so a bare `new ProcessCapture()` buffers both streams without mirroring or
 * forwarding.
 *
 * @remarks
 * - `on` — initial {@link ProcessCaptureEventMap} listeners, wired at construction (for example
 *   `{ capture: (c) => tee(c) }`).
 * - `error` — the listener-error handler forwarded to the entity's emitter.
 * - `levels` — which streams to intercept; defaults to {@link import('./constants.js').STREAM_LEVELS}
 *   (`stdout` and `stderr`). Narrow it (for example to `['stderr']`) to capture one stream.
 * - `mirror` — when `true`, each intercepted write is also replayed to the snapshot-original
 *   `write` (bound to its stream), so the output still reaches the terminal while being captured;
 *   defaults to `false` (capture-only, the program's output is swallowed into the buffer).
 * - `sink` — an optional {@link SinkInterface} each intercepted chunk is also written to
 *   (`sink.write(text, level)` with the {@link StreamLevel} mapped to a {@link import('@src/core').LogLevel} through
 *   {@link import('./constants.js').STREAM_LEVEL_MAP}), to tee captured output into the logging
 *   pipeline / a file. Absent by default.
 * - `limit` — the bounded-buffer cap (total and each per-stream bucket); defaults to
 *   {@link import('./constants.js').DEFAULT_STREAM_LIMIT}. Retention is always bounded.
 */
export interface ProcessCaptureOptions {
	readonly on?: EmitterHooks<ProcessCaptureEventMap>
	readonly error?: EmitterErrorHandler
	readonly levels?: readonly StreamLevel[]
	readonly mirror?: boolean
	readonly sink?: SinkInterface
	readonly limit?: number
}

/**
 * Declares an observable interceptor of the raw process output streams — the server's
 * "own all output" capture. Where the core `Capture` patches `console.*` (the high-level read
 * side), this patches `process.stdout.write` / `process.stderr.write` (the low-level stream), so it
 * catches direct `process.stdout.write`, third-party library output, and child-process pipes —
 * everything that reaches the streams, not only `console.*`.
 *
 * @remarks
 * - **Snapshot-at-start (the no-capture-loop principle).** `start()` snapshots the current
 *   `process[stream].write` for each configured {@link StreamLevel}, then installs the wrappers. The
 *   mirror replays through that snapshot — so a server sink created from the same streams before the
 *   capture is never re-captured. Create your sinks before installing a capture.
 * - **Idempotent + process-global + non-reentrant.** `start()` while `active` is a no-op (never
 *   double-patches); `stop()` while inactive is a no-op. It patches the one global `process`, so at
 *   most one process capture may be active at a time — running two concurrently interleaves their
 *   buffers and clobbers each other's restore.
 * - **The wrapper never throws and passes through backpressure.** A throw inside
 *   `process.stdout.write` would crash the host, so the wrapper builds its record through a total
 *   decode, and returns the snapshot-original's boolean (or `true` when mirroring is off) so a
 *   caller's backpressure handling keeps working.
 * - **Bounded buffers.** The total buffer and each per-stream bucket are each capped at `limit`
 *   (oldest dropped first), never unbounded.
 * - **Lifecycle.** `start` / `stop` toggle interception (emitting `start` / `stop`);
 *   `destroy()` stops (restoring the pristine `write`) then destroys the emitter.
 */
export interface ProcessCaptureInterface {
	readonly emitter: EmitterInterface<ProcessCaptureEventMap>
	/** Reports whether interception is installed (`start`ed and not yet `stop`ped). */
	readonly active: boolean
	/** Begins intercepting the configured process streams (idempotent; emits `start`). */
	start(): void
	/** Restores the pristine `process.*.write` references (idempotent; emits `stop`). */
	stop(): void
	/** Returns a copy of the full captured buffer, oldest first (capped at `limit`). */
	messages(): readonly CapturedChunk[]
	/** Returns a copy of the captured buffer for one {@link StreamLevel}, oldest first (capped at `limit`). */
	messages(level: StreamLevel): readonly CapturedChunk[]
	/** Drops every buffered chunk (total + per-stream); interception is unaffected. */
	clear(): void
	/** Stops interception (restoring the streams) and tears down the emitter. */
	destroy(): void
}
