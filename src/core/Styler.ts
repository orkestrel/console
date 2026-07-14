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
		const render = (text: string): string =>
			this.#enabled ? this.#renderer.render(this.#style, text) : text
		const descriptors: PropertyDescriptorMap = {
			style: { value: this.#style, enumerable: true },
			enabled: { value: this.#enabled, enumerable: true },
		}
		for (const color of COLORS) {
			descriptors[color] = { get: () => this.#foreground(color).surface, enumerable: true }
		}
		for (const attribute of ATTRIBUTES) {
			descriptors[attribute] = { get: () => this.#attribute(attribute).surface, enumerable: true }
		}
		const surface = Object.defineProperties(render, descriptors)
		if (this.#isSurface(surface)) return surface
		// Unreachable: the descriptors above install every accessor the guard checks for.
		throw new ConsoleError('INVARIANT', 'console: styler surface construction is incomplete')
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
