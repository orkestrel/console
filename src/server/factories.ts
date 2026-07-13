import type { LogLevel } from '@src/core'
import type {
	ProcessCaptureInterface,
	ProcessCaptureOptions,
	ServerSinkInterface,
	ServerSinkOptions,
} from './types.js'
import { strip } from '@src/core'
import { ProcessCapture } from './ProcessCapture.js'
import { columnsOf, isStreamTarget } from './helpers.js'

/**
 * Create the server TTY {@link ServerSinkInterface} — the C-g server output backend, the
 * env-symmetric sibling of `createBrowserSink` / core's `createConsoleSink`. `write(text, level?)`
 * routes by level to the process streams and is isTTY-aware: it sends ANSI straight to a terminal
 * (which renders it, with a leading `\r` overwriting the line natively — that is how the C-e
 * animations become a LIVE redraw here, with no extra code) but {@link import('@src/core').strip}s
 * the ANSI to clean text when the stream is piped to a file or another process.
 *
 * @param options - See {@link ServerSinkOptions}
 * @returns A {@link ServerSinkInterface} — a {@link import('@src/core').SinkInterface} that also
 *   exposes the terminal `columns` width
 *
 * @remarks
 * - **Routes by level.** `error` / `warn` → the error stream (`process.stderr` by default), every
 *   other level (and an omitted level) → the out stream (`process.stdout`) — the SAME routing as
 *   core's `createConsoleSink`, so a logger's `error` reaches `stderr`.
 * - **isTTY-aware ANSI.** For each write, if the TARGET stream is a TTY the styled `text` is written
 *   VERBATIM (the terminal renders the ANSI, and a leading `\r` overwrites the current line — live
 *   animations for free); if it is NOT a TTY (a pipe / redirect to a log file), the ANSI is stripped
 *   so the file gets clean text. The decision is per-stream and per-write, re-read live, so it stays
 *   correct if a stream's TTY-ness ever differs between out and err.
 * - **Width.** `columns` reflects the live `out.columns` (so it tracks a terminal resize), falling
 *   back to {@link import('./constants.js').DEFAULT_COLUMNS} when the out stream is not a TTY — or a
 *   fixed value when `options.columns` is supplied. Feed it to a `Reporter` / `Progress` `width`.
 * - **Injectable + guard-narrowed.** `options.out` / `options.err` default to `process.stdout` /
 *   `process.stderr` but accept ANY {@link import('./types.js').StreamTargetInterface}, resolved
 *   through {@link isStreamTarget} (AGENTS §14 — narrow the boundary, never `as`), so a test drives
 *   the sink (and the isTTY-strip path) with a fake stream that never touches the real process
 *   streams.
 *
 * @example
 * ```ts
 * import { createLogger, createReporter } from '@src/core'
 * import { createServerSink } from '@src/server'
 *
 * const sink = createServerSink()
 * const logger = createLogger({ name: 'app', sink })
 * logger.error('boom') // → process.stderr, ANSI rendered on a TTY / stripped to a pipe
 * const reporter = createReporter({ sink, width: sink.columns })
 * ```
 */
export function createServerSink(options?: ServerSinkOptions): ServerSinkInterface {
	// Resolve each target through the guard (§14): a present, well-shaped injected stream is used as
	// is; otherwise the real process stream — no `as`, and an `undefined` option falls through to the
	// default. `out` carries info/debug, `err` carries error/warn.
	const out = isStreamTarget(options?.out) ? options.out : process.stdout
	const err = isStreamTarget(options?.err) ? options.err : process.stderr
	const fixed = options?.columns
	return Object.freeze({
		write(text: string, level?: LogLevel): void {
			const target = level === 'error' || level === 'warn' ? err : out
			// On a TTY, write the ANSI verbatim (rendered; a leading `\r` overwrites natively); off a
			// TTY (a pipe / file), strip it so the sink delivers clean text. Re-read `isTTY` per write.
			target.write(target.isTTY === true ? text : strip(text))
		},
		get columns(): number {
			// A fixed override wins; otherwise the live out-stream width (tracks a resize), with the
			// non-TTY fallback inside columnsOf.
			return typeof fixed === 'number' ? fixed : columnsOf(out)
		},
	})
}

/**
 * Create an observable {@link ProcessCaptureInterface} — the server "own ALL output" capture. It
 * intercepts the RAW `process.stdout.write` / `process.stderr.write` (not just `console.*`, which is
 * the core `Capture`), so it catches direct `process` writes, library output, and child-process
 * pipes. Each intercepted write becomes a frozen {@link import('./types.js').CapturedChunk},
 * buffered (bounded, per-stream) and emitted on `capture`; per options it is mirrored back to the
 * real stream and/or forwarded to a {@link import('@src/core').SinkInterface}.
 *
 * @param options - See {@link ProcessCaptureOptions}
 * @returns A {@link ProcessCaptureInterface}
 *
 * @remarks
 * - **The wrapper never throws and passes backpressure through** — a throw in `process.stdout.write`
 *   would crash the host, so chunks are decoded totally and the original's `boolean` is returned.
 * - **Snapshot-at-start + non-reentrant + process-global** — `start()` snapshots and swaps the
 *   pristine `write`; `stop()` restores the EXACT original. At most ONE may be active at a time.
 *   Create any server sink BEFORE installing a capture so the mirror's replay is not re-captured.
 *
 * @example
 * ```ts
 * import { createProcessCapture } from '@src/server'
 *
 * const capture = createProcessCapture({ levels: ['stderr'], mirror: true })
 * capture.start()
 * process.stderr.write('a library diagnostic\n') // captured AND still shown
 * capture.stop()
 * ```
 */
export function createProcessCapture(options?: ProcessCaptureOptions): ProcessCaptureInterface {
	return new ProcessCapture(options)
}
