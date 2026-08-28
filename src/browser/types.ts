// Browser-local types for the `%c` console sink (the browser branch). The core
// `src/core/console` owns the cross-environment contract — `SinkInterface` /
// `LogLevel` / the style data model — and is imported from `@src/core`, never
// redeclared here. The only browser-local type is the shape `ansiToConsole`
// returns and the browser sink's palette options.

import type { Attribute, Color } from '@src/core'

/**
 * Partial browser CSS overrides for the core color and attribute axes. Omitted entries retain the
 * built-in browser mappings, so one override changes only its named value.
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
 * Options for {@link import('./factories.js').createBrowserSink}.
 *
 * @remarks
 * `palette` partially overrides the browser's default color and attribute CSS mappings.
 */
export interface BrowserSinkOptions {
	readonly palette?: BrowserPalette
}

/**
 * The `console.log`-ready output {@link import('./helpers.js').ansiToConsole} produces from
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
 *   (an SGR reset clears it back to `''`). `format`'s `%c` count always equals `styles.length`,
 *   so the spread `console.log(format, ...styles)` lines up exactly.
 */
export interface ConsoleOutput {
	readonly format: string
	readonly styles: readonly string[]
}

/**
 * The immutable accumulator {@link import('./helpers.js').ansiToConsole} carries across a run while
 * translating SGR codes to CSS — a single `foreground` and `background` declaration (each channel
 * replaceable by a later color of the same channel) plus an ordered, de-duplicated list of attribute
 * declarations. An SGR reset empties all three; {@link import('./helpers.js').ansiToConsole} folds
 * it into the `;`-joined CSS string a run emits.
 *
 * @remarks
 * Each SGR sequence produces a new frozen value; earlier run snapshots never drift when a later
 * sequence changes a channel. A channel holds the full CSS declaration (`'color:#cd0000'`, not a
 * bare hex), or `''` when unset.
 * - `foreground` — the current `color:<hex>` declaration, or `''` (unset / post-reset).
 * - `background` — the current `background:<hex>` declaration, or `''`.
 * - `attributes` — the active text-effect declarations in insertion order (`'font-weight:bold'`, …),
 *   each present at most once.
 */
export interface StyleAccumulator {
	readonly foreground: string
	readonly background: string
	readonly attributes: readonly string[]
}
