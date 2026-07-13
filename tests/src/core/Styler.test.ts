import type { RendererInterface, Style } from '@src/core'
import { ANSIRenderer, EMPTY_STYLE, Styler, strip } from '@src/core'
import { describe, expect, it } from 'vitest'

// Styler — the fluent, immutable, callable styling surface. Each accessor returns a NEW
// styler's surface (copy-on-write), so chains compose either direction and a base styler
// is reusable. Calling the surface builds a Style and renders it through the injected
// renderer; `enabled: false` returns text verbatim. Tests assert on the style DATA and
// on the ANSI output (the default renderer), plus a recording renderer to prove the seam.

const ESC = '\x1b['
const RESET = '\x1b[0m'

// A renderer that records the exact (style, text) it was handed — proves the styler
// renders DATA through the injected seam rather than baking codes itself.
function createRecordingRenderer(): RendererInterface & { readonly calls: readonly Style[] } {
	const calls: Style[] = []
	return {
		get calls() {
			return calls
		},
		render(style: Style, text: string): string {
			calls.push(style)
			return text
		},
	}
}

function base(): Styler {
	return new Styler(new ANSIRenderer(), true, EMPTY_STYLE)
}

describe('Styler', () => {
	describe('rendering a single token', () => {
		it('applies a foreground color via the ANSI default', () => {
			const styler = base().surface
			expect(styler.red('x')).toBe(`${ESC}31mx${RESET}`)
		})

		it('applies an attribute', () => {
			const styler = base().surface
			expect(styler.bold('x')).toBe(`${ESC}1mx${RESET}`)
		})

		it('a base styler renders nothing — the empty style passes text through', () => {
			const styler = base().surface
			expect(styler('plain')).toBe('plain')
			expect(styler.style).toEqual(EMPTY_STYLE)
		})
	})

	describe('composition', () => {
		it('chains color then attribute: styler.red.bold(text)', () => {
			const styler = base().surface
			expect(styler.red.bold('x')).toBe(`${ESC}1;31mx${RESET}`)
		})

		it('composes either direction — nesting equals chaining', () => {
			const styler = base().surface
			// styler.red(styler.bold(text)) nests two styled runs; styler.red.bold(text) is one.
			// Both render bold+red around the text — assert via strip that the content survives,
			// and that the chained form is the single combined sequence.
			expect(strip(styler.red(styler.bold('x')))).toBe('x')
			expect(styler.red.bold('x')).toBe(`${ESC}1;31mx${RESET}`)
		})

		it('builds the accumulated style DATA, in chain order', () => {
			const styler = base().surface
			expect(styler.red.bold.underline.style).toEqual({
				foreground: 'red',
				attributes: ['bold', 'underline'],
			})
		})

		it('supports background through the style model (programmatic render)', () => {
			const renderer = new ANSIRenderer()
			// The fluent surface exposes foreground + attributes; a background is part of the
			// DATA model and renders through the renderer directly.
			expect(renderer.render({ background: 'red', attributes: [] }, 'x')).toBe(`${ESC}41mx${RESET}`)
		})
	})

	describe('immutability — copy-on-write', () => {
		it('each accessor returns a fresh styler; the base is unchanged', () => {
			const root = base().surface
			const red = root.red
			const redBold = red.bold
			expect(root.style).toEqual(EMPTY_STYLE)
			expect(red.style).toEqual({ foreground: 'red', attributes: [] })
			expect(redBold.style).toEqual({ foreground: 'red', attributes: ['bold'] })
		})

		it('a base styler is reusable — two chains off it never interfere', () => {
			const root = base().surface
			expect(root.red('x')).toBe(`${ESC}31mx${RESET}`)
			expect(root.blue('x')).toBe(`${ESC}34mx${RESET}`)
			// Still neutral after both chains.
			expect(root('x')).toBe('x')
		})

		it('does not mutate the style array it carries forward', () => {
			const red = base().surface.red
			const redBold = red.bold
			// Adding bold produced a new attributes array — red still has none.
			expect(red.style.attributes).toEqual([])
			expect(redBold.style.attributes).toEqual(['bold'])
		})
	})

	describe('precedence + idempotence', () => {
		it('a later color of the same channel wins (last write)', () => {
			const styler = base().surface
			expect(styler.red.blue.style.foreground).toBe('blue')
			expect(styler.red.blue('x')).toBe(`${ESC}34mx${RESET}`)
		})

		it('a repeated attribute is idempotent — carried once', () => {
			const styler = base().surface
			expect(styler.bold.bold.style.attributes).toEqual(['bold'])
			expect(styler.bold.bold('x')).toBe(`${ESC}1mx${RESET}`)
		})

		it('mixing bright and base foregrounds — last write wins', () => {
			const styler = base().surface
			expect(styler.red.brightGreen.style.foreground).toBe('brightGreen')
			expect(styler.red.brightGreen('x')).toBe(`${ESC}92mx${RESET}`)
		})
	})

	describe('enabled switch', () => {
		it('when disabled, returns text verbatim for any chain', () => {
			const styler = new Styler(new ANSIRenderer(), false, EMPTY_STYLE).surface
			expect(styler.red.bold('x')).toBe('x')
			expect(styler.green('hello')).toBe('hello')
			expect(styler.enabled).toBe(false)
		})

		it('when disabled, still tracks the style DATA (only output is suppressed)', () => {
			const styler = new Styler(new ANSIRenderer(), false, EMPTY_STYLE).surface
			expect(styler.red.bold.style).toEqual({ foreground: 'red', attributes: ['bold'] })
		})

		it('an enabled styler reports enabled true', () => {
			expect(base().surface.enabled).toBe(true)
		})
	})

	describe('the renderer seam', () => {
		it('renders the accumulated DATA through the injected renderer, not baked codes', () => {
			const renderer = createRecordingRenderer()
			const styler = new Styler(renderer, true, EMPTY_STYLE).surface
			const out = styler.red.bold('x')
			// The recording renderer returns text unchanged but captured the exact style it got.
			expect(out).toBe('x')
			expect(renderer.calls).toEqual([{ foreground: 'red', attributes: ['bold'] }])
		})

		it('a custom renderer fully retargets output (the %c-style seam)', () => {
			// Stand-in for the future browser renderer: a different target from the SAME DATA.
			const renderer: RendererInterface = {
				render(style: Style, text: string): string {
					const parts = [...style.attributes, style.foreground].filter((p) => p !== undefined)
					return parts.length === 0 ? text : `[${parts.join('+')}]${text}`
				},
			}
			const styler = new Styler(renderer, true, EMPTY_STYLE).surface
			expect(styler.red.bold('x')).toBe('[bold+red]x')
			expect(styler('plain')).toBe('plain')
		})
	})

	describe('chain reuse — a shared base, many independent chains', () => {
		it('a single base styler fans out to many non-interfering chains', () => {
			const root = base().surface
			// Derive several deep, divergent chains off the ONE base; none leaks into another.
			const a = root.red.bold
			const b = root.blue.italic.underline
			const c = root.green
			expect(a.style).toEqual({ foreground: 'red', attributes: ['bold'] })
			expect(b.style).toEqual({ foreground: 'blue', attributes: ['italic', 'underline'] })
			expect(c.style).toEqual({ foreground: 'green', attributes: [] })
			// And the base remains the empty style after all that derivation.
			expect(root.style).toEqual(EMPTY_STYLE)
			expect(root('x')).toBe('x')
		})

		it('a mid-chain styler is itself a reusable base for further divergent chains', () => {
			const red = base().surface.red
			const redBold = red.bold
			const redItalic = red.italic
			// The shared `red` node forks two ways without cross-contamination.
			expect(redBold.style.attributes).toEqual(['bold'])
			expect(redItalic.style.attributes).toEqual(['italic'])
			expect(red.style.attributes).toEqual([]) // the fork point is untouched
		})

		it('every attribute combined with a foreground accumulates in chain order', () => {
			const styler = base().surface
			const all = styler.bold.dim.italic.underline.inverse.strikethrough.red
			expect(all.style).toEqual({
				foreground: 'red',
				attributes: ['bold', 'dim', 'italic', 'underline', 'inverse', 'strikethrough'],
			})
			// Renders as one SGR run: all six attribute codes then the fg, single reset.
			expect(all('x')).toBe(`${ESC}1;2;3;4;7;9;31mx${RESET}`)
		})
	})

	describe('payload text — escapes, percent signs, newlines pass through untouched', () => {
		it('wraps a `%`-laden string verbatim (no printf interpretation — that is the sink/%c layer)', () => {
			const styler = base().surface
			const text = '100% done %s %d %c'
			expect(styler.red(text)).toBe(`${ESC}31m${text}${RESET}`)
			expect(strip(styler.red(text))).toBe(text)
		})

		it('wraps a multi-line string as one run — newlines are part of the payload', () => {
			const styler = base().surface
			const text = 'line one\nline two\n\tindented'
			// One open + the whole (newline-containing) text + one reset — the styler never splits lines.
			expect(styler.bold(text)).toBe(`${ESC}1m${text}${RESET}`)
		})

		it('an enabled styler on the EMPTY (base) style returns text verbatim — no stray codes', () => {
			const styler = base().surface
			// A base styler is enabled but carries the empty style, so its renderer passes text through.
			expect(styler('%d\n%s')).toBe('%d\n%s')
			expect(styler('')).toBe('')
		})

		it('the empty string renders empty even on a fully-styled chain', () => {
			const styler = base().surface
			expect(styler.red.bold.underline('')).toBe('')
		})
	})
})
