import type { LogLevel, SinkInterface } from '@src/core'
import { ansiToConsole } from './helpers.js'

// The browser `%c` console sink (the C-f branch) — the platform-bound backend that satisfies core's
// `SinkInterface` in a browser DevTools console. The core styler / Logger / Reporter emit ANSI-styled
// STRINGS; a DevTools console can't render ANSI but CAN style via `console.log('%ctext', 'css')`, so
// this sink translates the incoming ANSI runs into a `%c` call at the OUTPUT boundary (the env-split
// rule: core owns the contract + universal logic, the browser provides the platform backend). A thin
// stateless adapter, so a frozen-object factory — like core's `createConsoleSink` — not a class
// (AGENTS §5). `SinkInterface` / `LogLevel` are IMPORTED from `@src/core`, never redeclared.

/**
 * Create the browser `%c` {@link SinkInterface} — the C-f browser output backend. `write(text, level?)`
 * translates the ANSI-styled `text` into a browser `console` call (`console[method](format, ...styles)`)
 * via {@link ansiToConsole}, so a DevTools console renders the SAME styling a terminal does. Drop it in
 * as a logger / reporter / spinner sink (`createLogger({ sink: createBrowserSink() })`) to retarget the
 * core output to the browser console with no change to the core.
 *
 * @returns A browser `%c` {@link SinkInterface}
 *
 * @remarks
 * - **ANSI → `%c` at the sink.** The core produces ANSI strings; this sink parses the SGR runs and
 *   re-emits them as a `console.log`-ready `%c` format string + parallel CSS array ({@link ansiToConsole}
 *   — pure, total, and `%`-safe), so the styling survives the trip to a console that can't render ANSI.
 * - **Routes by level.** `error` → `console.error`, `warn` → `console.warn`, every other level (and an
 *   omitted level) → `console.log` — the SAME routing as core's `createConsoleSink`, so a logger's level
 *   reaches the matching DevTools stream.
 * - **Animation degrade (locked).** A browser console cannot overwrite a line, so a `text` beginning with
 *   a carriage return `\r` (a spinner / progress redraw) has the leading `\r` STRIPPED and is written as a
 *   fresh, non-overwriting line — the locked browser degrade. Only a LEADING `\r` is stripped; an interior
 *   one is left to the console.
 * - **Snapshotted — no capture loop.** It captures `console.log` / `console.warn` / `console.error` AT
 *   CREATION and writes through those references, so a later `Capture` that PATCHES `console.*` can never
 *   feed this sink's output back into itself (the no-capture-loop principle, AGENTS / the core sink's
 *   precedent). Create the sink (or the logger) BEFORE installing a capture.
 *
 * @example
 * ```ts
 * import { createLogger } from '@src/core'
 * import { createBrowserSink } from '@src/browser'
 *
 * const logger = createLogger({ name: 'app', sink: createBrowserSink() })
 * logger.error('boom') // → console.error('%c…', 'color:#cd0000;…') in DevTools
 * ```
 */
export function createBrowserSink(): SinkInterface {
	// Snapshot the three console writers NOW — bound to their `console` receiver — so a later patch of
	// `console.*` (by Capture) can never reach this sink's output (no capture loop), exactly as core's
	// `createConsoleSink` does.
	const log = console.log.bind(console)
	const warn = console.warn.bind(console)
	const error = console.error.bind(console)
	return {
		write(text: string, level?: LogLevel): void {
			// Degrade the animation redraw first: a leading `\r` can't overwrite a line in a browser
			// console, so drop it and write a fresh, non-overwriting line (the locked decision).
			const line = text.startsWith('\r') ? text.slice(1) : text
			const { format, styles } = ansiToConsole(line)
			if (level === 'error') {
				error(format, ...styles)
				return
			}
			if (level === 'warn') {
				warn(format, ...styles)
				return
			}
			log(format, ...styles)
		},
	}
}
