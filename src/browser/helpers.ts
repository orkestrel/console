import type { ConsoleOutput, StyleAccumulator } from './types.js'
import { RESET_CODE } from '@src/core'
import {
	ATTRIBUTE_CSS,
	BACKGROUND_CSS,
	DIRECTIVE,
	FOREGROUND_CSS,
	SGR_PATTERN,
} from './constants.js'

// The pure, browser-only translation behind the `%c` console sink (the C-f branch). The core
// styler / Logger / Reporter emit ANSI-styled STRINGS; a DevTools console can't render ANSI but
// can style via `console.log('%ctext', 'css')`, so `ansiToConsole` parses the SGR runs in the
// incoming text and re-emits them as a `%c`-ready format string + parallel CSS array — the
// translation happens at the OUTPUT boundary, leaving the core unchanged. Pure + total + `%`-safe.
// `ansiToConsole` carries immutable style snapshots while its local arrays assemble the final
// `%c` output; only the standalone, reusable `escapePercent` / `parseParameters` utilities are
// exported alongside it.

/**
 * Translate an ANSI-styled string into a browser `console.log`-ready {@link ConsoleOutput} — a
 * `%c`-segmented format string and the parallel array of CSS declarations, so a DevTools console
 * renders the SAME styling a terminal would (the C-f sink calls `console[method](format, ...styles)`).
 *
 * @remarks
 * - **SGR runs → `%c` segments.** The text is scanned for SGR sequences ({@link SGR_PATTERN} —
 *   `ESC[…m`); each delimits a run. A run carrying VISIBLE text emits one `%c` directive plus that
 *   text into `format` and the run's accumulated CSS into `styles`, so the browser switches style at
 *   each `%c`. Foreground / background / attribute codes accumulate; the reset code (`0`, or a bare
 *   `ESC[m`) clears the accumulated style back to none. A later color of the same channel REPLACES
 *   the earlier one; an attribute is added once. Non-SGR escapes (cursor / erase / OSC) are not style
 *   and are left in the text verbatim.
 * - **`%`-safe.** Every LITERAL `%` in the text is doubled to `%%` so the console never treats it as
 *   a directive — only the `%c`s this function inserts are real directives. So `format`'s real `%c`
 *   count always equals `styles.length`, and `console.log(format, ...styles)` lines up exactly.
 * - **Plain text short-circuits.** A string with NO SGR sequence yields `{ format: <escaped text>,
 *   styles: [] }` — no `%c`, no styles (the text is still `%`-escaped).
 * - **Pure + total.** Same input → same output; it never throws on any string (adversarial escapes,
 *   lone `ESC`, unterminated sequences all fall through as literal text).
 *
 * @param text - Any string, ANSI-styled or plain
 * @returns The `%c` format string + parallel CSS array ({@link ConsoleOutput})
 *
 * @example
 * ```ts
 * ansiToConsole('\x1b[31mred\x1b[0m') // { format: '%cred', styles: ['color:#cd0000'] }
 * ansiToConsole('plain') // { format: 'plain', styles: [] }
 * ansiToConsole('50%') // { format: '50%%', styles: [] }
 * ```
 */
export function ansiToConsole(text: string): ConsoleOutput {
	const scanner = new RegExp(SGR_PATTERN.source, SGR_PATTERN.flags)
	// The accumulated active style across a run — a separate foreground / background declaration
	// (each channel REPLACEABLE) plus an ordered, de-duplicated list of attribute declarations. An
	// SGR reset empties all three. Serialized to a `;`-joined CSS string per emitted run.
	let active: StyleAccumulator = Object.freeze({
		foreground: '',
		background: '',
		attributes: Object.freeze([]),
	})
	const segments: string[] = []
	const styles: string[] = []
	let cursor = 0
	let pending = ''
	let match: RegExpExecArray | null = scanner.exec(text)
	if (match === null) return { format: escapePercent(text), styles: [] }

	// A null match is the final text boundary, so every visible run passes through one flush path.
	while (true) {
		const boundary = match === null ? text.length : match.index
		pending += escapePercent(text.slice(cursor, boundary))
		if (pending !== '') {
			segments.push(`${DIRECTIVE}${pending}`)
			const declarations = [...active.attributes]
			if (active.foreground !== '') declarations.push(active.foreground)
			if (active.background !== '') declarations.push(active.background)
			styles.push(declarations.join(';'))
			pending = ''
		}
		if (match === null) break

		// Apply one SGR sequence by replacing the readonly accumulator. A reset clears every channel;
		// colors replace their channel; attributes accumulate once; unknown extensions are ignored.
		for (const code of parseParameters(match[1] ?? '')) {
			if (code === RESET_CODE) {
				active = Object.freeze({
					foreground: '',
					background: '',
					attributes: Object.freeze([]),
				})
				continue
			}
			const foreground = FOREGROUND_CSS[code]
			if (foreground !== undefined) {
				active = Object.freeze({ ...active, foreground })
				continue
			}
			const background = BACKGROUND_CSS[code]
			if (background !== undefined) {
				active = Object.freeze({ ...active, background })
				continue
			}
			const attribute = ATTRIBUTE_CSS[code]
			if (attribute !== undefined && !active.attributes.includes(attribute)) {
				active = Object.freeze({
					...active,
					attributes: Object.freeze([...active.attributes, attribute]),
				})
			}
		}
		cursor = match.index + match[0].length
		match = scanner.exec(text)
	}
	return { format: segments.join(''), styles }
}

/**
 * Double every literal `%` in `text` to `%%` — the `%`-escape that keeps a browser console from
 * reading a stray `%` (e.g. in `50%` or `%s`) as a format directive. The single escape the
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
 * Parse an SGR parameter list (the `;`-separated numeric string captured by {@link SGR_PATTERN})
 * into its numeric codes — `'1;31'` → `[1, 31]`. An EMPTY list (a bare `ESC[m`) yields `[0]`, since
 * the SGR spec treats a parameterless sequence as a reset; an empty field within a list (`'1;;4'`)
 * likewise counts as a `0` reset, matching the spec.
 *
 * @param parameters - The raw `;`-separated parameter string (the regex capture)
 * @returns The parsed SGR codes (a parameterless / empty field becoming `0`)
 *
 * @example
 * ```ts
 * parseParameters('1;31') // [1, 31]
 * parseParameters('') // [0]
 * ```
 */
export function parseParameters(parameters: string): readonly number[] {
	if (parameters === '') return [RESET_CODE]
	return parameters.split(';').map((field) => (field === '' ? RESET_CODE : Number(field)))
}
