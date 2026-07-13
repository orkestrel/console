import type { RendererInterface, Style } from './types.js'
import { ATTRIBUTE_CODES, BACKGROUND_CODES, CSI, FOREGROUND_CODES, RESET } from './constants.js'

/**
 * The cross-environment default {@link RendererInterface} — renders style DATA as ANSI
 * SGR escape codes, exactly as `Scheduler` is the `setTimeout` default for its seam. It
 * is the single styling output the whole console / terminal system uses in a terminal;
 * the browser `%c` / CSS renderer (the C-f branch) implements the SAME contract over
 * the SAME {@link Style}, so retargeting changes the renderer, never the style model.
 *
 * @remarks
 * - **Style is DATA in, SGR string out.** It reads the style's `foreground` /
 *   `background` / `attributes` and emits one `ESC[…m` sequence whose parameters are the
 *   mapped SGR numbers (foreground 30–37 / 90–97, background 40–47 / 100–107, attributes
 *   1 / 2 / 3 / 4 / 7 / 9), followed by `text`, terminated by the reset `ESC[0m`.
 * - **Multiple attributes compose** — their codes join with `;` in a single sequence
 *   (`ESC[1;4;31m` for bold + underline + red), so one open and one reset wrap the run.
 * - **`default` and unset colors emit no code** — a `default` (or absent) `foreground` /
 *   `background` leaves the terminal's own ink.
 * - **The empty style and the empty string pass through** — when there is nothing to
 *   apply (no colors, no attributes) or `text` is `''`, `text` is returned VERBATIM with
 *   no escape codes, so an unstyled render never injects a stray reset.
 * - **Stateless and event-free** — no fields, no events; safe to share one instance.
 */
export class ANSIRenderer implements RendererInterface {
	/**
	 * Wrap `text` in the SGR codes for `style`. Returns `text` unchanged when the style
	 * is empty or `text` is `''`.
	 */
	render(style: Style, text: string): string {
		if (text === '') return text
		const codes = this.#codes(style)
		if (codes.length === 0) return text
		return `${CSI}${codes.join(';')}m${text}${RESET}`
	}

	// Collect the SGR parameters for a style, in a stable order — attributes first (in
	// their `attributes` order), then foreground, then background. A `default` or absent
	// color contributes nothing; an empty result signals "no wrapping" to `render`.
	#codes(style: Style): readonly number[] {
		const codes: number[] = []
		for (const attribute of style.attributes) codes.push(ATTRIBUTE_CODES[attribute])
		if (style.foreground !== undefined && style.foreground !== 'default') {
			codes.push(FOREGROUND_CODES[style.foreground])
		}
		if (style.background !== undefined && style.background !== 'default') {
			codes.push(BACKGROUND_CODES[style.background])
		}
		return codes
	}
}
