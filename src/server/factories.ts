import type { LogLevel } from '@src/core'
import type { ServerSinkInterface, ServerSinkOptions } from './types.js'
import { selectWriter, strip, stripControls } from '@src/core'
import { inferColumns, inferStyled } from './helpers.js'
import { isStreamTarget } from './validators.js'

/**
 * Creates the server TTY {@link ServerSinkInterface} — the server output backend, the
 * env-symmetric sibling of `createBrowserSink` / core's `createConsoleSink`. `write(text, level?)`
 * routes by level to the process streams and uses construction-time styled facts: it sends ANSI
 * straight to a styled target (with a leading `\r` overwriting a terminal line natively) but
 * {@link import('@src/core').strip}s ANSI to clean text for a plain target.
 *
 * @param options - See {@link ServerSinkOptions}
 * @returns A {@link ServerSinkInterface} — a {@link import('@src/core').SinkInterface} that also
 *   exposes the terminal `columns` width
 *
 * @remarks
 * - **Routes by level.** `error` / `warn` → the error stream (`process.stderr` by default), every
 *   other level (and an omitted level) → the `stdout` stream (`process.stdout`) — the same routing
 *   as core's `createConsoleSink`, so a logger's `error` reaches `stderr`. Both call the one
 *   {@link import('@src/core').selectWriter} leaf, which is what keeps them identical.
 * - **Per-target styled facts.** At construction, each target uses `options.styled` when supplied;
 *   otherwise {@link inferStyled} applies the injected `environment` (default `process.env`) and
 *   then that target's `isTTY`.
 *   Writes use those stored facts, so `styled` and the `stdout` target's strip decision never
 *   disagree; the `stderr` target keeps its own fact internally.
 * - **Width.** `columns` reflects the live `stdout.columns` (so it tracks a terminal resize),
 *   falling back to {@link import('./constants.js').DEFAULT_COLUMNS} when the `stdout` stream is not
 *   a TTY — or a fixed value when `options.columns` is supplied. Feed it to a `Reporter` /
 *   `Progress` `width`.
 * - **Injectable + guard-narrowed.** `options.stdout` / `options.stderr` default to `process.stdout`
 *   / `process.stderr` but accept any {@link import('./types.js').StreamTargetInterface}, resolved
 *   through {@link isStreamTarget} (narrow the boundary, never `as`), so a test drives
 *   the sink (and the isTTY-strip path) with a fake stream that never touches the real process
 *   streams.
 *
 * @example
 * ```ts
 * import { createStyler, Logger, Reporter } from '@src/core'
 * import { createServerSink } from '@src/server'
 *
 * const sink = createServerSink()
 * const styler = createStyler({ enabled: sink.styled })
 * const logger = new Logger({ name: 'app', sink, styler })
 * logger.error('boom') // → process.stderr, ANSI rendered on a TTY / stripped to a pipe
 * const reporter = new Reporter({ sink, width: sink.columns })
 * ```
 */
export function createServerSink(options?: ServerSinkOptions): ServerSinkInterface {
	// Resolve each target through the guard: a present, well-shaped injected stream is used as
	// is; otherwise the real process stream — no `as`, and an `undefined` option falls through to the
	// default. `stdout` carries info/debug, `stderr` carries error/warn.
	const out = isStreamTarget(options?.stdout) ? options.stdout : process.stdout
	const err = isStreamTarget(options?.stderr) ? options.stderr : process.stderr
	const styled = options?.styled
	const environment = options?.environment ?? process.env
	const outStyled = styled ?? inferStyled(out, environment)
	const errStyled = styled ?? inferStyled(err, environment)
	const fixed = options?.columns
	return Object.freeze({
		styled: outStyled,
		write(text: string, level?: LogLevel): void {
			// The one shared routing leaf picks the target and its styled fact together; `warn` shares
			// the error stream here, matching `console.warn` writing to stderr in core.
			const target = selectWriter(level, { log: out, warn: err, error: err })
			const keep = selectWriter(level, { log: outStyled, warn: errStyled, error: errStyled })
			// A leading `\r` marks an in-place redraw frame (Spinner/Progress), which carries its own
			// line endings and is written verbatim; every other (line-oriented) write gets exactly one
			// trailing `\n` appended here, matching `console.log`'s newline-terminated behavior.
			const framed = text.startsWith('\r')
			const line = framed ? text : `${text}\n`
			// A styled target receives the line verbatim; a plain target receives visible text only.
			target.write(keep ? line : stripControls(strip(line)))
		},
		get columns(): number {
			// A fixed override wins; otherwise the live stdout-stream width (tracks a resize), with the
			// non-TTY fallback inside inferColumns.
			return typeof fixed === 'number' ? fixed : inferColumns(out)
		},
	})
}
