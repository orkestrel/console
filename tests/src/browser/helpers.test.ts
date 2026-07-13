import {
	ansiToConsole,
	BACKGROUND_CSS,
	COLOR_HEX,
	escapePercent,
	FOREGROUND_CSS,
	parseParameters,
} from '@src/browser'
import {
	ATTRIBUTE_CODES,
	ATTRIBUTES,
	BACKGROUND_CODES,
	COLORS,
	CSI,
	ESC,
	FOREGROUND_CODES,
	RESET,
	createStyler,
} from '@src/core'
import { describe, expect, it } from 'vitest'

// The pure browser-console translation (`src/browser/console/helpers.ts`), exercised in real
// headless Chromium. `ansiToConsole` parses the SGR runs a real `@src/core` styler emits and
// re-emits them as a `%c` format string + parallel CSS array; its scan glue (apply / serialize /
// flush) lives as local closures inside it, so the runs through `ansiToConsole` ARE its coverage.
// The standalone `escapePercent` / `parseParameters` utilities are exercised directly. We drive the
// translation with GENUINE ANSI from `createStyler()` (not hand-built escapes), so the test verifies
// the real terminal→browser contract. No console spying here — these are pure functions; the sink's
// console routing is covered in factories.test.ts.

// The load-bearing invariant of the whole translation (the C-f spread `console.log(format,
// ...styles)`): the REAL `%c` count in `format` equals `styles.length`. A literal `%` is doubled
// to `%%`, so a real directive is a `%c` whose `%` is NOT part of an even run of preceding `%`s —
// counting `%c` after collapsing `%%` to nothing isolates the inserted directives from escaped
// literals. Asserting this for every adversarial input is the spine of the suite, so it is one
// inline helper every edge case routes through (AGENTS §16.1).
function expectAligned(text: string): {
	readonly format: string
	readonly styles: readonly string[]
} {
	const result = ansiToConsole(text)
	// Collapse every escaped literal `%%` to empty; any `%c` left is an inserted directive.
	const directives = result.format.replace(/%%/g, '').split('%c').length - 1
	expect(directives).toBe(result.styles.length)
	return result
}

describe('ansiToConsole', () => {
	it('a plain (no-ANSI) string yields { format: text, styles: [] }', () => {
		expect(ansiToConsole('plain text')).toEqual({ format: 'plain text', styles: [] })
	})

	it('the empty string yields { format: "", styles: [] }', () => {
		expect(ansiToConsole('')).toEqual({ format: '', styles: [] })
	})

	it('escapes literal % to %% so it is not read as a console directive', () => {
		expect(ansiToConsole('50% done')).toEqual({ format: '50%% done', styles: [] })
		expect(ansiToConsole('%s and %d')).toEqual({ format: '%%s and %%d', styles: [] })
	})

	it('translates a single styled run from a real styler into one %c segment + its CSS', () => {
		const styler = createStyler()
		const { format, styles } = ansiToConsole(styler.red('alert'))
		expect(format).toBe('%calert')
		expect(styles).toEqual([`color:${COLOR_HEX.red}`])
	})

	it('composes attributes + foreground in stable order (attributes, then color)', () => {
		const styler = createStyler()
		const { format, styles } = ansiToConsole(styler.red.bold('x'))
		expect(format).toBe('%cx')
		expect(styles).toEqual([`font-weight:bold;color:${COLOR_HEX.red}`])
	})

	it('maps a background color to a background:<hex> declaration', () => {
		// SGR background blue = 44; the styler has no bg accessor, so build the run from codes.
		const { format, styles } = ansiToConsole('\x1b[44mbg\x1b[0m')
		expect(format).toBe('%cbg')
		expect(styles).toEqual([`background:${COLOR_HEX.blue}`])
	})

	it('resets the accumulated style on \\x1b[0m so a following run is unstyled', () => {
		const { format, styles } = ansiToConsole('\x1b[31mred\x1b[0mplain')
		// 'red' styled, then 'plain' after the reset gets a %c with empty CSS.
		expect(format).toBe('%cred%cplain')
		expect(styles).toEqual([`color:${COLOR_HEX.red}`, ''])
	})

	it('keeps format %c count exactly equal to styles.length', () => {
		const styler = createStyler()
		const text = `lead ${styler.green('a')} mid ${styler.blue.underline('b')} tail`
		const { format, styles } = ansiToConsole(text)
		const directives = format.split('%c').length - 1
		expect(directives).toBe(styles.length)
	})

	it('escapes % inside a styled run too', () => {
		const styler = createStyler()
		const { format, styles } = ansiToConsole(styler.red('99%'))
		expect(format).toBe('%c99%%')
		expect(styles).toEqual([`color:${COLOR_HEX.red}`])
	})

	it('a later color of the same channel replaces the earlier one within a run', () => {
		// red (31) then blue (34) before any text → blue wins; one run.
		const { format, styles } = ansiToConsole('\x1b[31m\x1b[34mtext\x1b[0m')
		expect(format).toBe('%ctext')
		expect(styles).toEqual([`color:${COLOR_HEX.blue}`])
	})

	it('is total — never throws on adversarial / unterminated escapes', () => {
		expect(() => ansiToConsole('\x1b[')).not.toThrow()
		expect(() => ansiToConsole('\x1b[999m?')).not.toThrow()
		expect(() => ansiToConsole('\x1b')).not.toThrow()
		// A lone ESC with no SGR is treated as literal text (no SGR match).
		expect(ansiToConsole('a\x1bb')).toEqual({ format: 'a\x1bb', styles: [] })
	})

	it('ignores an unrecognized SGR code (e.g. a 256-color extension) without styling', () => {
		// 38;5;200 is an extended-color sequence this layer does not map → no declarations.
		const { format, styles } = ansiToConsole('\x1b[38;5;200mext\x1b[0m')
		expect(format).toBe('%cext')
		expect(styles).toEqual([''])
	})

	it('round-trips a multi-run real-styler string deterministically', () => {
		const styler = createStyler()
		const text = styler.yellow('warn') + ' ' + styler.cyan.bold('info')
		const first = ansiToConsole(text)
		const second = ansiToConsole(text)
		expect(first).toEqual(second)
		// Three runs: the yellow 'warn', the unstyled ' ' between the resets (empty CSS), and the
		// bold-cyan 'info' — the space is its own %c segment because it sits after the first reset.
		expect(first.styles).toEqual([
			`color:${COLOR_HEX.yellow}`,
			'',
			`font-weight:bold;color:${COLOR_HEX.cyan}`,
		])
	})
})

// The %c-count === styles.length invariant under ADVERSARIAL input — the spine of the whole
// translation. Every case drives `ansiToConsole` with a hostile string and asserts (via
// `expectAligned`) that the real `%c` count matches `styles.length` AND that the call never threw
// (totality). These are the cases that would break the `console.log(format, ...styles)` spread if
// the empty-run-drop / escape / unknown-code handling regressed.
describe('ansiToConsole — adversarial %c/styles alignment', () => {
	it('drops empty runs between consecutive SGRs (no text between → no %c)', () => {
		// Three style changes with NO visible text until 'hi' — only ONE %c is emitted.
		const { format, styles } = expectAligned(`${CSI}31m${CSI}1m${CSI}4mhi${RESET}`)
		expect(format).toBe('%chi')
		// red fg + bold + underline accumulated onto the single visible run; attributes serialize in
		// INSERTION order (bold added before underline), then the foreground.
		expect(styles).toEqual([`font-weight:bold;text-decoration:underline;color:${COLOR_HEX.red}`])
	})

	it('a TRAILING SGR with no text after it emits no extra %c', () => {
		// 'done' then a dangling reset (nothing follows) — the trailing run is empty, so dropped.
		const { format, styles } = expectAligned(`${CSI}32mdone${RESET}`)
		expect(format).toBe('%cdone')
		expect(styles).toEqual([`color:${COLOR_HEX.green}`])
	})

	it('a leading SGR before any text never emits a phantom empty %c', () => {
		const { format, styles } = expectAligned(`${CSI}33mtail`)
		expect(format).toBe('%ctail')
		expect(styles).toEqual([`color:${COLOR_HEX.yellow}`])
	})

	it('a string that is ONLY SGR sequences (no text at all) yields zero %c and no styles', () => {
		const result = expectAligned(`${CSI}31m${CSI}1m${RESET}${CSI}4m`)
		expect(result.format).toBe('')
		expect(result.styles).toEqual([])
	})

	it('an UNKNOWN SGR code is ignored but the run still aligns (empty CSS run)', () => {
		// 99 maps to no color/attribute → ignored; the run still emits a %c with empty CSS.
		const { format, styles } = expectAligned(`${CSI}99mhuh${RESET}`)
		expect(format).toBe('%chuh')
		expect(styles).toEqual([''])
	})

	it('an unterminated escape (ESC[ with no final) is left as literal text, no %c', () => {
		const result = expectAligned(`${ESC}[`)
		expect(result.format).toBe(`${ESC}[`)
		expect(result.styles).toEqual([])
	})

	it('a non-SGR CSI final (ESC[99Z, cursor-style) does not match → literal text', () => {
		// SGR_PATTERN requires an `m` terminator; `Z` is not in [0-9;], so no match at all.
		const result = expectAligned(`a${ESC}[99Zb`)
		expect(result.format).toBe(`a${ESC}[99Zb`)
		expect(result.styles).toEqual([])
	})

	it('a bare ESC with no bracket is literal text', () => {
		const result = expectAligned(`x${ESC}y`)
		expect(result.format).toBe(`x${ESC}y`)
		expect(result.styles).toEqual([])
	})

	it('a %-laden styled run doubles every literal % — only the inserted %c is real', () => {
		// Every literal % must double; the count helper proves exactly one real directive.
		const { format, styles } = expectAligned(`${CSI}31m%d %s 50% %%${RESET}`)
		expect(format).toBe('%c%%d %%s 50%% %%%%')
		expect(styles).toEqual([`color:${COLOR_HEX.red}`])
	})

	it('a newline/tab-laden styled run keeps the whitespace verbatim in one %c', () => {
		const { format, styles } = expectAligned(`${CSI}34mline1\n\tline2\r\n${RESET}`)
		expect(format).toBe('%cline1\n\tline2\r\n')
		expect(styles).toEqual([`color:${COLOR_HEX.blue}`])
	})

	it('emoji / CJK / surrogate-pair text in a styled run is preserved exactly', () => {
		const text = '🎉日本語𝕏'
		const { format, styles } = expectAligned(`${CSI}35m${text}${RESET}`)
		expect(format).toBe(`%c${text}`)
		expect(styles).toEqual([`color:${COLOR_HEX.magenta}`])
	})

	it('a deeply-styled string (many runs) keeps every %c aligned with its CSS', () => {
		const styler = createStyler()
		const parts: string[] = []
		for (let index = 0; index < 50; index += 1) {
			const color = COLORS[index % COLORS.length]
			parts.push(styler[color](`r${index}`))
		}
		const { format, styles } = expectAligned(parts.join(''))
		// 50 styled runs, each with text → 50 %c, 50 styles (the in-between resets emit no run).
		expect(styles.length).toBe(50)
		expect(format.match(/%c/g)?.length).toBe(50)
	})

	it('a HUGE input returns promptly and stays aligned (no quadratic blowup)', () => {
		// A long alternating styled/plain string — proves the linear scan handles size. Each chunk is
		// `\x1b[31mx\x1b[0m` + 'y'*20: the styled 'x' is one %c, the plain 'y' run after the reset is a
		// second %c (empty CSS), so a 5000-chunk input yields 10000 aligned style entries.
		const styler = createStyler()
		const chunk = styler.red('x') + 'y'.repeat(20)
		const text = chunk.repeat(5000)
		const started = Date.now()
		const result = expectAligned(text)
		const elapsed = Date.now() - started
		expect(result.styles.length).toBe(10000)
		// Generous ceiling — a linear scan finishes in well under a second even in Chromium.
		expect(elapsed).toBeLessThan(2000)
	})

	it('the empty string short-circuits to { format: "", styles: [] }', () => {
		const result = expectAligned('')
		expect(result).toEqual({ format: '', styles: [] })
	})

	it('a no-SGR string short-circuits (escaped text, no styles)', () => {
		const result = expectAligned('plain 100% text')
		expect(result).toEqual({ format: 'plain 100%% text', styles: [] })
	})

	it('a reset MID-RUN splits into a styled then an unstyled %c, both aligned', () => {
		const { format, styles } = expectAligned(`${CSI}31mred${RESET}plain${CSI}32mgreen${RESET}`)
		expect(format).toBe('%cred%cplain%cgreen')
		expect(styles).toEqual([`color:${COLOR_HEX.red}`, '', `color:${COLOR_HEX.green}`])
	})

	it('an empty field within a parameter list counts as a reset mid-sequence', () => {
		// `31;;1` → [31, 0, 1]: red set, then reset clears it, then bold → only bold survives.
		const { format, styles } = expectAligned(`${CSI}31;;1mx${RESET}`)
		expect(format).toBe('%cx')
		expect(styles).toEqual(['font-weight:bold'])
	})
})

// The SGR → CSS derivation, asserted EXHAUSTIVELY across both color axes and every attribute, so
// the `COLOR_HEX` / `*_CSS` lookups can't silently drift from core's code maps. Each color/attribute
// is driven through a real SGR sequence (built from core's code constants), then the emitted CSS is
// checked against the derived `*_CSS` records and the palette.
describe('ansiToConsole — SGR → CSS derivation', () => {
	it('maps all 16 foreground colors to color:<hex> (fg uses `color:`)', () => {
		for (const color of COLORS) {
			const code = FOREGROUND_CODES[color]
			const { styles } = ansiToConsole(`${CSI}${code}mx${RESET}`)
			expect(styles).toEqual([`color:${COLOR_HEX[color]}`])
			// And the derived FOREGROUND_CSS record agrees with the live translation.
			expect(FOREGROUND_CSS[code]).toBe(`color:${COLOR_HEX[color]}`)
		}
	})

	it('maps all 16 background colors to background:<hex> (bg uses `background:`)', () => {
		for (const color of COLORS) {
			const code = BACKGROUND_CODES[color]
			const { styles } = ansiToConsole(`${CSI}${code}mx${RESET}`)
			expect(styles).toEqual([`background:${COLOR_HEX[color]}`])
			expect(BACKGROUND_CSS[code]).toBe(`background:${COLOR_HEX[color]}`)
		}
	})

	it('maps all 6 text attributes to their CSS declaration', () => {
		const expected: Readonly<Record<string, string>> = {
			bold: 'font-weight:bold',
			dim: 'opacity:0.6',
			italic: 'font-style:italic',
			underline: 'text-decoration:underline',
			inverse: 'filter:invert(100%)',
			strikethrough: 'text-decoration:line-through',
		}
		for (const attribute of ATTRIBUTES) {
			const code = ATTRIBUTE_CODES[attribute]
			const { styles } = ansiToConsole(`${CSI}${code}mx${RESET}`)
			expect(styles).toEqual([expected[attribute]])
		}
	})

	it('a fg + bg + attribute compose in stable order (attributes, fg, bg)', () => {
		const { styles } = ansiToConsole(
			`${CSI}${ATTRIBUTE_CODES.bold}m${CSI}${FOREGROUND_CODES.red}m${CSI}${BACKGROUND_CODES.blue}mx${RESET}`,
		)
		expect(styles).toEqual([`font-weight:bold;color:${COLOR_HEX.red};background:${COLOR_HEX.blue}`])
	})

	it('a reset clears every channel back to empty CSS (text before AND after the reset)', () => {
		// 'styled' carries fg+bg+bold; after the reset, 'after' is an unstyled %c (empty CSS).
		const cleared = ansiToConsole(`${CSI}31m${CSI}44m${CSI}1mstyled${RESET}after`)
		expect(cleared.styles).toEqual([
			`font-weight:bold;color:${COLOR_HEX.red};background:${COLOR_HEX.blue}`,
			'',
		])
	})

	it('a styled run with NO text before its terminating reset emits nothing (empty run dropped)', () => {
		// fg+bg+bold accumulate but no text carries them before the reset clears → only 'after' emits.
		const { styles } = ansiToConsole(`${CSI}31m${CSI}44m${CSI}1m${RESET}after`)
		expect(styles).toEqual([''])
	})

	it('a bare ESC[m is spec-equivalent to a reset', () => {
		const bare = ansiToConsole(`${CSI}31mred${CSI}mplain`)
		expect(bare.styles).toEqual([`color:${COLOR_HEX.red}`, ''])
	})

	it('a later attribute is added once (idempotent within a run)', () => {
		const { styles } = ansiToConsole(`${CSI}1m${CSI}1mx${RESET}`)
		expect(styles).toEqual(['font-weight:bold'])
	})

	it('a later background of the same channel replaces the earlier one', () => {
		const { styles } = ansiToConsole(`${CSI}41m${CSI}44mx${RESET}`)
		expect(styles).toEqual([`background:${COLOR_HEX.blue}`])
	})
})

describe('escapePercent', () => {
	it('doubles every literal %', () => {
		expect(escapePercent('100%')).toBe('100%%')
		expect(escapePercent('a%b%c')).toBe('a%%b%%c')
	})

	it('leaves a %-free string unchanged', () => {
		expect(escapePercent('clean')).toBe('clean')
	})

	it('leaves the empty string unchanged', () => {
		expect(escapePercent('')).toBe('')
	})

	it('doubles an already-doubled %% to %%%% (no special-casing of pairs)', () => {
		// It is a pure per-% doubling, NOT a "skip already-escaped" pass.
		expect(escapePercent('%%')).toBe('%%%%')
	})

	it('doubles a run of consecutive % individually', () => {
		expect(escapePercent('%%%')).toBe('%%%%%%')
	})

	it('escapes a console format token like %c / %s so it is inert', () => {
		expect(escapePercent('%c%s%d')).toBe('%%c%%s%%d')
	})
})

describe('parseParameters', () => {
	it('splits a ;-separated list into numbers', () => {
		expect(parseParameters('1;31')).toEqual([1, 31])
	})

	it('treats an empty parameter list (bare ESC[m) as a reset [0]', () => {
		expect(parseParameters('')).toEqual([0])
	})

	it('treats an empty field within a list as a 0 reset', () => {
		expect(parseParameters('1;;4')).toEqual([1, 0, 4])
	})

	it('parses a single zero as [0] (an explicit reset code)', () => {
		expect(parseParameters('0')).toEqual([0])
	})

	it('parses a trailing empty field as a 0 reset', () => {
		expect(parseParameters('1;')).toEqual([1, 0])
	})

	it('parses a leading empty field as a 0 reset', () => {
		expect(parseParameters(';1')).toEqual([0, 1])
	})

	it('yields NaN for a non-numeric field (which the scanner then ignores)', () => {
		// The SGR scanner never feeds non-digits here (its capture is [0-9;]*), but the parser is
		// total: a stray non-number coerces to NaN, which downstream maps to no CSS → ignored.
		const parsed = parseParameters('1;zz;4')
		expect(parsed[0]).toBe(1)
		expect(Number.isNaN(parsed[1])).toBe(true)
		expect(parsed[2]).toBe(4)
	})

	it('parses multi-digit codes (e.g. bright background 107)', () => {
		expect(parseParameters('107')).toEqual([107])
	})

	it('parses an extended-color triplet verbatim (38;5;200)', () => {
		expect(parseParameters('38;5;200')).toEqual([38, 5, 200])
	})
})
