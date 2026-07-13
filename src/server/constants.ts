// Server-console constants (the C-g branch) — UPPER_SNAKE, `Object.freeze`d data. The kind-pure home
// for every module-scope constant the sink + process capture use (AGENTS §5): the default stream
// set, the buffer cap, the no-TTY column fallback, and the stream→log-level projection.

import type { LogLevel } from '@src/core'
import type { StreamLevel } from './types.js'

/**
 * The two process streams a {@link import('./types.js').ProcessCaptureInterface} can intercept, in
 * `stdout`-then-`stderr` order — the {@link StreamLevel} universe and the default configured set.
 */
export const STREAM_LEVELS: readonly StreamLevel[] = Object.freeze(['stdout', 'stderr'])

/**
 * The default set of {@link StreamLevel}s a process capture patches when `options.levels` is omitted
 * — BOTH streams ({@link STREAM_LEVELS}). A consumer narrows it (e.g. just `['stderr']`) via
 * `options.levels`.
 */
export const DEFAULT_CAPTURE_LEVELS: readonly StreamLevel[] = STREAM_LEVELS

/**
 * The default bounded-buffer cap for a {@link import('./types.js').ProcessCaptureInterface} — at
 * most this many recent {@link import('./types.js').CapturedChunk}s are retained per buffer (the
 * total buffer AND each per-stream bucket; oldest dropped first). Mirrors the core `Capture`'s
 * `DEFAULT_CAPTURE_LIMIT`; a consumer overrides it via `options.limit`.
 */
export const DEFAULT_CAPTURE_LIMIT = 1000

/**
 * The terminal width {@link import('./factories.js').createServerSink} reports through
 * {@link import('./types.js').ServerSinkInterface.columns} when the out stream is NOT a TTY (so
 * `.columns` is `undefined`) and no explicit `options.columns` was supplied — the conventional
 * 80-column default a non-interactive context (a pipe, a CI log) assumes.
 */
export const DEFAULT_COLUMNS = 80

/**
 * Each {@link StreamLevel}'s {@link LogLevel} for the optional sink forward — the projection a
 * process capture routes through when writing an intercepted chunk to a
 * {@link import('@src/core').SinkInterface}
 * (`sink.write(text, STREAM_LEVEL_MAP[level])`). `stderr` is conventionally the error/diagnostic
 * stream → `error`; `stdout` is the normal output stream → `info`. The source of truth for the
 * stream-to-log projection (the server analogue of the core `CAPTURE_LEVEL_MAP`).
 */
export const STREAM_LEVEL_MAP: Readonly<Record<StreamLevel, LogLevel>> = Object.freeze({
	stdout: 'info',
	stderr: 'error',
})
