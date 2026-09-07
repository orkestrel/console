// Browser-local types for the `%c` console sink (the browser branch). The core
// `src/core/console` owns the cross-environment contract — `SinkInterface` /
// `LogLevel` / the style data model — and is imported from `@src/core`, never
// redeclared here. The only browser-local type is the shape `ansiToConsole`
// returns and the browser sink's palette options.

import type { Attribute, Color } from '@src/core'

/**
 * Holds partial browser CSS overrides for the core color and attribute axes — a named `color` or
 * `attribute` entry replaces only that entry, and every omission keeps its default.
 *
 * @remarks
 * - `color` maps a named non-default {@link Color} to the CSS color value used for both foreground
 *   and background SGR codes.
 * - `attribute` maps an {@link Attribute} to the CSS declaration used for its SGR code.
 */
export interface BrowserPalette {
	readonly color?: Readonly<Partial<Record<Exclude<Color, 'default'>, string>>>
	readonly attribute?: Readonly<Partial<Record<Attribute, string>>>
}

/**
 * Configures `createBrowserSink` — the optional `palette` partially overriding the browser's
 * named color and attribute CSS mappings.
 */
export interface BrowserSinkOptions {
	readonly palette?: BrowserPalette
}

/**
 * Represents the `console.log`-ready output `ansiToConsole` produces from
 * an ANSI-styled string — a format string of `%c`-prefixed segments and the parallel array
 * of CSS declarations, ready to spread into a browser `console` call as
 * `console.log(format, ...styles)`.
 *
 * @remarks
 * - `format` — the text with each styled run prefixed by one `%c` directive (the directive
 *   the browser console consumes to switch the active style) and every literal `%` doubled to
 *   `%%` so it is not mistaken for a directive. A plain (no-ANSI) input yields the text
 *   verbatim with no `%c` and an empty `styles` (still `%`-escaped).
 * - `styles` — one CSS declaration string per `%c` in `format`, in order: the browser applies
 *   `styles[n]` from the n-th `%c` onward. Each entry is the accumulated style for that run
 *   (an SGR reset clears it back to the empty declaration string). `format`'s `%c` count always
 *   equals `styles.length`, so the spread `console.log(format, ...styles)` lines up exactly.
 */
export interface ConsoleOutput {
	readonly format: string
	readonly styles: readonly string[]
}

/**
 * Represents the immutable scan state `ansiToConsole` replaces while translating SGR codes to
 * CSS — an optional `foreground` and `background` declaration plus a readonly list of attribute
 * declarations.
 *
 * @remarks
 * A later color of the same channel replaces that channel; an SGR reset drops both channels and
 * empties the list; `ansiToConsole` folds the state into the `;`-joined CSS string a run emits.
 *
 * Each SGR sequence produces a new frozen value; earlier run snapshots never drift when a later
 * sequence changes a channel. A channel holds the full CSS declaration (`'color:#cd0000'`, not a
 * bare hex), and is absent when unset.
 * - `foreground` — the current `color:<hex>` declaration; absent when unset or after a reset.
 * - `background` — the current `background:<hex>` declaration; absent on the same terms.
 * - `attributes` — the active text-effect declarations in insertion order (`'font-weight:bold'`, …),
 *   each present at most once.
 */
export interface StyleAccumulator {
	readonly foreground?: string
	readonly background?: string
	readonly attributes: readonly string[]
}
