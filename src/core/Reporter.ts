import type {
	BoxOptions,
	ReporterInterface,
	ReporterOptions,
	SinkInterface,
	StatusLevel,
	StepPosition,
	StylerInterface,
	TableOptions,
	Theme,
	TreeOptions,
} from './types.js'
import { DEFAULT_THEME, DEFAULT_WIDTH } from './constants.js'
import { createConsoleSink, createStyler } from './factories.js'
import { formatDuration, renderBox, renderSeparator, renderTable, renderTree } from './helpers.js'

/**
 * Implements a lean, event-free narrative reporter — the composable verb set for human /
 * build-run output. Each verb formats its line through the shared {@link StylerInterface} and
 * the pure layout renderers ({@link renderSeparator} / {@link renderBox} / {@link renderTable}
 * / {@link renderTree}) and writes it to a {@link SinkInterface} — the same styler + sink
 * substrate the logger uses, never a second colorizer.
 *
 * @remarks
 * - **A small set, not a grab-bag.** `section` / `step` / `timing` / `status` / `table` /
 *   `tree` / `box` / `line` / `blank`. No spinner / bar (the animation chunk), no buffering /
 *   capture (the capture chunk), no level retention (the logger). Format and write, nothing more.
 * - **`status` is a narrative outcome, not a log level.** Its {@link StatusLevel} (`success` /
 *   `error` / `warn` / `info`) is distinct from {@link import('./types.js').LogLevel}: an icon
 *   supplied theme status icon + style, with `error` routed to the sink's
 *   error stream (the `level` hint forwarded to {@link SinkInterface.write}) — there is no
 *   gating and no severity ordering.
 * - **Width-aware.** `section` (and a `box` with no explicit `width`) lay out to the reporter's
 *   `#width`; the renderers measure on visible width (ANSI-aware), so styled content aligns.
 * - **Event-free.** No `#emitter` — a pure formatting front-end with no observable
 *   lifecycle (like the renderers and `Scheduler`). It is reusable and holds no per-call state.
 *
 * @example
 * ```ts
 * const reporter = new Reporter()
 * reporter.section('Build')
 * reporter.step('compiling', { index: 1, total: 3 }) //   [1/3] compiling
 * reporter.timing('bundle', 1234) //   bundle … 1.23s
 * reporter.status('success', 'done') //   ✔ done
 * ```
 */
export class Reporter implements ReporterInterface {
	readonly #sink: SinkInterface
	readonly #styler: StylerInterface
	readonly #theme: Theme
	readonly #width: number

	constructor(options?: ReporterOptions) {
		this.#sink = options?.sink ?? createConsoleSink()
		this.#styler = options?.styler ?? createStyler()
		this.#theme = options?.theme ?? DEFAULT_THEME
		this.#width = options?.width ?? DEFAULT_WIDTH
	}

	section(title: string): void {
		// The theme's chrome role styles the rule and title through the shared styler.
		this.#sink.write(
			renderSeparator({
				title,
				width: this.#width,
				styler: this.#styler,
				style: this.#theme.chrome,
			}),
		)
	}

	step(message: string, position?: StepPosition): void {
		const prefix =
			position === undefined
				? ''
				: `${this.#styler.render(this.#theme.accent, `[${position.index}/${position.total}]`)} `
		this.#sink.write(`${prefix}${message}`)
	}

	timing(label: string, ms: number): void {
		this.#sink.write(
			`${label} ${this.#styler.render(this.#theme.chrome, `… ${formatDuration(ms)}`)}`,
		)
	}

	status(level: StatusLevel, message: string): void {
		const status = this.#theme.statuses[level]
		const line = `${this.#styler.render(status.style, status.icon)} ${this.#styler.render(status.style, message)}`
		// `error` is the one outcome that routes to the sink's error stream; the rest write plain.
		this.#sink.write(line, level === 'error' ? 'error' : undefined)
	}

	table(options: TableOptions): void {
		this.#sink.write(renderTable(this.#resolveStyle(options)))
	}

	tree(options: TreeOptions): void {
		this.#sink.write(renderTree(this.#resolveStyle(options)))
	}

	box(options: BoxOptions): void {
		// Default the box width here; explicit options win.
		this.#sink.write(renderBox(this.#resolveStyle({ width: this.#width, ...options })))
	}

	line(text: string): void {
		this.#sink.write(text)
	}

	blank(count = 1): void {
		for (let index = 0; index < count; index += 1) this.#sink.write('')
	}

	// Use theme chrome only when the caller supplied neither half of the styling decision. The
	// reporter's base styler still renders a caller's by-value style when no caller styler exists.
	#resolveStyle<T extends BoxOptions | TableOptions | TreeOptions>(options: T): T {
		return {
			styler: this.#styler,
			...(options.styler === undefined && options.style === undefined
				? { style: this.#theme.chrome }
				: {}),
			...options,
		}
	}
}
