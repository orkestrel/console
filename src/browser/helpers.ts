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
// `ansiToConsole`'s scan glue (apply / serialize / flush over its own `active` / `segments` /
// `styles` state) lives as local closures inside it (AGENTS §5); only the standalone, reusable
// `escapePercent` / `parseParameters` utilities are exported alongside it.

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
	const active: StyleAccumulator = { foreground: '', background: '', attributes: [] }
	const segments: string[] = []
	const styles: string[] = []
	let styled = false
	let cursor = 0
	let pending = ''

	// Apply one SGR sequence's `codes` to `active` (in place): a reset clears every channel; a
	// foreground / background code REPLACES that channel; an attribute is added once (idempotent).
	// An unrecognized code (a 256-color / truecolor extension this layer doesn't map) is ignored,
	// never raised — keeping the translation total.
	const apply = (codes: readonly number[]): void => {
		for (const code of codes) {
			if (code === RESET_CODE) {
				active.foreground = ''
				active.background = ''
				active.attributes.length = 0
				continue
			}
			const foreground = FOREGROUND_CSS[code]
			if (foreground !== undefined) {
				active.foreground = foreground
				continue
			}
			const background = BACKGROUND_CSS[code]
			if (background !== undefined) {
				active.background = background
				continue
			}
			const attribute = ATTRIBUTE_CSS[code]
			if (attribute !== undefined && !active.attributes.includes(attribute)) {
				active.attributes.push(attribute)
			}
		}
	}

	// Serialize `active` into one `;`-joined CSS declaration string — attributes (insertion order),
	// then foreground, then background, mirroring the renderer's stable code order; an empty style
	// (post-reset / nothing accumulated) serializes to `''`.
	const serialize = (): string => {
		const declarations = [...active.attributes]
		if (active.foreground !== '') declarations.push(active.foreground)
		if (active.background !== '') declarations.push(active.background)
		return declarations.join(';')
	}

	// Push `pending` (the run's already-escaped text) as one `%c` segment paired with the run's
	// current CSS, then clear `pending`. An EMPTY run is dropped (a style change with no visible text
	// emits no `%c`), keeping `format`'s `%c` count exactly equal to `styles.length`.
	const flush = (): void => {
		if (pending === '') return
		segments.push(`${DIRECTIVE}${pending}`)
		styles.push(serialize())
		pending = ''
	}

	for (let match = scanner.exec(text); match !== null; match = scanner.exec(text)) {
		styled = true
		pending += escapePercent(text.slice(cursor, match.index))
		flush()
		apply(parseParameters(match[1] ?? ''))
		cursor = match.index + match[0].length
	}
	if (!styled) return { format: escapePercent(text), styles: [] }
	pending += escapePercent(text.slice(cursor))
	flush()
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
