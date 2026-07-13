import type {
	BoxOptions,
	ReporterInterface,
	ReporterOptions,
	SinkInterface,
	StatusLevel,
	StepPosition,
	StylerInterface,
	TableOptions,
	TreeOptions,
} from './types.js'
import { DEFAULT_WIDTH, STATUS_COLORS, STATUS_ICONS } from './constants.js'
import { createConsoleSink, createStyler } from './factories.js'
import { formatDuration, renderBox, renderSeparator, renderTable, renderTree } from './helpers.js'

/**
 * A lean, event-free narrative reporter (AGENTS §13) — the composable verb set for human /
 * build-run output. Each verb FORMATS its line through the shared {@link StylerInterface} and
 * the pure layout renderers ({@link renderSeparator} / {@link renderBox} / {@link renderTable}
 * / {@link renderTree}) and WRITES it to a {@link SinkInterface} — the SAME styler + sink
 * substrate the logger uses, never a second colorizer.
 *
 * @remarks
 * - **A SMALL set, not a grab-bag.** `section` / `step` / `timing` / `status` / `table` /
 *   `tree` / `box` / `line` / `blank`. No spinner / bar (the animation chunk), no buffering /
 *   capture (the capture chunk), no level retention (the logger). Just format + write.
 * - **`status` is a narrative OUTCOME, not a log level.** Its {@link StatusLevel} (`success` /
 *   `error` / `warn` / `info`) is distinct from {@link import('./types.js').LogLevel}: an icon
 *   ({@link STATUS_ICONS}) + a color ({@link STATUS_COLORS}), with `error` routed to the sink's
 *   error stream (the `level` hint forwarded to {@link SinkInterface.write}) — there is no
 *   gating and no severity ordering.
 * - **Width-aware.** `section` (and a `box` with no explicit `width`) lay out to the reporter's
 *   `#width`; the renderers measure on VISIBLE width (ANSI-aware), so styled content aligns.
 * - **Event-free (§13).** No `#emitter` — a pure formatting front-end with no observable
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
	readonly #width: number

	constructor(options?: ReporterOptions) {
		this.#sink = options?.sink ?? createConsoleSink()
		this.#styler = options?.styler ?? createStyler()
		this.#width = options?.width ?? DEFAULT_WIDTH
	}

	section(title: string): void {
		// The rule is dimmed chrome; the styler colors with its accumulated chain, so a base
		// styler is given a concrete `.dim` treatment (exactly as the logger dims its timestamp).
		this.#sink.write(renderSeparator({ title, width: this.#width, styler: this.#styler.dim }))
	}

	step(message: string, position?: StepPosition): void {
		const prefix =
			position === undefined ? '' : `${this.#styler.cyan(`[${position.index}/${position.total}]`)} `
		this.#sink.write(`${prefix}${message}`)
	}

	timing(label: string, ms: number): void {
		this.#sink.write(`${label} ${this.#styler.dim(`… ${formatDuration(ms)}`)}`)
	}

	status(level: StatusLevel, message: string): void {
		const color = this.#styler[STATUS_COLORS[level]]
		const line = `${color(STATUS_ICONS[level])} ${color(message)}`
		// `error` is the one outcome that routes to the sink's error stream; the rest write plain.
		this.#sink.write(line, level === 'error' ? 'error' : undefined)
	}

	table(options: TableOptions): void {
		// Frame + header dimmed by default (the `.dim` chain); a caller's own `options.styler` wins.
		this.#sink.write(renderTable({ styler: this.#styler.dim, ...options }))
	}

	tree(options: TreeOptions): void {
		this.#sink.write(renderTree({ styler: this.#styler.dim, ...options }))
	}

	box(options: BoxOptions): void {
		// Default the box to the reporter's width + a dimmed frame; an explicit option in `options` wins.
		this.#sink.write(renderBox({ width: this.#width, styler: this.#styler.dim, ...options }))
	}

	line(text: string): void {
		this.#sink.write(text)
	}

	blank(count = 1): void {
		for (let index = 0; index < count; index += 1) this.#sink.write('')
	}
}
