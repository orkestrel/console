import type {
	CaptureInterface,
	CaptureOptions,
	LoggerInterface,
	LoggerManagerInterface,
	LoggerManagerOptions,
	LoggerOptions,
	LogLevel,
	ProgressInterface,
	ProgressOptions,
	RendererInterface,
	ReporterInterface,
	ReporterOptions,
	SinkInterface,
	SpinnerInterface,
	SpinnerOptions,
	StylerInterface,
	StylerOptions,
	Theme,
	ThemeOptions,
} from './types.js'
import { ANSIRenderer } from './ANSIRenderer.js'
import { Capture } from './Capture.js'
import { DEFAULT_THEME, EMPTY_STYLE, LEVELS, STATUS_LEVELS } from './constants.js'
import { freezeStyle } from './helpers.js'
import { Logger } from './Logger.js'
import { LoggerManager } from './LoggerManager.js'
import { Progress } from './Progress.js'
import { Reporter } from './Reporter.js'
import { Spinner } from './Spinner.js'
import { Styler } from './Styler.js'

/**
 * Create the cross-environment default {@link RendererInterface} — the ANSI / SGR
 * renderer that turns style DATA into terminal escape codes. The default behind
 * {@link createStyler}; construct one directly to render a {@link import('./types.js').Style}
 * without the fluent surface, or to share one instance across stylers.
 *
 * @returns A stateless ANSI {@link RendererInterface}
 *
 * @example
 * ```ts
 * import { createANSIRenderer } from '@src/core'
 *
 * const renderer = createANSIRenderer()
 * renderer.render({ foreground: 'red', attributes: ['bold'] }, 'alert') // '\x1b[1;31malert\x1b[0m'
 * ```
 */
export function createANSIRenderer(): RendererInterface {
	return new ANSIRenderer()
}

/**
 * Create the fluent, composable {@link StylerInterface} — the consumer-facing styling
 * API. It builds a {@link import('./types.js').Style} under the hood and renders it
 * through a {@link RendererInterface} (the ANSI default), so `styler.red.bold('hi')`
 * yields styled text. Chains are immutable, so a base styler is freely reusable.
 *
 * @param options - See {@link StylerOptions}
 * @returns A base {@link StylerInterface}
 *
 * @remarks
 * - `options.renderer` swaps the output target without touching the style model — pass a
 *   browser `%c` / CSS renderer (the C-f branch) to retarget; defaults to the ANSI
 *   renderer (the cross-environment default).
 * - `options.enabled` is the no-color switch: when `false`, the styler returns text
 *   VERBATIM (for a non-TTY, `NO_COLOR`, or piped output); defaults to `true`.
 *
 * @example
 * ```ts
 * import { createStyler } from '@src/core'
 *
 * const style = createStyler()
 * style.red.bold('error') // bold red
 * style.red(style.underline('link')) // composes either way
 *
 * // Disable for a non-TTY — every call returns its text unchanged.
 * const plain = createStyler({ enabled: false })
 * plain.green('ok') // 'ok'
 * ```
 */
export function createStyler(options?: StylerOptions): StylerInterface {
	const renderer = options?.renderer ?? new ANSIRenderer()
	const enabled = options?.enabled ?? true
	return new Styler(renderer, enabled, EMPTY_STYLE).surface
}

/**
 * Create a {@link Theme} — the app-wide semantic style vocabulary, merged role by role over
 * {@link DEFAULT_THEME}. Hand one theme to a logger / reporter / spinner / progress and every
 * surface speaks it; omit `options` for the defaults.
 *
 * @param options - See {@link ThemeOptions}
 * @returns A frozen {@link Theme}
 *
 * @remarks
 * - **Merges per ROLE, not per theme.** An omitted role keeps its default, and `levels` /
 *   `statuses` merge per ENTRY — `{ levels: { warn: … } }` restyles the `warn` label and
 *   leaves `debug` / `info` / `error` untouched.
 * - **Frozen and shareable.** The factory snapshots and deep-freezes every style leaf. The
 *   returned theme and its `levels` / `statuses` records are frozen. Each status record is also
 *   copied and frozen. One theme is therefore safely shared across every entity.
 *
 * @example
 * ```ts
 * import { createStyler, createTheme } from '@src/core'
 *
 * const styler = createStyler()
 * const theme = createTheme({
 * 	levels: { warn: styler.brightYellow.bold.style }, // only the warn label changes
 * 	accent: styler.magenta.style, // spinner glyph, progress fill, step prefix
 * })
 * theme.levels.error // still the default red
 * ```
 */
export function createTheme(options?: ThemeOptions): Theme {
	const levels = { ...DEFAULT_THEME.levels }
	for (const level of LEVELS) {
		levels[level] = freezeStyle(options?.levels?.[level] ?? DEFAULT_THEME.levels[level])
	}
	const statuses = { ...DEFAULT_THEME.statuses }
	for (const status of STATUS_LEVELS) {
		const source = options?.statuses?.[status] ?? DEFAULT_THEME.statuses[status]
		statuses[status] = Object.freeze({ icon: source.icon, style: freezeStyle(source.style) })
	}
	return Object.freeze({
		levels: Object.freeze(levels),
		statuses: Object.freeze(statuses),
		accent: freezeStyle(options?.accent ?? DEFAULT_THEME.accent),
		chrome: freezeStyle(options?.chrome ?? DEFAULT_THEME.chrome),
	})
}

/**
 * Create the default {@link SinkInterface} — a console sink that routes by level and writes
 * through the `console` methods SNAPSHOTTED at creation. The default output target behind
 * {@link createLogger}.
 *
 * @returns A console {@link SinkInterface}
 *
 * @remarks
 * - **Snapshotted — no capture loop.** It captures `console.log` / `console.warn` /
 *   `console.error` AT CALL TIME and writes through those references. So when a later
 *   `Capture` (C-d) PATCHES `console.*`, this sink still reaches the REAL streams — the
 *   writer and the capturer never feed each other (the no-capture-loop principle). Create
 *   the sink (or the logger) BEFORE installing a capture for this to hold.
 * - **Routes by level.** `error` → the snapshotted `console.error`, `warn` →
 *   `console.warn`, every other level → `console.log`. The `level` is supplied by the
 *   logger; an omitted `level` goes to `console.log`.
 *
 * @example
 * ```ts
 * import { createConsoleSink } from '@src/core'
 *
 * const sink = createConsoleSink() // snapshots console.* now
 * sink.write('boom', 'error') // → the real console.error, even after a later console patch
 * ```
 */
export function createConsoleSink(): SinkInterface {
	// Snapshot the three console writers NOW — bound to their `console` receiver — so a later
	// patch of `console.*` (by Capture) can never reach this sink's output (no capture loop).
	const log = console.log.bind(console)
	const warn = console.warn.bind(console)
	const error = console.error.bind(console)
	return {
		write(text: string, level?: LogLevel): void {
			if (level === 'error') {
				error(text)
				return
			}
			if (level === 'warn') {
				warn(text)
				return
			}
			log(text)
		},
	}
}

/**
 * Create an observable, leveled {@link LoggerInterface} — the entry point into structured
 * logging. Each `debug` / `info` / `warn` / `error` call builds a frozen
 * {@link import('./types.js').LogRecord}, gates it by severity, retains a bounded tail,
 * ALWAYS emits it on `entry` (the transport seam), and — unless `silent` — writes a styled
 * line to its sink.
 *
 * @param options - See {@link LoggerOptions}
 * @returns A {@link LoggerInterface}
 *
 * @remarks
 * - **Record + event = transport (§13).** Subscribe `logger.emitter.on('entry', …)` to tee
 *   records to a file / JSON / remote transport; the event fires for every accepted record,
 *   even when `silent` (silence suppresses only the SINK WRITE).
 * - **Bounded retention.** `entries()` returns the recent records, capped at `options.limit`
 *   (default {@link DEFAULT_LOG_LIMIT}); never unbounded.
 * - **Sink + styler defaults.** `options.sink` defaults to {@link createConsoleSink} (the
 *   snapshotted, level-routing console sink); `options.styler` to {@link createStyler} (ANSI).
 *   Styling is orthogonal to level — a level only chooses a label color.
 *
 * @example
 * ```ts
 * import { createLogger } from '@src/core'
 *
 * const logger = createLogger({ name: 'http', level: 'info' })
 * logger.info('request', { method: 'GET', path: '/' })
 * logger.debug('verbose') // dropped — below the info threshold
 * ```
 */
export function createLogger(options?: LoggerOptions): LoggerInterface {
	return new Logger(options)
}

/**
 * Create an event-free {@link LoggerManagerInterface} — a §9 registry of named loggers plus
 * a convenience fan-out. It mints + stores {@link LoggerInterface}s keyed by name (its
 * defaults flowing into each), looks them up, removes them, and broadcasts a one-off log to
 * every registered logger.
 *
 * @param options - See {@link LoggerManagerOptions}
 * @returns A {@link LoggerManagerInterface}
 *
 * @remarks
 * - **Defaults flow in.** `options.level` / `sink` / `styler` / `limit` / `silent` are the
 *   defaults flowed into every `register`ed logger unless that call's options override them.
 * - **Event-free.** The manager carries NO emitter (each registered logger owns its own
 *   observable `emitter`) — it is a pure registry.
 *
 * @example
 * ```ts
 * import { createLoggerManager } from '@src/core'
 *
 * const loggers = createLoggerManager({ level: 'warn' })
 * loggers.register('http')
 * loggers.register('db', { level: 'debug' }) // overrides the default
 * loggers.warn('slow', { ms: 900 }) // fans out to both
 * ```
 */
export function createLoggerManager(options?: LoggerManagerOptions): LoggerManagerInterface {
	return new LoggerManager(options)
}

/**
 * Create a lean, event-free {@link ReporterInterface} — the entry point into narrative
 * reporting. Each verb (`section` / `step` / `timing` / `status` / `table` / `tree` / `box` /
 * `line` / `blank`) formats through the shared styler + the pure layout renderers and writes to
 * the sink — human / build-run narration over the SAME substrate the logger uses.
 *
 * @param options - See {@link ReporterOptions}
 * @returns A {@link ReporterInterface}
 *
 * @remarks
 * - **One styler, one sink.** `options.styler` defaults to {@link createStyler} (ANSI) and
 *   `options.sink` to {@link createConsoleSink} (the snapshotted, level-routing console sink) —
 *   no second colorizer. A `status('error', …)` routes to the sink's error stream.
 * - **Width-aware.** `options.width` (default {@link DEFAULT_WIDTH}) sizes `section` and a
 *   `box` with no explicit width; the renderers align on VISIBLE width so styled content keeps
 *   its columns.
 * - **Event-free (§13).** The reporter carries no emitter — a pure formatting front-end, like
 *   the renderers and `Scheduler`. Reach for a {@link createLogger} when you need observable,
 *   leveled, transportable records instead.
 *
 * @example
 * ```ts
 * import { createReporter } from '@src/core'
 *
 * const reporter = createReporter()
 * reporter.section('Build')
 * reporter.step('bundling', { index: 2, total: 5 }) // [2/5] bundling
 * reporter.status('success', 'built in 1.2s') // ✔ built in 1.2s
 *
 * // Disable color (a non-TTY) — every line is plain.
 * const plain = createReporter({ styler: createStyler({ enabled: false }) })
 * ```
 */
export function createReporter(options?: ReporterOptions): ReporterInterface {
	return new Reporter(options)
}

/**
 * Create an observable {@link CaptureInterface} — console interception on the READ side. While
 * `active`, every configured `console.*` call is captured as a frozen
 * {@link import('./types.js').CapturedMessage}, buffered (total + by level, bounded), emitted on
 * `capture`, and — per options — mirrored to the real console and/or forwarded to a
 * {@link SinkInterface}.
 *
 * @param options - See {@link CaptureOptions}
 * @returns A {@link CaptureInterface} (inactive until `start()`)
 *
 * @remarks
 * - **Snapshot-at-start — no capture loop.** `start()` snapshots the CURRENT `console[level]` per
 *   configured level, then patches; the mirror writes through that snapshot. Our OWN console sink
 *   output (the Logger / Reporter, which snapshot `console` at creation) is never recaptured —
 *   `Capture` catches THIRD-PARTY `console.*`, not our writes. Create your loggers FIRST.
 * - **PROCESS-GLOBAL + NON-REENTRANT.** It patches the one global `console`, so at most ONE
 *   capture may be active at a time; two concurrent captures interleave and clobber each other's
 *   restore. Prefer {@link withCapture} for a scoped, self-restoring capture.
 * - **Bounded.** `options.limit` (default {@link import('./constants.js').DEFAULT_CAPTURE_LIMIT})
 *   caps both the total buffer and each by-level bucket; never unbounded.
 *
 * @example
 * ```ts
 * import { createCapture } from '@src/core'
 *
 * const capture = createCapture({ levels: ['warn', 'error'] })
 * capture.start()
 * console.error('boom') // captured, NOT mirrored (mirror defaults to false)
 * capture.messages('error') // [{ level: 'error', text: 'boom', time: … }]
 * capture.stop()
 * ```
 */
export function createCapture(options?: CaptureOptions): CaptureInterface {
	return new Capture(options)
}

/**
 * Create a self-driving, observable {@link SpinnerInterface} — a live activity spinner. `start()`
 * arms a periodic timer that advances a glyph cycle, writing each `\r` + frame line to its sink and
 * emitting it on `frame`; `success` / `failure` commit a final `✔` / `✖` line. The leading `\r` is the
 * sink's to redraw on — a TTY sink (C-g) overwrites for a smooth animation, a plain sink (C-f)
 * degrades to a fresh line.
 *
 * @param options - See {@link SpinnerOptions}
 * @returns A {@link SpinnerInterface} (inactive until `start()`)
 *
 * @remarks
 * - **Universal + leak-free.** Built on `setInterval` + the one styler + the one sink (no `node:*`,
 *   no `process.stdout`); the timer is ALWAYS cleared on `success` / `failure` / `stop` / `destroy`, so
 *   it never leaks. `start()` is idempotent (no second timer while `active`).
 * - **Observable (§13).** Subscribe `spinner.emitter.on('frame', …)` to mirror the animation without
 *   a terminal; `start` / `stop` bracket the timer lifecycle. `options.sink` defaults to
 *   {@link createConsoleSink}, `options.styler` to {@link createStyler} (ANSI).
 *
 * @example
 * ```ts
 * import { createSpinner } from '@src/core'
 *
 * const spinner = createSpinner({ message: 'building' })
 * spinner.start()
 * spinner.success('built in 1.2s') // ✔ built in 1.2s — timer cleared, line committed
 * ```
 */
export function createSpinner(options?: SpinnerOptions): SpinnerInterface {
	return new Spinner(options)
}

/**
 * Create an update-driven, observable {@link ProgressInterface} — a live progress bar. Each
 * `update(current)` recomputes the bar, writes `\r` + bar to its sink, and emits `{ current, total }`
 * on `update`; `complete` / `failure` commit a final line. The leading `\r` is the sink's to redraw on —
 * a TTY sink (C-g) overwrites, a plain sink (C-f) degrades to a fresh line. NO self-timer — the caller
 * drives the bar.
 *
 * @param options - See {@link ProgressOptions} (`total` is required)
 * @returns A {@link ProgressInterface}
 *
 * @remarks
 * - **Universal + update-driven.** Built on the one styler + the one sink (no `node:*`, no
 *   `process.stdout`); progress advances only when the caller reports it. `current` is always clamped
 *   to `[0, total]`. `options.sink` defaults to {@link createConsoleSink}, `options.styler` to
 *   {@link createStyler} (ANSI).
 * - **Observable (§13).** Subscribe `progress.emitter.on('update', …)` to mirror progress without a
 *   terminal; `complete` signals a successful finish.
 *
 * @example
 * ```ts
 * import { createProgress } from '@src/core'
 *
 * const progress = createProgress({ total: 100, message: 'downloading' })
 * progress.update(40)
 * progress.complete('done')
 * ```
 */
export function createProgress(options: ProgressOptions): ProgressInterface {
	return new Progress(options)
}
