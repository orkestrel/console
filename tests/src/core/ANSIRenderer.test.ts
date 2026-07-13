import type { Style } from '@src/core'
import { ANSIRenderer, EMPTY_STYLE, strip } from '@src/core'
import { describe, expect, it } from 'vitest'

// ANSIRenderer — the cross-environment default renderer. Style DATA in, SGR escape
// string out: foreground 30–37 / 90–97, background 40–47 / 100–107, attributes
// 1/2/3/4/7/9, composed with `;` and terminated by the reset `ESC[0m`. The empty style
// and the empty string pass through verbatim. Pure and stateless.

const ESC = '\x1b['
const RESET = '\x1b[0m'

describe('ANSIRenderer', () => {
	describe('foreground colors', () => {
		it('maps the 8 base colors to SGR 30–37', () => {
			const renderer = new ANSIRenderer()
			expect(renderer.render({ foreground: 'black', attributes: [] }, 'x')).toBe(
				`${ESC}30mx${RESET}`,
			)
			expect(renderer.render({ foreground: 'red', attributes: [] }, 'x')).toBe(`${ESC}31mx${RESET}`)
			expect(renderer.render({ foreground: 'green', attributes: [] }, 'x')).toBe(
				`${ESC}32mx${RESET}`,
			)
			expect(renderer.render({ foreground: 'yellow', attributes: [] }, 'x')).toBe(
				`${ESC}33mx${RESET}`,
			)
			expect(renderer.render({ foreground: 'blue', attributes: [] }, 'x')).toBe(
				`${ESC}34mx${RESET}`,
			)
			expect(renderer.render({ foreground: 'magenta', attributes: [] }, 'x')).toBe(
				`${ESC}35mx${RESET}`,
			)
			expect(renderer.render({ foreground: 'cyan', attributes: [] }, 'x')).toBe(
				`${ESC}36mx${RESET}`,
			)
			expect(renderer.render({ foreground: 'white', attributes: [] }, 'x')).toBe(
				`${ESC}37mx${RESET}`,
			)
		})

		it('maps the 8 bright colors to SGR 90–97', () => {
			const renderer = new ANSIRenderer()
			expect(renderer.render({ foreground: 'brightBlack', attributes: [] }, 'x')).toBe(
				`${ESC}90mx${RESET}`,
			)
			expect(renderer.render({ foreground: 'brightWhite', attributes: [] }, 'x')).toBe(
				`${ESC}97mx${RESET}`,
			)
			expect(renderer.render({ foreground: 'brightRed', attributes: [] }, 'x')).toBe(
				`${ESC}91mx${RESET}`,
			)
		})

		it('emits no code for a default or unset foreground (passes text through)', () => {
			const renderer = new ANSIRenderer()
			expect(renderer.render({ foreground: 'default', attributes: [] }, 'x')).toBe('x')
			expect(renderer.render({ attributes: [] }, 'x')).toBe('x')
		})
	})

	describe('background colors', () => {
		it('maps the base + bright backgrounds to SGR 40–47 / 100–107', () => {
			const renderer = new ANSIRenderer()
			expect(renderer.render({ background: 'red', attributes: [] }, 'x')).toBe(`${ESC}41mx${RESET}`)
			expect(renderer.render({ background: 'white', attributes: [] }, 'x')).toBe(
				`${ESC}47mx${RESET}`,
			)
			expect(renderer.render({ background: 'brightBlue', attributes: [] }, 'x')).toBe(
				`${ESC}104mx${RESET}`,
			)
		})

		it('emits no code for a default or unset background', () => {
			const renderer = new ANSIRenderer()
			expect(renderer.render({ background: 'default', attributes: [] }, 'x')).toBe('x')
		})
	})

	describe('attributes', () => {
		it('maps each attribute to its SGR on-code (1/2/3/4/7/9)', () => {
			const renderer = new ANSIRenderer()
			expect(renderer.render({ attributes: ['bold'] }, 'x')).toBe(`${ESC}1mx${RESET}`)
			expect(renderer.render({ attributes: ['dim'] }, 'x')).toBe(`${ESC}2mx${RESET}`)
			expect(renderer.render({ attributes: ['italic'] }, 'x')).toBe(`${ESC}3mx${RESET}`)
			expect(renderer.render({ attributes: ['underline'] }, 'x')).toBe(`${ESC}4mx${RESET}`)
			expect(renderer.render({ attributes: ['inverse'] }, 'x')).toBe(`${ESC}7mx${RESET}`)
			expect(renderer.render({ attributes: ['strikethrough'] }, 'x')).toBe(`${ESC}9mx${RESET}`)
		})

		it('composes several attributes into one sequence, in their given order', () => {
			const renderer = new ANSIRenderer()
			expect(renderer.render({ attributes: ['bold', 'underline'] }, 'x')).toBe(
				`${ESC}1;4mx${RESET}`,
			)
			// Order follows the attributes list, not a fixed sort.
			expect(renderer.render({ attributes: ['underline', 'bold'] }, 'x')).toBe(
				`${ESC}4;1mx${RESET}`,
			)
		})
	})

	describe('composition order — attributes, then foreground, then background', () => {
		it('emits attributes first, then fg, then bg, joined by ;', () => {
			const renderer = new ANSIRenderer()
			const style: Style = {
				foreground: 'red',
				background: 'white',
				attributes: ['bold', 'underline'],
			}
			expect(renderer.render(style, 'alert')).toBe(`${ESC}1;4;31;47malert${RESET}`)
		})

		it('a single open and a single reset wrap the whole run', () => {
			const renderer = new ANSIRenderer()
			const out = renderer.render({ foreground: 'green', attributes: ['italic'] }, 'hello world')
			expect(out.startsWith(`${ESC}3;32m`)).toBe(true)
			expect(out.endsWith(RESET)).toBe(true)
			// Exactly one reset — not one per code.
			expect(out.split(RESET)).toHaveLength(2)
			expect(strip(out)).toBe('hello world')
		})
	})

	describe('pass-through cases', () => {
		it('the EMPTY style returns text verbatim — no escape codes', () => {
			const renderer = new ANSIRenderer()
			expect(renderer.render(EMPTY_STYLE, 'plain')).toBe('plain')
			expect(renderer.render({ attributes: [] }, 'plain')).toBe('plain')
		})

		it('the empty string returns empty — never an empty styled wrapper', () => {
			const renderer = new ANSIRenderer()
			expect(renderer.render({ foreground: 'red', attributes: ['bold'] }, '')).toBe('')
			expect(renderer.render(EMPTY_STYLE, '')).toBe('')
		})

		it('round-trips through strip back to the original text', () => {
			const renderer = new ANSIRenderer()
			const text = 'The quick brown fox'
			const styled = renderer.render(
				{ foreground: 'magenta', background: 'brightBlack', attributes: ['bold', 'strikethrough'] },
				text,
			)
			expect(strip(styled)).toBe(text)
		})
	})

	describe('exhaustive + payload edge cases', () => {
		it('all six attributes with a fg and a bg compose into one sequence, attrs-first', () => {
			const renderer = new ANSIRenderer()
			const style: Style = {
				foreground: 'cyan',
				background: 'red',
				attributes: ['bold', 'dim', 'italic', 'underline', 'inverse', 'strikethrough'],
			}
			// attributes (1;2;3;4;7;9) then fg (36) then bg (41), one open, one reset.
			expect(renderer.render(style, 'x')).toBe(`${ESC}1;2;3;4;7;9;36;41mx${RESET}`)
		})

		it('a default fg with a real bg emits only the bg code (the default contributes nothing)', () => {
			const renderer = new ANSIRenderer()
			expect(
				renderer.render({ foreground: 'default', background: 'blue', attributes: [] }, 'x'),
			).toBe(`${ESC}44mx${RESET}`)
		})

		it('an attribute with both colors default emits only the attribute code', () => {
			const renderer = new ANSIRenderer()
			expect(
				renderer.render(
					{ foreground: 'default', background: 'default', attributes: ['underline'] },
					'x',
				),
			).toBe(`${ESC}4mx${RESET}`)
		})

		it('wraps a `%`-laden payload verbatim — no format-string interpretation', () => {
			const renderer = new ANSIRenderer()
			const text = '50% off — %s and %d'
			expect(renderer.render({ foreground: 'green', attributes: [] }, text)).toBe(
				`${ESC}32m${text}${RESET}`,
			)
		})

		it('wraps a multi-line payload as a single styled run (newlines preserved inside)', () => {
			const renderer = new ANSIRenderer()
			const text = 'a\nb\nc'
			const out = renderer.render({ attributes: ['bold'] }, text)
			expect(out).toBe(`${ESC}1m${text}${RESET}`)
			// Exactly one reset — the run is not split per line.
			expect(out.split(RESET)).toHaveLength(2)
		})

		it('wraps Unicode (CJK + emoji) payloads without disturbing the content', () => {
			const renderer = new ANSIRenderer()
			const text = '中文 🚀 café'
			expect(strip(renderer.render({ foreground: 'magenta', attributes: ['italic'] }, text))).toBe(
				text,
			)
		})

		it('a duplicated attribute in the list emits its code twice (the renderer trusts the list)', () => {
			// The renderer does not de-duplicate (the Styler does, upstream) — it maps the list as given.
			const renderer = new ANSIRenderer()
			expect(renderer.render({ attributes: ['bold', 'bold'] }, 'x')).toBe(`${ESC}1;1mx${RESET}`)
		})
	})
})
