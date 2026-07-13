// Browser-local types for the `%c` console sink (the C-f branch). The core
// `src/core/console` owns the cross-environment contract — `SinkInterface` /
// `LogLevel` / the style DATA model — and is IMPORTED from `@src/core`, never
// redeclared here. The only browser-local type is the shape `ansiToConsole`
// returns: a `console.log`-ready format string paired with its parallel CSS array.

/**
 * The `console.log`-ready output {@link import('./helpers.js').ansiToConsole} produces from
 * an ANSI-styled string — a format string of `%c`-prefixed segments and the parallel array
 * of CSS declarations, ready to spread into a browser `console` call as
 * `console.log(format, ...styles)`.
 *
 * @remarks
 * - `format` — the text with each styled run prefixed by one `%c` directive (the directive
 *   the browser console consumes to switch the active style) and every LITERAL `%` doubled to
 *   `%%` so it is not mistaken for a directive. A plain (no-ANSI) input yields the text
 *   verbatim with NO `%c` and an empty `styles` (still `%`-escaped).
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
 * The mutable accumulator {@link import('./helpers.js').ansiToConsole} carries across a run while
 * translating SGR codes to CSS — a single `foreground` and `background` declaration (each channel
 * REPLACEABLE by a later color of the same channel) plus an ordered, de-duplicated list of attribute
 * declarations. An SGR reset empties all three; {@link import('./helpers.js').ansiToConsole} folds
 * it into the `;`-joined CSS string a run emits.
 *
 * @remarks
 * Mutable BY DESIGN — it is internal scan state the scanner updates in place per SGR sequence (the
 * one place this surface departs from the `readonly` default, AGENTS §11), never a returned value. A
 * channel holds the FULL CSS declaration (`'color:#cd0000'`, not a bare hex), or `''` when unset.
 * - `foreground` — the current `color:<hex>` declaration, or `''` (unset / post-reset).
 * - `background` — the current `background:<hex>` declaration, or `''`.
 * - `attributes` — the active text-effect declarations in insertion order (`'font-weight:bold'`, …),
 *   each present at most once.
 */
export interface StyleAccumulator {
	foreground: string
	background: string
	attributes: string[]
}
