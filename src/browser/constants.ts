import type { Color } from '@src/core'
import {
	ATTRIBUTE_CODES,
	BACKGROUND_CODES,
	COLORS,
	ESC,
	FOREGROUND_CODES,
	RESET_CODE,
} from '@src/core'

// The SGR → CSS translation DATA the browser sink maps ANSI runs through (the C-f branch).
// The core `src/core/console` is the source of truth for the SGR NUMBERS (which code is which
// color / attribute); this module owns only the BROWSER-side mapping — a named-color → hex
// palette and each SGR number → its CSS declaration — and DERIVES the number→CSS lookups by
// walking core's `COLORS` against its code maps + the palette, so the number↔name mapping is
// never re-hardcoded here. The SGR-scan pattern is built from core's `ESC` so no control-
// character literal appears in source. UPPER_SNAKE, deeply `Object.freeze`d, every member
// exported (AGENTS §5).

/**
 * Each named {@link Color}'s hex value — the 16 standard terminal colors a browser DevTools
 * console renders the SAME {@link Color} names as. The source of truth for the BROWSER color
 * axis: the ANSI renderer maps a `Color` name to an SGR number, and this maps the same name to
 * the CSS color the `%c` sink paints with, so a browser shows the same 16 colors a terminal does.
 *
 * @remarks
 * The conventional VGA/xterm 16-color palette (the base 8 plus their bright variants); `default`
 * is intentionally absent (it leaves the console's own ink and emits no CSS). Deeply frozen.
 */
export const COLOR_HEX: Readonly<Record<Exclude<Color, 'default'>, string>> = Object.freeze({
	black: '#000000',
	red: '#cd0000',
	green: '#00cd00',
	yellow: '#cdcd00',
	blue: '#0000ee',
	magenta: '#cd00cd',
	cyan: '#00cdcd',
	white: '#e5e5e5',
	brightBlack: '#7f7f7f',
	brightRed: '#ff0000',
	brightGreen: '#00ff00',
	brightYellow: '#ffff00',
	brightBlue: '#5c5cff',
	brightMagenta: '#ff00ff',
	brightCyan: '#00ffff',
	brightWhite: '#ffffff',
})

/**
 * Each text-{@link Attribute}'s SGR "on" number → its equivalent CSS declaration — the browser
 * counterpart to the terminal's SGR text effects (`bold` 1 → `font-weight:bold`, `dim` 2 →
 * `opacity:0.6`, `italic` 3 → `font-style:italic`, `underline` 4 → `text-decoration:underline`,
 * `inverse` 7 → best-effort, `strikethrough` 9 → `text-decoration:line-through`). Keyed by the SGR
 * NUMBER (derived from core's {@link ATTRIBUTE_CODES}) so the sink looks a parameter up directly
 * while scanning a run.
 *
 * @remarks
 * `inverse` (SGR 7) has no faithful single-declaration CSS equivalent (it swaps the fore/back inks,
 * which depends on the live colors); it maps to a best-effort `filter:invert(100%)` — documented as
 * approximate, never silently dropped. Deeply frozen.
 */
export const ATTRIBUTE_CSS: Readonly<Record<number, string>> = Object.freeze({
	[ATTRIBUTE_CODES.bold]: 'font-weight:bold',
	[ATTRIBUTE_CODES.dim]: 'opacity:0.6',
	[ATTRIBUTE_CODES.italic]: 'font-style:italic',
	[ATTRIBUTE_CODES.underline]: 'text-decoration:underline',
	[ATTRIBUTE_CODES.inverse]: 'filter:invert(100%)',
	[ATTRIBUTE_CODES.strikethrough]: 'text-decoration:line-through',
})

/**
 * Each SGR FOREGROUND parameter (30–37 / 90–97) → its `color:<hex>` CSS, derived by walking core's
 * {@link COLORS} against {@link FOREGROUND_CODES} and {@link COLOR_HEX} (so the number↔name mapping
 * stays in core, never duplicated here). The sink reads this while scanning a run to translate a
 * foreground code to CSS. A pure build-once expression producing a frozen record (the
 * `DEFAULT_CAPTURE_LEVELS = CAPTURE_LEVELS` precedent — derived data, not new data).
 */
export const FOREGROUND_CSS: Readonly<Record<number, string>> = Object.freeze(
	Object.fromEntries(COLORS.map((color) => [FOREGROUND_CODES[color], `color:${COLOR_HEX[color]}`])),
)

/**
 * Each SGR BACKGROUND parameter (40–47 / 100–107) → its `background:<hex>` CSS, derived by walking
 * core's {@link COLORS} against {@link BACKGROUND_CODES} and {@link COLOR_HEX}. The sink reads this
 * while scanning a run to translate a background code to CSS.
 */
export const BACKGROUND_CSS: Readonly<Record<number, string>> = Object.freeze(
	Object.fromEntries(
		COLORS.map((color) => [BACKGROUND_CODES[color], `background:${COLOR_HEX[color]}`]),
	),
)

/**
 * The SGR RESET parameter (re-exported from core's {@link RESET_CODE}) — when this parameter is seen
 * in a run, the accumulated CSS is cleared back to the empty style. Named here so the scanner reads
 * one local constant rather than the bare number.
 */
export const RESET = RESET_CODE

/**
 * The browser console directive that switches the active style — one `%c` prefixes every styled run
 * in the {@link import('./types.js').ConsoleOutput} format string, consuming the next entry of the
 * parallel CSS array. The single source of truth for the directive token.
 */
export const DIRECTIVE = '%c'

/**
 * Matches one SGR sequence (`ESC[ <params> m`) and CAPTURES its `;`-separated numeric parameters —
 * the subset of ANSI {@link import('@src/core').strip} cares about that carries STYLE (color /
 * attribute / reset), as opposed to cursor / erase / OSC sequences. Global, so the scanner walks
 * every SGR run in a string; built from core's {@link ESC} so no control-character literal appears
 * in source (the codebase idiom). The capture group is the parameter list (`''` for a bare `ESC[m`,
 * which the spec treats as a reset).
 *
 * @remarks
 * A global `RegExp` carries a mutable `lastIndex`; a scan builds a FRESH `RegExp` from this one's
 * `source` + `flags` rather than reuse this instance, so concurrent scans never collide. This is the
 * canonical definition, not a shared scanner.
 */
export const SGR_PATTERN = new RegExp(`${ESC}\\[([0-9;]*)m`, 'g')
