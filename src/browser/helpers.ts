import type { BrowserPalette, ConsoleOutput, ConsoleSegment, StyleAccumulator } from './types.js'
import {
	ATTRIBUTE_CODES,
	ATTRIBUTES,
	BACKGROUND_CODES,
	COLORS,
	FOREGROUND_CODES,
	RESET_CODE,
} from '@src/core'
import { ATTRIBUTE_CSS, COLOR_HEX, DIRECTIVE, SGR_PATTERN } from './constants.js'

// The pure, browser-only translation behind the `%c` console sink (the browser branch). The core
// styler / Logger / Reporter emit ANSI-styled strings; a DevTools console can't render ANSI but
// can style through `console.log('%ctext', 'css')`, so `ansiToConsole` parses the SGR runs in the
// incoming text and re-emits them as a `%c`-ready format string + parallel CSS array — the
// translation happens at the output boundary, leaving the core unchanged. Pure + total + `%`-safe.
// `ansiToConsole` carries immutable style snapshots while its local arrays assemble the final
// `%c` output; only the standalone, reusable `escapePercent` / `scanParameters` utilities are
// exported alongside it.

/**
 * Translates an ANSI-styled string into a browser `console.log`-ready {@link ConsoleOutput} — a
 * `%c`-segmented format string and the parallel array of CSS declarations, an optional partial
 * {@link BrowserPalette} overriding the CSS per named lookup.
 *
 * @remarks
 * A DevTools console then renders the same styling a terminal would; the browser sink calls
 * `console[method](format, ...styles)`.
 *
 * - **SGR runs → `%c` segments.** The text is scanned for SGR sequences ({@link SGR_PATTERN} —
 *   `ESC[…m`); each delimits a run. A run carrying visible text emits one `%c` directive plus that
 *   text into `format` and the run's accumulated CSS into `styles`, so the browser switches style at
 *   each `%c`. Foreground / background / attribute codes accumulate; the reset code (`0`, or a bare
 *   `ESC[m`) clears the accumulated style back to none. A later color of the same channel replaces
 *   the earlier one; an attribute is added once. Non-SGR escapes (cursor / erase / OSC) are not style
 *   and are left in the text verbatim.
 * - **`%`-safe.** Every literal `%` in the text is doubled to `%%` so the console never treats it as
 *   a directive — only the `%c`s this function inserts are real directives. So `format`'s real `%c`
 *   count always equals `styles.length`, and `console.log(format, ...styles)` lines up exactly.
 * - **Plain text short-circuits.** A string with no SGR sequence yields `{ format: <escaped text>,
 *   styles: [] }` — no `%c`, no styles (the text is still `%`-escaped).
 * - **Partial palette.** A supplied palette overrides only its named colors and attributes. Every
 *   omitted entry resolves through {@link COLOR_HEX} or {@link ATTRIBUTE_CSS}, so defaults and
 *   unrelated entries stay byte-identical.
 * - **Pure + total.** Same input → same output; it never throws on any string (adversarial escapes,
 *   lone `ESC`, unterminated sequences all fall through as literal text).
 *
 * @param text - Any string, ANSI-styled or plain
 * @param palette - Optional partial browser CSS overrides
 * @returns The `%c` format string + parallel CSS array ({@link ConsoleOutput})
 *
 * @example
 * ```ts
 * ansiToConsole('\x1b[31mred\x1b[0m') // { format: '%cred', styles: ['color:#cd0000'] }
 * ansiToConsole('plain') // { format: 'plain', styles: [] }
 * ansiToConsole('50%') // { format: '50%%', styles: [] }
 * ```
 */
export function ansiToConsole(text: string, palette?: BrowserPalette): ConsoleOutput {
	const matches = [...text.matchAll(new RegExp(SGR_PATTERN.source, SGR_PATTERN.flags))]
	if (matches.length === 0) return { format: escapePercent(text), styles: [] }
	const initial: StyleAccumulator = Object.freeze({ attributes: Object.freeze([]) })
	const output: ConsoleSegment[] = []
	for (const match of [...matches, undefined]) {
		const previous = output.at(-1) ?? { active: initial, cursor: 0 }
		const segment = escapePercent(text.slice(previous.cursor, match?.index ?? text.length))
		const declarations = [
			...previous.active.attributes,
			...(previous.active.foreground === undefined ? [] : [previous.active.foreground]),
			...(previous.active.background === undefined ? [] : [previous.active.background]),
		]
		const active = scanParameters(match?.[1] ?? '').reduce<StyleAccumulator>((style, code) => {
			if (code === RESET_CODE) return initial
			const foreground = COLORS.find((color) => FOREGROUND_CODES[color] === code)
			if (foreground !== undefined) {
				const color = palette?.color?.[foreground] ?? COLOR_HEX[foreground]
				return Object.freeze({ ...style, foreground: `color:${color}` })
			}
			const background = COLORS.find((color) => BACKGROUND_CODES[color] === code)
			if (background !== undefined) {
				const color = palette?.color?.[background] ?? COLOR_HEX[background]
				return Object.freeze({ ...style, background: `background:${color}` })
			}
			const name = ATTRIBUTES.find((attribute) => ATTRIBUTE_CODES[attribute] === code)
			const attribute =
				name === undefined ? undefined : (palette?.attribute?.[name] ?? ATTRIBUTE_CSS[code])
			return attribute === undefined || style.attributes.includes(attribute)
				? style
				: Object.freeze({ ...style, attributes: Object.freeze([...style.attributes, attribute]) })
		}, previous.active)
		output.push({
			active,
			cursor: match === undefined ? text.length : match.index + match[0].length,
			text: segment,
			style: declarations.join(';'),
		})
	}
	const visible = output.filter((segment) => segment.text !== '')
	return {
		format: visible.map((segment) => `${DIRECTIVE}${segment.text}`).join(''),
		styles: visible.map((segment) => segment.style),
	}
}

/**
 * Doubles every literal `%` in `text` to `%%` — the `%`-escape that keeps a browser console from
 * reading a stray `%` (for example in `50%` or `%s`) as a format directive. The single escape the
 * {@link ansiToConsole} translation applies to every text segment before assembling the format
 * string (so only the `%c`s it inserts are real directives).
 *
 * @param text - A literal text segment (no inserted directives)
 * @returns `text` with each `%` doubled
 *
 * @example
 * ```ts
 * escapePercent('100% done') // '100%% done'
 * ```
 */
export function escapePercent(text: string): string {
	return text.replace(/%/g, '%%')
}

/**
 * Walks an SGR parameter list (the `;`-separated numeric string captured by {@link SGR_PATTERN})
 * and returns its numeric codes — `'1;31'` → `[1, 31]`, a bare or empty field becoming a `0`
 * reset. It is total: every input yields a code list.
 *
 * @param parameters - The raw `;`-separated parameter string (the regex capture)
 * @returns The SGR codes found (a parameterless / empty field becoming `0`)
 *
 * @remarks
 * An empty list (a bare `ESC[m`) yields `[0]`, because the SGR spec treats a parameterless
 * sequence as a reset; an empty field within a list (`'1;;4'`) likewise counts as a `0` reset,
 * matching the spec, and a non-numeric field yields `NaN`, which the caller then ignores.
 *
 * @example
 * ```ts
 * scanParameters('1;31') // [1, 31]
 * scanParameters('') // [0]
 * ```
 */
export function scanParameters(parameters: string): readonly number[] {
	if (parameters === '') return [RESET_CODE]
	return parameters.split(';').map((field) => (field === '' ? RESET_CODE : Number(field)))
}
