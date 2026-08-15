import type { Attribute, Color, RendererInterface, Style, StylerInterface } from './types.js'
import { ATTRIBUTES, COLORS } from './constants.js'
import { ConsoleError } from './errors.js'

/**
 * The fluent, composable styler — the consumer-facing API over the style engine. It
 * builds a {@link Style} (style as DATA) and renders it through an injected
 * {@link RendererInterface} (the ANSI default, or a browser `%c` renderer at C-f). Each
 * color / attribute accessor is immutable copy-on-write: it returns a NEW styler's
 * surface with the token added, so `styler.red.bold('hi')` composes without mutating,
 * and a base styler is freely reusable.
 *
 * @remarks
 * - **Callable surface.** A `Styler` is not itself callable; its {@link surface} getter
 *   returns the {@link StylerInterface} — a render FUNCTION carrying the chainable
 *   accessors. The accessors are installed as LAZY getters (`Object.defineProperties`),
 *   so a chain materializes only the stylers it actually walks — never the full tree —
 *   and the recursion terminates. The factory returns that surface; this class is the
 *   engine behind it.
 * - **Immutable.** `#foreground` and `#attribute` return a fresh `Styler` (the style is
 *   rebuilt, never mutated). A later color of the same channel WINS (last write); a
 *   repeated attribute is idempotent (de-duplicated, order preserved).
 * - **Styling by value.** `render(style, text)` merges a {@link Style} over the accumulated
 *   one and renders that — the same precedence a chain applies, reached with DATA instead of
 *   accessor names. It is how a {@link import('./types.js').Theme} role is drawn.
 * - **`enabled` switch.** When `false`, the render function returns text VERBATIM — no
 *   renderer call, no escape codes (for a non-TTY / `NO_COLOR` / piped output).
 * - **Event-free** — a pure styling primitive (AGENTS §13), like `Scheduler`.
 */
export class Styler {
	readonly #renderer: RendererInterface
	readonly #enabled: boolean
	readonly #style: Style

	constructor(renderer: RendererInterface, enabled: boolean, style: Style) {
		this.#renderer = renderer
		this.#enabled = enabled
		this.#style = style
	}

	/** The accumulated style DATA — the empty style on a base styler. */
	get style(): Style {
		return this.#style
	}

	/** Whether styling is applied; when `false`, the surface returns text unchanged. */
	get enabled(): boolean {
		return this.#enabled
	}

	/**
	 * The fluent {@link StylerInterface} value — a render function (`text => string`) with
	 * `style`, `enabled`, and every {@link Color} / {@link Attribute} as a LAZY accessor
	 * (each computes the next styler's surface only when read). This is what consumers
	 * hold and call.
	 *
	 * @remarks
	 * The accessors are defined as getters (not eagerly-merged values), so accessing one
	 * builds exactly one child styler — the tree is never fully materialized and the
	 * construction terminates. The assembled function is then narrowed to
	 * {@link StylerInterface} through {@link #isSurface} (a real structural check), so no
	 * type assertion is used (AGENTS §1 / §14 — narrow, never assert).
	 */
	get surface(): StylerInterface {
		const callable = this.#render.bind(this)
		const descriptors: PropertyDescriptorMap = {
			style: { value: this.#style, enumerable: true },
			enabled: { value: this.#enabled, enumerable: true },
			render: { value: this.render.bind(this), enumerable: true },
		}
		for (const color of COLORS) {
			descriptors[color] = {
				get: this.#foregroundSurface.bind(this, color),
				enumerable: true,
			}
		}
		for (const attribute of ATTRIBUTES) {
			descriptors[attribute] = {
				get: this.#attributeSurface.bind(this, attribute),
				enumerable: true,
			}
		}
		const surface = Object.defineProperties(callable, descriptors)
		if (this.#isSurface(surface)) return surface
		// Unreachable: the descriptors above install every accessor the guard checks for.
		throw new ConsoleError('INVARIANT', 'console: styler surface construction is incomplete')
	}

	/**
	 * Render `text` in `style` merged OVER the accumulated style — the by-value door beside
	 * the accessor chain, and how a {@link import('./types.js').Theme} role is applied.
	 *
	 * @param style - The style to overlay; its colors win over the accumulated ones and its
	 * attributes join them (de-duplicated, the accumulated ones first)
	 * @param text - The text to wrap
	 * @returns The rendered text — verbatim when `enabled` is `false`, and (by the
	 * {@link RendererInterface} contract) when the merged style or `text` is empty
	 *
	 * @example
	 * ```ts
	 * import { createStyler, DEFAULT_THEME } from '@src/core'
	 *
	 * const styler = createStyler()
	 * styler.render(DEFAULT_THEME.levels.warn, 'WARN') // yellow
	 * styler.bold.render(DEFAULT_THEME.chrome, '│') // dim, over the accumulated bold
	 * ```
	 */
	render(style: Style, text: string): string {
		return this.#enabled ? this.#renderer.render(this.#merge(style), text) : text
	}

	// Render through the configured target, or pass text through when styling is disabled.
	#render(text: string): string {
		return this.#enabled ? this.#renderer.render(this.#style, text) : text
	}

	// Overlay `style` on the accumulated style: a set color of either channel WINS (last
	// write, as in a chain), and the attribute sets union — accumulated order first, the
	// overlay's new ones appended, each carried once. Frozen, like every style this engine
	// builds; the caller's value is read, never touched.
	#merge(style: Style): Style {
		const attributes: Attribute[] = [...this.#style.attributes]
		for (const attribute of style.attributes) {
			if (!attributes.includes(attribute)) attributes.push(attribute)
		}
		return Object.freeze({
			...this.#style,
			...style,
			attributes: Object.freeze(attributes),
		})
	}

	// Resolve one lazy foreground accessor to the next immutable styler surface.
	#foregroundSurface(color: Color): StylerInterface {
		return this.#foreground(color).surface
	}

	// Resolve one lazy attribute accessor to the next immutable styler surface.
	#attributeSurface(attribute: Attribute): StylerInterface {
		return this.#attribute(attribute).surface
	}

	// Structurally confirm an assembled value is a usable styler surface — callable, with
	// the data members and a representative color/attribute accessor present. A genuine
	// runtime narrowing (AGENTS §14), not a cast: it lets `surface` return `StylerInterface`
	// without `as`/`!`.
	#isSurface(value: ((text: string) => string) & object): value is StylerInterface {
		return (
			typeof value === 'function' &&
			'style' in value &&
			'enabled' in value &&
			'render' in value &&
			'red' in value &&
			'bold' in value
		)
	}

	// A new styler with `color` as the foreground — last write wins (replaces any prior
	// foreground); background and attributes carried forward unchanged.
	#foreground(color: Color): Styler {
		return new Styler(
			this.#renderer,
			this.#enabled,
			Object.freeze({ ...this.#style, foreground: color }),
		)
	}

	// A new styler with `attribute` added to the set — de-duplicated and order-stable, so
	// a repeated attribute is idempotent.
	#attribute(attribute: Attribute): Styler {
		if (this.#style.attributes.includes(attribute)) return this
		return new Styler(
			this.#renderer,
			this.#enabled,
			Object.freeze({
				...this.#style,
				attributes: Object.freeze([...this.#style.attributes, attribute]),
			}),
		)
	}
}
