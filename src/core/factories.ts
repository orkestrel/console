import type {
	CaptureOptions,
	CaptureResult,
	LogLevel,
	SinkInterface,
	StylerInterface,
	StylerOptions,
	Theme,
	ThemeOptions,
} from './types.js'
import { ANSIRenderer } from './ANSIRenderer.js'
import { Capture } from './Capture.js'
import { DEFAULT_THEME, EMPTY_STYLE, LOG_LEVELS, STATUS_LEVELS } from './constants.js'
import { freezeStyle, selectWriter } from './helpers.js'
import { Styler } from './Styler.js'

/**
 * Creates the fluent, composable {@link StylerInterface} — the consumer-facing styling
 * API. It builds a {@link import('./types.js').Style} under the hood and renders it
 * through a {@link import('./types.js').RendererInterface} (the ANSI default), so
 * `styler.red.bold('hi')` yields styled text. Chains are immutable, so a base styler is freely reusable.
 *
 * @param options - See {@link StylerOptions}
 * @returns A base {@link StylerInterface}
 *
 * @remarks
 * - `options.renderer` swaps the output target without touching the style model — pass a
 *   browser `%c` / CSS renderer (the browser branch) to retarget; defaults to the ANSI
 *   renderer (the cross-environment default).
 * - `options.enabled` is the no-color switch: when `false`, the styler returns text
 *   verbatim (for a non-TTY, `NO_COLOR`, or piped output); defaults to `true`.
 *
 * @example
 * ```ts
 * import { createStyler } from '@src/core'
 *
 * const style = createStyler()
 * style.red.bold('error') // bold red
 * style.red(style.underline('link')) // composes either way
 *
 * // Disable for a non-TTY — every call returns its text unchanged.
 * const plain = createStyler({ enabled: false })
 * plain.green('ok') // 'ok'
 * ```
 */
export function createStyler(options?: StylerOptions): StylerInterface {
	const renderer = options?.renderer ?? new ANSIRenderer()
	const enabled = options?.enabled ?? true
	return new Styler(renderer, enabled, EMPTY_STYLE).surface
}

/**
 * Creates a {@link Theme} — the app-wide semantic style vocabulary, merged role by role over
 * {@link DEFAULT_THEME}. Hand one theme to a logger / reporter / spinner / progress and every
 * surface speaks it; omit `options` for the defaults.
 *
 * @param options - See {@link ThemeOptions}
 * @returns A frozen {@link Theme}
 *
 * @remarks
 * - **Merges per role, not per theme.** An omitted role keeps its default, and `levels` /
 *   `statuses` merge per entry — `{ levels: { warn: … } }` restyles the `warn` label and
 *   leaves `debug` / `info` / `error` untouched.
 * - **Frozen and shareable.** The factory snapshots and deep-freezes every style leaf. The
 *   returned theme and its `levels` / `statuses` records are frozen. Each status record is also
 *   copied and frozen. One theme is therefore safely shared across every entity.
 *
 * @example
 * ```ts
 * import { createStyler, createTheme } from '@src/core'
 *
 * const styler = createStyler()
 * const theme = createTheme({
 * 	levels: { warn: styler.brightYellow.bold.style }, // only the warn label changes
 * 	accent: styler.magenta.style, // spinner glyph, progress fill, step prefix
 * })
 * theme.levels.error // still the default red
 * ```
 */
export function createTheme(options?: ThemeOptions): Theme {
	const levels = { ...DEFAULT_THEME.levels }
	for (const level of LOG_LEVELS) {
		levels[level] = freezeStyle(options?.levels?.[level] ?? DEFAULT_THEME.levels[level])
	}
	const statuses = { ...DEFAULT_THEME.statuses }
	for (const status of STATUS_LEVELS) {
		const source = options?.statuses?.[status] ?? DEFAULT_THEME.statuses[status]
		statuses[status] = Object.freeze({ icon: source.icon, style: freezeStyle(source.style) })
	}
	return Object.freeze({
		levels: Object.freeze(levels),
		statuses: Object.freeze(statuses),
		accent: freezeStyle(options?.accent ?? DEFAULT_THEME.accent),
		chrome: freezeStyle(options?.chrome ?? DEFAULT_THEME.chrome),
	})
}

/**
 * Creates the default {@link SinkInterface} — a console sink that routes by level and writes
 * through the `console` methods snapshotted at creation. The default output target behind the
 * {@link import('./Logger.js').Logger}.
 *
 * @returns A console {@link SinkInterface}
 *
 * @remarks
 * - **Snapshotted — no capture loop.** It captures `console.log` / `console.warn` /
 *   `console.error` at call time and writes through those references. So when a later
 *   `Capture` patches `console.*`, this sink still reaches the real streams — the
 *   writer and the capturer never feed each other (the no-capture-loop principle). Create
 *   the sink (or the logger) before installing a capture for this to hold.
 * - **Routes by level.** `error` → the snapshotted `console.error`, `warn` →
 *   `console.warn`, every other level → `console.log`. The `level` is supplied by the
 *   logger; an omitted `level` goes to `console.log`. The decision is
 *   {@link import('./helpers.js').selectWriter}'s, shared with the browser and server sinks.
 *
 * @example
 * ```ts
 * import { createConsoleSink } from '@src/core'
 *
 * const sink = createConsoleSink() // snapshots console.* now
 * sink.write('boom', 'error') // → the real console.error, even after a later console patch
 * ```
 */
export function createConsoleSink(): SinkInterface {
	// Snapshot the three console writers now — bound to their `console` receiver — so a later
	// patch of `console.*` (by Capture) can never reach this sink's output (no capture loop).
	const log = console.log.bind(console)
	const warn = console.warn.bind(console)
	const error = console.error.bind(console)
	return {
		write(text: string, level?: LogLevel): void {
			selectWriter(level, { log, warn, error })(text)
		},
	}
}

// Run `fn` under a fresh, scoped console capture — the ergonomic form of the `Capture` class. A
// sync `fn` returning T yields { value, messages }; an async `fn` returning Promise<T> yields a
// Promise of the same. The capture starts before `fn`, and `destroy()` runs on every path — sync
// success, sync throw, and each async handler — stopping the capture so console is always
// restored, and the capture is discarded — only the buffered messages are returned.
export function createCaptureResult<T>(
	fn: () => Promise<T>,
	options?: CaptureOptions,
): Promise<CaptureResult<T>>
export function createCaptureResult<T>(fn: () => T, options?: CaptureOptions): CaptureResult<T>
/**
 * Runs `fn` with the global `console.*` captured for its duration, returning the function's `value`
 * plus the {@link import('./types.js').CapturedMessage}s it logged — the scoped, self-restoring
 * ergonomic form of the {@link Capture} class.
 *
 * @param fn - The function to run under capture; may be sync (returns `T`) or async (returns
 *   `Promise<T>`)
 * @param options - See {@link CaptureOptions} (`levels` / `mirror` / `sink` / `limit` / `on` /
 *   `error`); the capture is started for the duration of `fn` regardless
 * @returns For a sync `fn`, a {@link CaptureResult}`<T>` (`{ value, messages }`); for an async
 *   `fn`, a `Promise<CaptureResult<T>>` (awaited, then console restored)
 *
 * @remarks
 * - **Always restores.** `start()` runs before `fn`; `destroy()` (which calls `stop()`) runs on
 *   every path — sync success, sync throw, and each async handler — so `console` is restored even
 *   if `fn` throws / rejects (the throw / rejection still propagates). The capture is local —
 *   created, used, and destroyed within the call.
 * - **Sync vs async.** A `fn` returning a `Promise` is detected and awaited before `stop()`, so
 *   captures during the async work are included; a plain `fn` stops synchronously. The return type
 *   follows `fn`'s (overloaded).
 * - **process-global caveat.** Like the {@link Capture} class, this patches the one global
 *   `console`. Concurrent `createCaptureResult` calls (or one around other capturing code)
 *   interleave — each captures every `console.*` call in flight, and the inner `stop()` restores
 *   whatever the outer had installed. Use it for sequential, scoped capture, not overlapping captures.
 *
 * @example
 * ```ts
 * import { createCaptureResult } from '@src/core'
 *
 * const { value, messages } = createCaptureResult(() => {
 * 	console.log('working')
 * 	return 42
 * })
 * value // 42
 * messages.map((m) => m.text) // ['working']
 *
 * // Async — awaited before console is restored.
 * const out = await createCaptureResult(async () => {
 * 	console.warn('async noise')
 * 	return 'done'
 * })
 * out.value // 'done'
 * ```
 */
export function createCaptureResult<T>(
	fn: () => T | Promise<T>,
	options?: CaptureOptions,
): CaptureResult<T> | Promise<CaptureResult<T>> {
	const capture = new Capture(options)
	capture.start()
	try {
		const result = fn()
		if (result instanceof Promise) {
			return result.then(
				(value) => {
					const messages = capture.messages()
					capture.destroy()
					return { value, messages }
				},
				(error: unknown) => {
					capture.destroy()
					throw error
				},
			)
		}
		const messages = capture.messages()
		capture.destroy()
		return { value: result, messages }
	} catch (error) {
		// A sync throw — restore console before rethrowing (the async rejection path is handled above).
		capture.destroy()
		throw error
	}
}
