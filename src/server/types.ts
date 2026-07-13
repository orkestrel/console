// Server-local types for the C-g console branch — the TTY sink + the process-stream capture.
// The core `src/core/console` owns the cross-environment contracts (`SinkInterface` / `LogLevel`
// + the style DATA model) and the C-d console `Capture`; those are IMPORTED from `@src/core`,
// never redeclared. The types here are server-only: the injectable stream-target shape, the
// `createServerSink` options + its column-aware return, and the process-stream `Capture` family
// (whose "level" axis is the STREAM, `'stdout' | 'stderr'`, not a `console.*` method).

import type { EmitterErrorHandler, EmitterHooks, EmitterInterface, SinkInterface } from '@src/core'

/**
 * The minimal writable-stream shape the C-g server sink and process capture address — exactly the
 * slice of a Node `tty.WriteStream` / `process.stdout` they touch, and no more. A
 * {@link ServerSinkOptions} target and a {@link ProcessCaptureInterface}'s patched streams are
 * narrowed to this via {@link import('./helpers.js').isStreamTarget} (AGENTS §14 — narrow the
 * boundary, never `as`), so a test can drive either with a hand-built fake stream that never
 * touches the real `process` streams.
 *
 * @remarks
 * - `write(text)` — the one required method: push a chunk to the stream, returning the host's
 *   backpressure boolean (`false` when the kernel buffer is full). A `process` stream returns it;
 *   a fake may return `void` (read as truthy / no backpressure).
 * - `isTTY` — present and `true` on a real terminal, absent / `false` when the stream is piped to a
 *   file or another process. The sink reads it to decide whether to keep ANSI (a terminal renders
 *   it, and a leading `\r` overwrites natively) or {@link import('@src/core').strip} it to clean
 *   text (a log file should not carry escape codes).
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
 * Options for {@link import('./factories.js').createServerSink} — all optional, so a bare
 * `createServerSink()` writes to the real process streams.
 *
 * @remarks
 * - `out` — the stream `info` / `debug` (and an omitted level) are written to; defaults to
 *   `process.stdout`. Any {@link StreamTargetInterface} is accepted, so a test injects a fake.
 * - `err` — the stream `error` / `warn` are written to; defaults to `process.stderr`.
 * - `columns` — an explicit width override for {@link ServerSinkInterface.columns}. When omitted,
 *   the sink reads the live `out.columns` (so it tracks a terminal resize), falling back to
 *   {@link import('./constants.js').DEFAULT_COLUMNS} when the out stream is not a TTY.
 */
export interface ServerSinkOptions {
	readonly out?: StreamTargetInterface
	readonly err?: StreamTargetInterface
	readonly columns?: number
}

/**
 * A {@link SinkInterface} that also exposes the target terminal's {@link columns} width — the shape
 * {@link import('./factories.js').createServerSink} returns. It is a drop-in {@link SinkInterface}
 * (so a `Logger` / `Reporter` / `Spinner` / `Progress` takes it as `sink`) whose extra `columns`
 * getter lets a consumer size a `Reporter`'s layout to the live terminal.
 *
 * @remarks
 * `columns` is a getter, re-read on every access — so it reflects the CURRENT terminal width (a
 * resize is observed) unless a fixed `options.columns` was supplied, in which case it is constant.
 */
export interface ServerSinkInterface extends SinkInterface {
	readonly columns: number
}

/**
 * Which process stream a {@link CapturedChunk} came from — the "level" axis of the process-stream
 * {@link ProcessCaptureInterface}, the server analogue of the core `Capture`'s `CaptureLevel`.
 *
 * @remarks
 * DISTINCT from {@link import('@src/core').LogLevel}: a `StreamLevel` names the ORIGINATING process stream
 * (`process.stdout` vs `process.stderr`), not a severity. It is a named value family (it indexes
 * {@link import('./constants.js').STREAM_LEVEL_MAP} to a {@link import('@src/core').LogLevel} for the optional sink
 * forward), never a binary toggle — so it stays a union (AGENTS §4.4).
 */
export type StreamLevel = 'stdout' | 'stderr'

// The process-stream `write` method the {@link ProcessCaptureInterface} patch swaps in — taken
// VERBATIM as `NodeJS.WriteStream['write']` (the overloaded `(chunk, encoding?, callback?) => boolean`
// of `process.stdout.write` / `process.stderr.write`). It names the GLOBAL stream method this capture
// snapshots + swaps at the patch boundary (the {@link ConsoleMethod} analogue on the WRITE side).
// Using the canonical type (not a hand-rolled approximation) makes snapshot + restore EXACT and lets
// the wrapper assign cleanly. The {@link StreamLevel} (`'stdout' | 'stderr'`) IS the `process` property
// key, so `process[level]` indexes the matching `WriteStream` directly — no lookup map.
export type StreamWrite = NodeJS.WriteStream['write']

// The completion callback a `process.*.write` accepts as its last argument — the Node `write` callback
// shape (the {@link StreamWrite} companion). The wrapper forwards it verbatim to the mirror so a
// caller's write-completion handler still fires.
export type StreamWriteCallback = (error?: Error | null) => void

/**
 * One intercepted process-stream write — the immutable, serializable record a
 * {@link ProcessCaptureInterface} buffers and emits, the server analogue of the core
 * `CapturedMessage`.
 *
 * @remarks
 * - `level` — the {@link StreamLevel} naming which stream (`stdout` / `stderr`) was written.
 * - `text` — the chunk decoded to a string (via {@link import('./helpers.js').decodeChunk} —
 *   total, never throws), VERBATIM: no trailing-newline trimming and no ANSI stripping, so the
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
 * The observable events a {@link ProcessCaptureInterface} emits (AGENTS §13) — mirrors the core
 * `Capture`'s `CaptureEventMap`, but the captured record is a {@link CapturedChunk} (stream-keyed).
 *
 * @remarks
 * - `capture` — an intercepted `process.stdout` / `process.stderr` write, carrying the frozen
 *   {@link CapturedChunk}. The hook a live log viewer / tee subscribes to.
 * - `start` / `stop` — the interception toggled on / off (pure signals, empty tuples).
 *
 * Listener isolation is the emitter's (§13): a listener throw routes to the emitter's `error`
 * handler, never onto this map — so a buggy `capture` listener can never escape into the host's
 * `process.stdout.write` call (which would crash the program).
 *
 * Declared as a `type` alias (not `interface extends EventMap`, §4.5): a type-literal satisfies the
 * `EventMap` constraint structurally, whereas an interface lacks the index signature.
 */
export type ProcessCaptureEventMap = {
	/** An intercepted process-stream write — the frozen {@link CapturedChunk}. */
	readonly capture: readonly [chunk: CapturedChunk]
	/** Interception began (`process.*.write` patched). */
	readonly start: readonly []
	/** Interception ended (`process.*.write` restored). */
	readonly stop: readonly []
}

/**
 * Options for {@link import('./factories.js').createProcessCapture} — every field optional, so a
 * bare `createProcessCapture()` buffers both streams without mirroring or forwarding.
 *
 * @remarks
 * - `on` — initial {@link ProcessCaptureEventMap} listeners, wired at construction (e.g.
 *   `{ capture: (c) => tee(c) }`).
 * - `error` — the listener-error handler forwarded to the entity's emitter (§13).
 * - `levels` — which streams to intercept; defaults to {@link import('./constants.js').DEFAULT_CAPTURE_LEVELS}
 *   (both `stdout` and `stderr`). Narrow it (e.g. just `['stderr']`) to capture one stream.
 * - `mirror` — when `true`, each intercepted write is ALSO replayed to the snapshot-original
 *   `write` (bound to its stream), so the output still reaches the terminal while being captured;
 *   defaults to `false` (capture-only, the program's output is swallowed into the buffer).
 * - `sink` — an optional {@link SinkInterface} each intercepted chunk is also written to
 *   (`sink.write(text, level)` with the {@link StreamLevel} mapped to a {@link import('@src/core').LogLevel} via
 *   {@link import('./constants.js').STREAM_LEVEL_MAP}), to tee captured output into the logging
 *   pipeline / a file. Absent by default.
 * - `limit` — the bounded-buffer cap (total AND each per-stream bucket); defaults to
 *   {@link import('./constants.js').DEFAULT_CAPTURE_LIMIT}. Retention is ALWAYS bounded.
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
 * An observable interceptor of the RAW process output streams (AGENTS §13) — the server's
 * "own ALL output" capture. Where the core `Capture` patches `console.*` (the high-level read
 * side), this patches `process.stdout.write` / `process.stderr.write` (the low-level stream), so it
 * catches DIRECT `process.stdout.write`, third-party library output, and child-process pipes —
 * everything that reaches the streams, not just `console.*`.
 *
 * @remarks
 * - **Snapshot-at-start (the no-capture-loop principle).** `start()` snapshots the CURRENT
 *   `process[stream].write` for each configured {@link StreamLevel}, then installs the wrappers. The
 *   mirror replays through that snapshot — so a server sink created from the same streams BEFORE the
 *   capture is never re-captured. Create your sinks before installing a capture.
 * - **Idempotent + PROCESS-GLOBAL + NON-REENTRANT.** `start()` while `active` is a no-op (never
 *   double-patches); `stop()` while inactive is a no-op. It patches the ONE global `process`, so at
 *   most ONE process capture may be active at a time — running two concurrently interleaves their
 *   buffers and clobbers each other's restore.
 * - **The wrapper NEVER throws and passes through backpressure.** A throw inside
 *   `process.stdout.write` would crash the host, so the wrapper builds its record through a total
 *   decode, and returns the snapshot-original's boolean (or `true` when mirroring is off) so a
 *   caller's backpressure handling keeps working.
 * - **Bounded buffers.** The total buffer and each per-stream bucket are each capped at `limit`
 *   (oldest dropped first), never unbounded.
 * - **Lifecycle (§10).** `start` / `stop` toggle interception (emitting `start` / `stop`);
 *   `destroy()` stops (restoring the pristine `write`) then destroys the emitter.
 */
export interface ProcessCaptureInterface {
	readonly emitter: EmitterInterface<ProcessCaptureEventMap>
	/** Whether interception is currently installed (`start`ed and not yet `stop`ped). */
	readonly active: boolean
	/** Begin intercepting the configured process streams (idempotent; emits `start`). */
	start(): void
	/** Restore the pristine `process.*.write` references (idempotent; emits `stop`). */
	stop(): void
	/** A copy of the full captured buffer, oldest first (capped at `limit`). */
	messages(): readonly CapturedChunk[]
	/** A copy of the captured buffer for ONE {@link StreamLevel}, oldest first (capped at `limit`). */
	byLevel(level: StreamLevel): readonly CapturedChunk[]
	/** Drop every buffered chunk (total + per-stream); interception is unaffected. */
	clear(): void
	/** Stop interception (restoring the streams) and tear down the emitter. */
	destroy(): void
}
