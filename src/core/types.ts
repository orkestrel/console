import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'

/**
 * Names the console-method shape a {@link CaptureInterface} snapshots and swaps at the patch
 * boundary — a variadic sink of arbitrary arguments.
 *
 * @remarks
 * It is exactly the universal `console.log` / `info` / `warn` / `error` / `debug` signature, so it
 * types the global `console` viewed as a record keyed by {@link CaptureLevel}. Every
 * `CaptureLevel` is a real `Console` method, so `console` is assignable to that view with no type
 * assertion, which keeps the global-patch boundary honest.
 */
export type ConsoleMethod = (...args: unknown[]) => void

/**
 * Names a machine-readable error code for a {@link import('./errors.js').ConsoleError}.
 *
 * @remarks
 * `INVARIANT` — an internal invariant or unreachable guard was violated (a defensive check that is
 * structurally impossible to trip). It is the only code the package throws.
 */
export type ConsoleErrorCode = 'INVARIANT'

// The console style engine — text style is data, rendered by a swappable renderer.
// A `Style` is a frozen record (a foreground/background `Color` + a set of text
// `Attribute`s), not a pre-baked escape string; a `RendererInterface` turns that data
// into output for one target (the default is ANSI/SGR; a browser `%c`/CSS renderer
// swaps in at the same seam). The `StylerInterface` is the fluent surface that builds a
// `Style` and renders it through the injected renderer. Event-free — a
// pure styling primitive, like `Scheduler`.

/**
 * Names a terminal color — the 8 standard base colors, their 8 bright variants, and
 * `default` (the target's own default ink, emitting no color code).
 *
 * @remarks
 * Style as data: a `Color` is a name, not an escape sequence. The renderer maps it to
 * its target's codes — the ANSI renderer to SGR 30–37 / 90–97 (foreground) and 40–47 /
 * 100–107 (background); a browser renderer maps the same names to CSS colors.
 * `default` means "leave the target's default" and contributes no code.
 */
export type Color =
	| 'black'
	| 'red'
	| 'green'
	| 'yellow'
	| 'blue'
	| 'magenta'
	| 'cyan'
	| 'white'
	| 'brightBlack'
	| 'brightRed'
	| 'brightGreen'
	| 'brightYellow'
	| 'brightBlue'
	| 'brightMagenta'
	| 'brightCyan'
	| 'brightWhite'
	| 'default'

/**
 * Names a text-style attribute — the standard SGR text effects.
 *
 * @remarks
 * Style as data: an `Attribute` is a name. The ANSI renderer maps each to its SGR
 * on-code (`bold` → 1, `dim` → 2, `italic` → 3, `underline` → 4, `inverse` → 7,
 * `strikethrough` → 9), composing several at once; a browser renderer maps the same
 * names to CSS (`font-weight`, `font-style`, `text-decoration`, …).
 */
export type Attribute = 'bold' | 'dim' | 'italic' | 'underline' | 'inverse' | 'strikethrough'

/**
 * Represents text style as data — a frozen, readonly record of a foreground color, a background
 * color, and a set of text attributes. The single style value the whole console /
 * terminal system shares; a {@link RendererInterface} renders it for one target.
 *
 * @remarks
 * - `foreground` / `background` are absent (not `'default'`) when unset — the renderer
 *   emits a color code only for a set, non-`default` color.
 * - `attributes` is a de-duplicated, order-stable list (a set modelled as an array so
 *   the value stays plain JSON data — no `Set` to clone or serialize). An empty list +
 *   no colors is the empty style, which renders text unchanged.
 * - The value is deeply frozen; compose a new style with the styler rather than mutating.
 */
export interface Style {
	readonly foreground?: Color
	readonly background?: Color
	readonly attributes: readonly Attribute[]
}

/**
 * Declares a swappable style renderer — the seam that turns style data into output for one
 * target. The cross-environment default is the ANSI renderer (SGR escape codes); a
 * browser `%c` / CSS renderer implements the same contract over the same {@link Style}
 * model, so it drops in without touching the style data (the browser branch).
 */
export interface RendererInterface {
	/**
	 * Renders `text` wrapped in the target codes for `style`. The empty style (no colors,
	 * no attributes) and the empty string both return `text` unchanged — no wrapping.
	 */
	render(style: Style, text: string): string
}

/**
 * Configures {@link createStyler}.
 *
 * @remarks
 * - `renderer` — the {@link RendererInterface} every style renders through; defaults to
 *   the ANSI renderer (the cross-environment default), so the styler works unchanged in
 *   any terminal. Inject a browser `%c` renderer to retarget with no other change.
 * - `enabled` — the no-color switch. When `false`, the styler returns text verbatim
 *   (for a non-TTY, a `NO_COLOR` environment, or piped output); defaults to `true`.
 */
export interface StylerOptions {
	readonly renderer?: RendererInterface
	readonly enabled?: boolean
}

/**
 * Declares the fluent, composable styling surface — the consumer-facing API. It is both a
 * function (call it with text to render the accumulated style) and a record of
 * chainable accessors: every {@link Color} and {@link Attribute} is a getter returning a
 * new styler with that token added, so `styler.red.bold('hi')` and
 * `styler.red(styler.bold('hi'))` both work and nothing is mutated.
 *
 * @remarks
 * - Each accessor returns a fresh `StylerInterface` (immutable, copy-on-write) — a base
 *   styler is reusable and the chains never interfere.
 * - Calling the styler builds the {@link Style} under the hood and renders it through the
 *   injected renderer. When `enabled` is `false`, it returns the text verbatim.
 * - `render` is the data door beside the accessor chain: it renders a {@link Style} value
 *   (a {@link Theme} role, say) merged over the accumulated style, so a caller styles by
 *   value where the chain styles by name. Both go through the same renderer and the same
 *   `enabled` switch.
 * - `style` exposes the accumulated style data (the empty style on a base styler), and
 *   `enabled` reflects the switch — both inspectable and testable.
 * - A later color of the same channel wins (`styler.red.blue` is blue); a repeated
 *   attribute is idempotent (`styler.bold.bold` carries one `bold`).
 */
export interface StylerInterface {
	/** Renders the accumulated style around `text` (verbatim when `enabled` is `false`). */
	(text: string): string
	/** Holds the accumulated style data — the empty style on a base styler. */
	readonly style: Style
	/** Reports whether styling is applied; when `false`, calls return text unchanged. */
	readonly enabled: boolean
	/**
	 * Renders `text` in `style` merged over the accumulated style — the by-value counterpart
	 * of the accessor chain, and the door a {@link Theme} role is applied through.
	 *
	 * @param style - The style to overlay; its colors win over the accumulated ones and its
	 * attributes join them (de-duplicated, accumulated ones first)
	 * @param text - The text to wrap
	 * @returns The rendered text — verbatim when `enabled` is `false`, and (by the
	 * {@link RendererInterface} contract) when the merged style or `text` is empty
	 *
	 * @example
	 * ```ts
	 * import { createStyler, DEFAULT_THEME } from '@orkestrel/console'
	 *
	 * const styler = createStyler()
	 * styler.render(DEFAULT_THEME.levels.warn, 'WARN') // yellow
	 * styler.bold.render(DEFAULT_THEME.chrome, '│') // dim, over the accumulated bold
	 * ```
	 */
	render(style: Style, text: string): string
	readonly black: StylerInterface
	readonly red: StylerInterface
	readonly green: StylerInterface
	readonly yellow: StylerInterface
	readonly blue: StylerInterface
	readonly magenta: StylerInterface
	readonly cyan: StylerInterface
	readonly white: StylerInterface
	readonly brightBlack: StylerInterface
	readonly brightRed: StylerInterface
	readonly brightGreen: StylerInterface
	readonly brightYellow: StylerInterface
	readonly brightBlue: StylerInterface
	readonly brightMagenta: StylerInterface
	readonly brightCyan: StylerInterface
	readonly brightWhite: StylerInterface
	readonly bold: StylerInterface
	readonly dim: StylerInterface
	readonly italic: StylerInterface
	readonly underline: StylerInterface
	readonly inverse: StylerInterface
	readonly strikethrough: StylerInterface
}

// Theming — the app-wide semantic style vocabulary. A `Theme` names what a piece of output
// is (a level label, a status outcome, chrome, an accent) and binds each name to a `Style`;
// an entity's own options stay the presentation of that instance. One theme flows through
// the logger, the reporter, and the animations, so a consumer restyles every surface at
// once — and every value in it is style data, rendered through the one `Styler`.

/**
 * Represents one narrative outcome's presentation — the icon glyph a {@link StatusLevel} shows and the
 * {@link Style} the line renders in.
 *
 * @remarks
 * The themed counterpart of the {@link STATUS_ICONS} / {@link STATUS_COLORS} defaults: those
 * two constants are the source of {@link DEFAULT_THEME}'s statuses. A status override supplies
 * the whole record — both `icon` and `style` — through {@link ThemeOptions}.
 */
export interface ThemeStatus {
	readonly icon: string
	readonly style: Style
}

/**
 * Represents the app-wide semantic style vocabulary — every role the console system styles, bound to a
 * {@link Style} value. Pass one theme to a logger / reporter / spinner / progress and every
 * surface speaks it.
 *
 * @remarks
 * - `levels` — the label style per {@link LogLevel} (a log line's severity label).
 * - `statuses` — the icon + style per {@link StatusLevel} (a reporter outcome, a spinner's
 *   final line).
 * - `accent` — the one highlight role: a spinner glyph, a progress bar's filled run, a
 *   step prefix.
 * - `chrome` — the frame role: separators, box / table / tree connectors, and a log line's
 *   timestamp / name / data surround.
 * - A theme is the vocabulary the whole application shares; a per-entity option (a
 *   `ProgressOptions.fill`, a `BoxOptions.border`) is the presentation of that one instance.
 * - A theme returned by {@link createTheme} is frozen with every {@link Style} leaf deeply
 *   frozen, so one theme is safely shared across every entity.
 */
export interface Theme {
	readonly levels: Readonly<Record<LogLevel, Style>>
	readonly statuses: Readonly<Record<StatusLevel, ThemeStatus>>
	readonly accent: Style
	readonly chrome: Style
}

/**
 * Holds the options for {@link createTheme} — the roles to override on {@link DEFAULT_THEME}.
 *
 * @remarks
 * Every key is optional and merges per role, never per theme: an omitted role keeps its
 * default, and `levels` / `statuses` merge per entry, so `{ levels: { warn: … } }` restyles
 * the `warn` label and leaves `debug`, `info`, and `error` alone. A status override supplies its whole
 * `{ icon, style }` record; {@link createTheme} snapshots and freezes that record and every
 * style leaf it receives.
 */
export interface ThemeOptions {
	readonly levels?: Readonly<Partial<Record<LogLevel, Style>>>
	readonly statuses?: Readonly<Partial<Record<StatusLevel, ThemeStatus>>>
	readonly accent?: Style
	readonly chrome?: Style
}

// Structured logging — the record + event are the transport seam. A `Logger` builds an
// immutable `LogRecord` per call, gates it by an ascending-severity `LogLevel`, emits it
// on `entry` always (the pluggable-transport hook — file / JSON / remote sinks hang off
// `emitter.on('entry')`), and — unless silent — formats it into a styled line through the
// shared `Styler` and writes it to a `Sink`. `LoggerManager` is an event-free registry
// of loggers + a convenience fan-out. Styling is orthogonal to level (a level's color is a
// style choice, never a separate level — no `success`/`ready` pseudo-levels).

/**
 * Names the severity level of a {@link LogRecord} — one coherent, ascending-severity scale.
 *
 * @remarks
 * Ordered least-to-most severe: `debug` < `info` < `warn` < `error`. A {@link LoggerInterface}
 * gates by threshold — a record at or above the logger's `level` is kept (and written),
 * one below it is dropped (see {@link LEVEL_SEVERITY} for the numeric order). A level is a
 * level — its visual treatment (color) is a separate styling concern, never a pseudo-level
 * like `success` / `ready`.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Represents one immutable, serializable log entry — the universal record the whole logging system
 * carries. A {@link LoggerInterface} builds one per call, freezes it, retains a bounded
 * tail of them, and emits it on `entry`; every sink / transport consumes this exact shape.
 *
 * @remarks
 * - `level` — the record's {@link LogLevel}.
 * - `message` — the human message text.
 * - `time` — the creation instant as epoch milliseconds (`Date.now()`); a plain number so
 *   the record stays serializable (no `Date` to clone) and orderable.
 * - `name` — the originating logger's `name`, when it has one (a manager-registered logger
 *   is keyed by name; an anonymous logger omits it).
 * - `data` — optional structured context (a flat `Record<string, unknown>`), absent when
 *   no context was supplied. The top-level object is a frozen copy taken at log time (a
 *   later mutation of the caller's original object never reaches the retained record);
 *   nested values remain by reference (only the top level is copied + frozen).
 * - The value is frozen at construction — a consumer reads it, never mutates it.
 */
export interface LogRecord {
	readonly level: LogLevel
	readonly message: string
	readonly time: number
	readonly name?: string
	readonly data?: Readonly<Record<string, unknown>>
}

/**
 * Declares the minimal output primitive — the seam every formatted line is written through. A
 * `Sink` is the one place text leaves the logging system; redirect output (to a file, a
 * buffer, a test recorder, the browser `%c` path, a server TTY) by supplying a different
 * `SinkInterface`, with no change to the logger.
 *
 * @remarks
 * - **`write(text)` is the whole contract.** A custom sink (file / buffer / recorder)
 *   implements only `write(text)` and ignores the rest — the optional `level` exists only so
 *   a stream-aware sink can route. The logger passes the originating record's {@link LogLevel}.
 * - **The default {@link import('./factories.js').createConsoleSink} routes by level** —
 *   `error` → `console.error`, `warn` → `console.warn`, everything else → `console.log` — and
 *   writes to the underlying `console` methods snapshotted at creation, so a later `Capture`
 *   that patches `console` can never feed the sink's own output back into itself (the
 *   no-capture-loop principle). The same `level` seam lets the server TTY sink send
 *   `error` / `warn` to `stderr`.
 */
export interface SinkInterface {
	/**
	 * Writes one already-formatted chunk of output. `text` receives one line without its
	 * terminator — the sink's target supplies it (for example `console.log`; the server TTY sink
	 * appends one) — unless `text` begins with `\r`: that is an in-place redraw frame (the
	 * Spinner / Progress animation protocol), written verbatim. A tick frame carries no
	 * terminator; a final frame carries its own.
	 * `level` is the originating record's {@link LogLevel} — supplied so a stream-aware sink
	 * can route (for example `error` to `stderr`); a plain sink ignores it.
	 */
	write(text: string, level?: LogLevel): void
}

/**
 * Groups the three write targets a level-routing sink chooses between — the normal target, the
 * warning target, and the error target.
 *
 * @remarks
 * The member type is the sink's own: a bound `console` method in core, a browser `%c` console
 * method, a stream target on the server, or any per-target fact routed the same way. A backend
 * that sends two levels to one place supplies the same member twice; that is how the server sink
 * routes `warn` alongside `error` to its error stream.
 * {@link import('./helpers.js').selectWriter} is the one place the level-to-member decision lives.
 */
export interface WriterSet<T> {
	readonly log: T
	readonly warn: T
	readonly error: T
}

/**
 * Declares the observable events a {@link LoggerInterface} emits — the transport seam.
 *
 * @remarks
 * `entry` fires for every accepted record (one that passed the level gate), carrying the
 * frozen {@link LogRecord} — even when the logger is `silent` (silence suppresses only the
 * sink write, never the event, so transports keep receiving records). Listener isolation is
 * the emitter's: a listener throw routes to the emitter's `error` handler, never onto
 * this map — so a buggy transport can never perturb logging.
 *
 * Declared as a `type` alias (not `interface extends EventMap`): a type-literal
 * satisfies the `EventMap` constraint structurally, whereas an interface lacks the index signature.
 */
export type LoggerEventMap = {
	/** Fires after a record was logged (passed the level gate) — the frozen {@link LogRecord}. */
	readonly entry: readonly [record: LogRecord]
}

/**
 * Represents the line layout a logger writes — one {@link LogRecord} plus the styling substrate in,
 * one finished line out. {@link import('./helpers.js').formatRecord} is the default.
 *
 * @param record - The frozen record to lay out
 * @param styler - The logger's {@link StylerInterface} — color through it (and through
 * {@link StylerInterface.render} for a {@link Theme} role) so a disabled styler yields a
 * plain line with no second code path
 * @param theme - The logger's {@link Theme} — the level label style, the chrome surround
 * @returns The line to write, without a trailing terminator (the sink's target supplies it)
 *
 * @remarks
 * The formatter owns the line; the `entry` event owns the record. A transport that wants
 * structure rides the event rather than parsing a line back out of this. A formatter throw
 * propagates to the caller of `logger.info` and prevents that line's write, so keep it total.
 * A manager fans out sequentially; a formatter throw stops the remaining loggers for that call.
 */
export type LogFormatFunction = (record: LogRecord, styler: StylerInterface, theme: Theme) => string

/**
 * Configures the {@link import('./loggers/Logger.js').Logger} constructor.
 *
 * @remarks
 * - `on` — the reserved {@link EmitterHooks} key: initial listeners for the
 *   {@link LoggerEventMap}, wired at construction (for example `{ entry: (r) => sink2.write(...) }`).
 * - `error` — the emitter's listener-error handler; a listener throw routes here.
 * - `level` — the severity threshold; records below it are dropped. Defaults to `info`.
 * - `name` — the logger's name, stamped onto every {@link LogRecord} (`record.name`) and
 *   shown in the formatted line. A manager registers each logger under its name.
 * - `sink` — where formatted lines are written; defaults to
 *   {@link import('./factories.js').createConsoleSink} (the snapshotted-console sink).
 * - `styler` — the {@link StylerInterface} the line is colored through; defaults to
 *   {@link import('./factories.js').createStyler} (ANSI). Styling is orthogonal to level.
 * - `theme` — the {@link Theme} supplying the line's semantic styles; defaults to
 *   {@link DEFAULT_THEME}.
 * - `format` — the {@link LogFormatFunction} that owns the written line; defaults to
 *   {@link import('./helpers.js').formatRecord}.
 * - `limit` — the bounded retention cap: at most this many recent records are kept
 *   (oldest dropped first). Defaults to {@link DEFAULT_LOG_LIMIT}; never unbounded.
 * - `silent` — when `true`, suppresses the sink write only; `entry` still fires and the
 *   record is still retained. Defaults to `false`.
 */
export interface LoggerOptions {
	readonly on?: EmitterHooks<LoggerEventMap>
	readonly error?: EmitterErrorHandler
	readonly level?: LogLevel
	readonly name?: string
	readonly sink?: SinkInterface
	readonly styler?: StylerInterface
	readonly theme?: Theme
	readonly format?: LogFormatFunction
	readonly limit?: number
	readonly silent?: boolean
}

/**
 * Declares an observable, leveled logger — builds a frozen {@link LogRecord} per call, gates it by
 * severity, retains a bounded tail, emits it on `entry`, and (unless silent) writes a
 * styled line to its {@link SinkInterface}.
 *
 * @remarks
 * - **Leveled.** Each of `debug` / `info` / `warn` / `error` builds a record at that
 *   {@link LogLevel}; a record below the logger's `level` threshold is dropped entirely (no
 *   event, no retention, no write).
 * - **Transport seam.** An accepted record always fires `entry` (even when `silent`),
 *   carrying the frozen {@link LogRecord} — the hook every file / JSON / remote transport rides.
 * - **Bounded retention.** `entries()` returns the recent records, capped at `limit` (oldest
 *   dropped first) — never an unbounded buffer. `clear()` empties it.
 * - **Styled write.** Unless `silent`, the record is formatted (timestamp + level label +
 *   `name` + message + trailing `data`) and colored through the injected `styler`, then
 *   written to `sink`. Styling is orthogonal to level (the level only chooses a color).
 * - **Lifecycle.** `destroy()` clears retention and destroys the emitter (its listeners go).
 */
export interface LoggerInterface {
	readonly emitter: EmitterInterface<LoggerEventMap>
	readonly level: LogLevel
	readonly name?: string
	/** Logs at `debug` — dropped unless the logger's `level` is `debug`. */
	debug(message: string, data?: Record<string, unknown>): void
	/** Logs at `info`. */
	info(message: string, data?: Record<string, unknown>): void
	/** Logs at `warn`. */
	warn(message: string, data?: Record<string, unknown>): void
	/** Logs at `error`. */
	error(message: string, data?: Record<string, unknown>): void
	/** Returns the bounded tail of recent {@link LogRecord}s, oldest first (capped at `limit`). */
	entries(): readonly LogRecord[]
	/** Drops every retained record (does not touch listeners). */
	clear(): void
	/** Tears down — clears retention and destroys the emitter. */
	destroy(): void
}

/**
 * Configures the {@link import('./loggers/LoggerManager.js').LoggerManager} constructor.
 *
 * @remarks
 * The manager is an event-free registry — it carries no emitter of its own (each
 * registered {@link LoggerInterface} owns its observable `emitter`). These options supply
 * the defaults flowed into every logger the manager mints, unless a per-`register` override
 * wins: `level` (default threshold), `sink` (shared output target), `styler` (shared
 * coloring), `theme` (semantic styles), `format` (line layout), `limit` (retention cap),
 * and `silent`.
 */
export interface LoggerManagerOptions {
	readonly level?: LogLevel
	readonly sink?: SinkInterface
	readonly styler?: StylerInterface
	readonly theme?: Theme
	readonly format?: LogFormatFunction
	readonly limit?: number
	readonly silent?: boolean
}

/**
 * Declares an event-free registry of named {@link LoggerInterface}s plus a convenience fan-out — the
 * manager over the logging layer. It mints + stores loggers keyed by `name`, looks them
 * up, removes them, and broadcasts a one-off log to every registered logger.
 *
 * @remarks
 * - **Registry.** `register(name, options?)` mints a {@link LoggerInterface} (named
 *   `name`, the manager's defaults flowing in unless `options` overrides them), stores it
 *   (a re-`register` of the same name overwrites — last write wins), and returns it.
 *   `logger(name)` looks one up; `loggers()` lists them in insertion order; `count` is the size.
 * - **Removal.** `remove()` clears all, `remove(name)` drops one, `remove(names)` drops
 *   a batch (`true` only when every name was present; an empty list succeeds vacuously).
 *   Every listed name is attempted whatever the result.
 * - **Fan-out.** `debug` / `info` / `warn` / `error(message, data?)` forward the call to every
 *   registered logger (each gates / emits / writes per its own `level` and `sink`).
 * - **Event-free.** No emitter, no events — each logger carries its own observability; the
 *   manager is a pure registry.
 */
export interface LoggerManagerInterface {
	readonly count: number
	register(name: string, options?: LoggerOptions): LoggerInterface
	logger(name: string): LoggerInterface | undefined
	loggers(): readonly LoggerInterface[]
	/** Fans out a `debug` log to every registered logger. */
	debug(message: string, data?: Record<string, unknown>): void
	/** Fans out an `info` log to every registered logger. */
	info(message: string, data?: Record<string, unknown>): void
	/** Fans out a `warn` log to every registered logger. */
	warn(message: string, data?: Record<string, unknown>): void
	/** Fans out an `error` log to every registered logger. */
	error(message: string, data?: Record<string, unknown>): void
	remove(): void
	remove(name: string): boolean
	remove(names: readonly string[]): boolean
}

// Narrative reporting — the pure layout renderers + a lean `Reporter` front-end. This is
// human / build-run narration (sections, steps, timings, tables, trees, boxes), distinct
// from structured logging (above) but sharing the same substrate: the one `Styler` (colors +
// the ANSI-aware `width`) and the one `Sink`. The renderers are pure `options → string`,
// universal, and width-aware (they align on the visible width so ANSI-styled content keeps
// its columns); the `Reporter` formats through them and writes to the sink. Event-free
// — a formatting / output front-end with no observable lifecycle, like the renderers.

/**
 * Names the horizontal text alignment within a fixed-width cell — the conventional three-value set a
 * {@link ColumnSpec} (and the box / separator title) aligns by. A value pair / set, not a
 * binary toggle, so it stays a union.
 */
export type Alignment = 'left' | 'center' | 'right'

/**
 * Names a box-drawing border style — the four standard Unicode line weights the renderers frame
 * with. Each selects a full junction set in {@link BORDER_CHARS} (corners, edges, and the
 * `T` / cross junctions a table needs). A named, fixed set (an external-spec value family),
 * never a toggle — so it stays a union.
 *
 * @remarks
 * `single` (`┌─┐`), `double` (`╔═╗`), `round` (`╭─╮` — single edges, rounded corners), and
 * `heavy` (`┏━┓`). The renderer looks the style up in {@link BORDER_CHARS}; styling the
 * border (a color) is a separate, orthogonal concern handled by the optional `styler`.
 */
export type BorderStyle = 'single' | 'double' | 'round' | 'heavy'

/**
 * Represents one complete box-drawing junction set for a {@link BorderStyle} — every glyph the box /
 * table renderers need to frame content and rule a table. Plain data (the value lives in
 * {@link BORDER_CHARS}); the renderers read these so no glyph literal is hard-coded in a
 * renderer.
 *
 * @remarks
 * - `horizontal` / `vertical` — the edge run characters.
 * - `topLeft` / `topRight` / `bottomLeft` / `bottomRight` — the four corners.
 * - `cross` — the four-way `┼` junction (a table's interior grid crossing).
 * - `teeDown` / `teeUp` / `teeRight` / `teeLeft` — the `┬` / `┴` / `├` / `┤` three-way
 *   junctions where a separator meets an edge (a table's column separators at the top, the
 *   header rule, and the bottom).
 */
export interface BorderChars {
	readonly horizontal: string
	readonly vertical: string
	readonly topLeft: string
	readonly topRight: string
	readonly bottomLeft: string
	readonly bottomRight: string
	readonly cross: string
	readonly teeDown: string
	readonly teeUp: string
	readonly teeRight: string
	readonly teeLeft: string
}

/**
 * Configures {@link import('./helpers.js').renderSeparator} — a horizontal rule, optionally
 * carrying a centered title.
 *
 * @remarks
 * - `title` — text to embed in the rule (for example a section heading). Omitted ⇒ an unbroken line.
 * - `width` — the visible column count of the whole rule; defaults to {@link DEFAULT_WIDTH}.
 * - `fill` — the single character the rule is drawn with; defaults to {@link SEPARATOR_FILL}
 *   (`─`). The visible width of the rule is `width` regardless of the fill's escape codes.
 * - `styler` — colors the rule (and the embedded title) when supplied; the layout is
 *   identical with or without it, since width is measured on the visible content.
 * - `style` — an optional by-value style rendered through `styler` for the rule and title.
 */
export interface SeparatorOptions {
	readonly title?: string
	readonly width?: number
	readonly fill?: string
	readonly styler?: StylerInterface
	readonly style?: Style
}

/**
 * Configures {@link import('./helpers.js').renderBox} — content framed in box-drawing
 * characters.
 *
 * @remarks
 * - `content` — the body text; embedded newlines split it into lines, each framed on its own
 *   row. Every row is padded to the inner width measured by {@link import('./helpers.js').width}
 *   (the visible width), so ANSI-styled content stays aligned inside the frame.
 * - `title` — an optional caption embedded in the top border.
 * - `padding` — horizontal cells of blank padding inside each vertical edge; defaults to
 *   {@link DEFAULT_PADDING}.
 * - `border` — the {@link BorderStyle}; defaults to {@link DEFAULT_BORDER} (`single`).
 * - `width` — the total visible width of the box. When omitted, the box hugs its widest line
 *   (plus padding + borders); when supplied, narrower lines pad out and the box is exactly
 *   that wide (content wider than the budget is not truncated — `renderTable` is the
 *   width-bounded renderer).
 * - `styler` — colors the border (and title) when supplied; alignment is unaffected.
 * - `style` — an optional by-value style rendered through `styler` for the frame and title.
 */
export interface BoxOptions {
	readonly content: string
	readonly title?: string
	readonly padding?: number
	readonly border?: BorderStyle
	readonly width?: number
	readonly styler?: StylerInterface
	readonly style?: Style
}

/**
 * Represents one column of a {@link TableOptions} — its header label and how its cells align.
 *
 * @remarks
 * - `label` — the header text shown in the table's first row.
 * - `align` — how this column's header and cells align within the column width; defaults to
 *   {@link DEFAULT_ALIGN} (`left`). The column is sized to the widest visible content
 *   (header or any cell, measured by {@link import('./helpers.js').width}), so a styled cell
 *   never breaks the column.
 */
export interface ColumnSpec {
	readonly label: string
	readonly align?: Alignment
}

/**
 * Configures {@link import('./helpers.js').renderTable} — a bordered grid of columns + rows
 * with per-column alignment and width-aware sizing.
 *
 * @remarks
 * - `columns` — the {@link ColumnSpec}s, left to right; their `label`s form the header row.
 * - `rows` — the body, one `readonly string[]` per row. A short row is padded with empty
 *   cells, an over-long row is truncated to the column count, so a ragged input never throws.
 * - `border` — the {@link BorderStyle} the frame + header rule + column separators draw in;
 *   defaults to {@link DEFAULT_BORDER} (`single`).
 * - `styler` — colors the border + header labels when supplied; the cells are written as
 *   given (already-styled cells are honored — their visible width drives column sizing, never
 *   their raw `.length`).
 * - `style` — an optional by-value style rendered through `styler` for the frame and headers.
 */
export interface TableOptions {
	readonly columns: readonly ColumnSpec[]
	readonly rows: ReadonlyArray<readonly string[]>
	readonly border?: BorderStyle
	readonly styler?: StylerInterface
	readonly style?: Style
}

/**
 * Represents one node of a {@link TreeOptions} tree — a label plus optional children, recursively.
 *
 * @remarks
 * - `label` — the node's text (a single visible line; it may already be styled).
 * - `children` — the node's sub-nodes, rendered indented beneath it with `├─` / `└─`
 *   connectors and `│` guides; omitted (or empty) ⇒ a leaf.
 */
export interface TreeNode {
	readonly label: string
	readonly children?: readonly TreeNode[]
}

/**
 * Configures {@link import('./helpers.js').renderTree} — a nested {@link TreeNode} tree drawn
 * with box-drawing connectors.
 *
 * @remarks
 * - `root` — the top {@link TreeNode}; its `label` is the unindented first line and its
 *   `children` descend beneath it (`├─` for each but the last, `└─` for the last, `│` guides
 *   carried down through earlier branches).
 * - `border` — the {@link BorderStyle} whose junction set supplies every connector;
 *   defaults to {@link DEFAULT_BORDER} (`single`).
 * - `styler` — colors the connectors when supplied; node labels are written as given.
 * - `style` — an optional by-value style rendered through `styler` for the connectors.
 */
export interface TreeOptions {
	readonly root: TreeNode
	readonly border?: BorderStyle
	readonly styler?: StylerInterface
	readonly style?: Style
}

/**
 * Names a narrative outcome level — the four states {@link ReporterInterface.status} reports, each
 * with its own icon + color ({@link STATUS_ICONS} / {@link STATUS_COLORS}).
 *
 * @remarks
 * distinct from {@link LogLevel} (`debug` / `info` / `warn` / `error`): a `StatusLevel` is a
 * narrative outcome (did the step success?), not a log severity threshold — there is no
 * ordering and no gating. `success` (`✔`, green), `error` (`✖`, red), `warn` (`⚠`, yellow),
 * `info` (`ℹ`, blue). `error` routes to the sink's error stream (the `level` hint passed to
 * {@link SinkInterface.write}); the other three go to the default stream.
 */
export type StatusLevel = 'success' | 'error' | 'warn' | 'info'

/**
 * Represents where one step sits in a sequence — the `{ index, total }` a
 * {@link ReporterInterface.step} renders as a `[2/5]` prefix.
 *
 * @remarks
 * Both are 1-based for display (`{ index: 2, total: 5 }` ⇒ `[2/5]`); the reporter formats
 * them verbatim, so a caller controls the numbering. Omitting the position renders a bare
 * step line with no prefix.
 */
export interface StepPosition {
	readonly index: number
	readonly total: number
}

/**
 * Configures the {@link import('./Reporter.js').Reporter} constructor.
 *
 * @remarks
 * - `sink` — where every formatted line is written; defaults to
 *   {@link import('./factories.js').createConsoleSink} (the snapshotted, level-routing console
 *   sink) — the same seam the logger writes through. A `status('error', …)` passes the
 *   `error` level so a stream-aware sink routes it to `stderr`.
 * - `styler` — the {@link StylerInterface} every line is colored through; defaults to
 *   {@link import('./factories.js').createStyler} (ANSI). The one styler the whole system
 *   shares — no second colorizer. A disabled styler yields plain narration.
 * - `theme` — the {@link Theme} supplying status, accent, and chrome roles; defaults to
 *   {@link DEFAULT_THEME}.
 * - `width` — the default column width handed to the separator / box renderers (the section
 *   rule, a `box` with no explicit width); defaults to {@link DEFAULT_WIDTH}.
 *
 * Event-free: the reporter has no `on` / `error` — it is a formatting front-end with no
 * observable lifecycle, so (like the renderers and `Scheduler`) it carries no emitter.
 */
export interface ReporterOptions {
	readonly sink?: SinkInterface
	readonly styler?: StylerInterface
	readonly theme?: Theme
	readonly width?: number
}

/**
 * Declares a lean, event-free narrative reporter — the composable verb set for human / build-run
 * output (sections, steps, timings, outcomes, tables, trees, boxes), formatting through the
 * shared {@link StylerInterface} + layout renderers and writing to a {@link SinkInterface}.
 *
 * @remarks
 * - **A small composable set**, not a grab-bag: `section` / `step` / `timing` / `status` /
 *   `table` / `tree` / `box` / `line` / `blank`. Coloring is the one styler; layout is the
 *   pure renderers ({@link import('./helpers.js').renderSeparator} /
 *   {@link import('./helpers.js').renderBox} / {@link import('./helpers.js').renderTable} /
 *   {@link import('./helpers.js').renderTree}). No second colorizer, no spinner / bar (that
 *   is the animation chunk), no buffering / capture (that is the capture chunk).
 * - **`status` is a narrative outcome, not a log level.** Its {@link StatusLevel} is
 *   `success` / `error` / `warn` / `info` (distinct from {@link LogLevel}); `error` routes to
 *   the sink's error stream.
 * - **Event-free.** No emitter — a pure formatting front-end. Each verb formats then
 *   writes immediately; there is no retained state worth observing.
 */
export interface ReporterInterface {
	/** Writes a titled separator block — a section heading framed by a horizontal rule. */
	section(title: string): void
	/** Writes a step line, optionally prefixed with its `[index/total]` {@link StepPosition}. */
	step(message: string, position?: StepPosition): void
	/** Writes a timing line — `label … 1.23s` (sub-second shown as `…ms`). */
	timing(label: string, ms: number): void
	/** Writes an icon + colored outcome line for `level` (`error` routes to the error stream). */
	status(level: StatusLevel, message: string): void
	/** Renders a {@link TableOptions} grid through {@link import('./helpers.js').renderTable} and writes it. */
	table(options: TableOptions): void
	/** Renders a {@link TreeOptions} tree through {@link import('./helpers.js').renderTree} and writes it. */
	tree(options: TreeOptions): void
	/** Renders a {@link BoxOptions} frame through {@link import('./helpers.js').renderBox} and writes it. */
	box(options: BoxOptions): void
	/** Writes one raw line, colored through the styler if any styling is embedded — no prefix, no icon. */
	line(text: string): void
	/** Writes `count` blank lines (default `1`). */
	blank(count?: number): void
}

// Console interception — taking control of the console on the read side. A `Capture` snapshots
// the configured global `console.*` methods, replaces them with wrappers that buffer each call
// (total + by level) as a frozen `CapturedMessage`, emit it on `capture`, optionally mirror it
// to the snapshot-original console, and optionally forward it to a `Sink`. Universal —
// `console.*` exists in browser + Node. It catches third-party `console.*`, never our own output:
// the default console sink (and so the Logger / Reporter) snapshots the real `console` at
// creation, so a Capture installed afterward never feeds our writes back into itself (the
// no-capture-loop principle). Process-global + non-reentrant — patching the one global `console`,
// so a single capture may be active at a time; two at once interleave / clobber each other's
// restore. Observable — a buffered, mirroring, forwarding interceptor with a lifecycle.

/**
 * Identifies one intercepted `console` method — the names a {@link CaptureInterface} patches and reports
 * under. A fixed set keyed off the universal `console.*` methods (`console.log` / `info` / `warn`
 * / `error` / `debug`); a named value family (it indexes {@link CAPTURE_LEVEL_MAP} to a
 * {@link LogLevel} for the optional sink forward), never a binary toggle — so it stays a union.
 *
 * @remarks
 * distinct from {@link LogLevel}: a `CaptureLevel` names the originating console method (which
 * `console.x` was called), not a severity threshold — there is no ordering and no gating (every
 * configured method is captured). `log` and `info` are separate methods (both default-stream),
 * mapped to the sink's default / `info` stream respectively; `warn` / `error` / `debug` map to
 * their matching {@link LogLevel}. The default configured set is {@link CAPTURE_LEVELS}.
 */
export type CaptureLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

/**
 * Represents one captured console call — an immutable, serializable record of a single intercepted
 * `console.*` invocation. A {@link CaptureInterface} builds one per call, freezes it, buffers it
 * (total + by level), and emits it on `capture`; every consumer reads this exact shape.
 *
 * @remarks
 * - `level` — the {@link CaptureLevel} naming which `console.x` was called.
 * - `text` — the call's arguments stringified into one line (see
 *   {@link import('./helpers.js').formatArgs}): an `Error` → `name: message`, a plain object →
 *   circular-safe `JSON.stringify`, anything else → `String(arg)`, all space-joined.
 * - `time` — the capture instant as epoch milliseconds (`Date.now()`); a plain number so the
 *   record stays serializable (no `Date` to clone) and orderable — the same convention as
 *   {@link LogRecord.time}.
 * - The value is frozen at construction — a consumer reads it, never mutates it.
 */
export interface CapturedMessage {
	readonly level: CaptureLevel
	readonly text: string
	readonly time: number
}

/**
 * Declares the observable events a {@link CaptureInterface} emits.
 *
 * @remarks
 * - `capture` — the core event: fires for every intercepted `console.*` call (one per call,
 *   while active), carrying the frozen {@link CapturedMessage}. The hook a live console viewer /
 *   tee rides.
 * - `start` / `stop` — the lifecycle signals: `start` fires when interception is installed (the
 *   first `start()` on an inactive capture), `stop` when it is torn down (a `stop()` on an active
 *   capture, and from `destroy()`); both are pure signals (empty tuples) so a consumer can mirror
 *   the global-patch lifecycle (for example log that capture is engaged). They earn their place by
 *   bracketing the process-global side effect a consumer needs to observe.
 *
 * Listener isolation is the emitter's: a listener throw routes to the emitter's `error`
 * handler, never onto this map — so a buggy `capture` listener can never perturb interception (or
 * the underlying program's own `console.*` call). Declared as a `type` alias (not
 * `interface extends EventMap`): a type-literal satisfies the `EventMap` constraint
 * structurally, whereas an interface lacks the index signature.
 */
export type CaptureEventMap = {
	/** Fires on an intercepted `console.*` call — the frozen {@link CapturedMessage}. */
	readonly capture: readonly [message: CapturedMessage]
	/** Fires after interception was installed (an inactive capture's `start()`). */
	readonly start: readonly []
	/** Fires after interception was torn down (an active capture's `stop()` / `destroy()`). */
	readonly stop: readonly []
}

/**
 * Configures the {@link import('./Capture.js').Capture} constructor.
 *
 * @remarks
 * - `on` — the reserved {@link EmitterHooks} key: initial listeners for the
 *   {@link CaptureEventMap}, wired at construction (for example `{ capture: (m) => tee(m) }`).
 * - `error` — the emitter's listener-error handler; a listener throw routes here.
 * - `levels` — which `console.*` methods to intercept; defaults to {@link CAPTURE_LEVELS}. Only the
 *   listed methods are patched — an unlisted method is left untouched and its calls pass through
 *   normally.
 * - `mirror` — when `true`, each intercepted call is also forwarded to the snapshot-original
 *   `console` method, so the program's own console output still appears while being captured;
 *   defaults to `false` (capture silently). Mirrors through the method snapshotted at `start()`,
 *   never the live (re-patched) one — no echo loop.
 * - `sink` — an optional {@link SinkInterface} each intercepted call is also written to
 *   (`sink.write(text, level)` with the {@link CaptureLevel} mapped to a {@link LogLevel} through
 *   {@link CAPTURE_LEVEL_MAP}), to tee captured output into the logging pipeline / a file. Absent
 *   ⇒ no forward.
 * - `limit` — the bounded buffer cap: at most this many recent messages are retained per buffer
 *   (the total buffer and each by-level bucket; oldest dropped first). Defaults to
 *   {@link DEFAULT_CAPTURE_LIMIT}; never unbounded (a long capture can't grow without bound — the
 *   same retention precedent as {@link LoggerInterface}).
 */
export interface CaptureOptions {
	readonly on?: EmitterHooks<CaptureEventMap>
	readonly error?: EmitterErrorHandler
	readonly levels?: readonly CaptureLevel[]
	readonly mirror?: boolean
	readonly sink?: SinkInterface
	readonly limit?: number
}

/**
 * Declares an observable console interceptor — it takes control of the global `console.*` on
 * the read side: while `active`, every configured `console.x` call is captured as a frozen
 * {@link CapturedMessage}, buffered (total + by level, bounded), emitted on `capture`, and —
 * per options — mirrored to the real console, forwarded to a {@link SinkInterface}, or both.
 *
 * @remarks
 * - **Snapshot-at-start.** `start()` snapshots the current `console[level]` for each configured
 *   {@link CaptureLevel}, then installs the wrappers. The mirror writes through that snapshot, so
 *   our own console sink output (the Logger / Reporter, which snapshot the real `console` at
 *   creation) is never recaptured — `Capture` catches third-party `console.*`, not our writes
 *   (the no-capture-loop principle). Create your loggers before installing a capture.
 * - **Idempotent + non-reentrant.** `start()` while already `active` is a no-op (it never
 *   double-patches), and `stop()` while inactive is a no-op. It is process-global — it patches the
 *   one global `console` — so at most one capture may be active at a time; running two
 *   concurrently interleaves their buffers and clobbers each other's restore.
 * - **Bounded buffers.** `messages()` returns a copy of the whole buffer (oldest first);
 *   `messages(level)` a copy of one {@link CaptureLevel}'s bucket — each capped at `limit`
 *   (oldest dropped first), never unbounded. `clear()` empties them (it does not stop interception).
 * - **Lifecycle.** `start` / `stop` toggle interception; `destroy()` stops (restoring
 *   `console`) then destroys the emitter (its listeners go).
 */
export interface CaptureInterface {
	readonly emitter: EmitterInterface<CaptureEventMap>
	/** Reports whether interception is installed (between `start()` and `stop()`). */
	readonly active: boolean
	/** Snapshots the configured `console.*` and installs the interceptors — a no-op when already `active`. */
	start(): void
	/** Restores the snapshot-original `console.*` — a no-op when not `active`. */
	stop(): void
	/** Returns a copy of the whole captured buffer, oldest first (capped at `limit`). */
	messages(): readonly CapturedMessage[]
	/** Returns a copy of the captured buffer for one {@link CaptureLevel}, oldest first (capped at `limit`). */
	messages(level: CaptureLevel): readonly CapturedMessage[]
	/** Drops every buffered message (total + by level); does not stop interception. */
	clear(): void
	/** Tears down — `stop()` (restoring `console`) then destroys the emitter. */
	destroy(): void
}

/**
 * Represents the structured outcome of {@link import('./factories.js').createCaptureResult} — the wrapped function's
 * own return `value` plus the {@link CapturedMessage}s intercepted while it ran.
 *
 * @remarks
 * - `value` — whatever the wrapped `fn` returned (its `T`).
 * - `messages` — the buffer captured during the run, oldest first (a copy; the capture is stopped
 *   and discarded by the time this is returned).
 */
export interface CaptureResult<T> {
	readonly value: T
	readonly messages: readonly CapturedMessage[]
}

// Live activity animations — pure frame producers over the same substrate (the one `Styler`, the
// one `Sink`). A `Spinner` is a self-driving glyph cycle (a periodic timer advances the frame); a
// `Progress` is an update-driven bar. Both build a frame line and write `\r` + that line to an
// injected `Sink`, then emit it — but the actual line-overwrite is the sink's job: a TTY sink
// makes the leading `\r` overwrite for a smooth animation, while a browser / plain sink drops
// `\r` to the start of a fresh, non-overwriting line (the locked decision). Universal — `Sink` + a
// timer + the styler, no `node:*`, no `process.stdout`. The bar string itself is rendered by the
// pure {@link import('./helpers.js').renderBar} (a sibling of the `render*` renderers). Both are
// observable: a spinner's frames + lifecycle, a progress's updates + its final outcome.

/**
 * Configures the pure {@link import('./helpers.js').renderBar} renderer — a determinate progress
 * bar string (`█████░░░░░ 50% (5/10)`), width-aware and styler-optional.
 *
 * @remarks
 * - `current` / `total` — the filled fraction is `current / total`, clamped to `[0, total]` (a
 *   `current` past `total` renders a full bar, a negative one an empty bar) — so a caller's overrun
 *   never produces an over-long bar. A `total` of `0` (or below) renders a full bar (nothing to do).
 * - `width` — the visible cell count of the bar track (the glyph run between no brackets); defaults
 *   to {@link DEFAULT_BAR_WIDTH}. The percentage + `(current/total)` count follow the track.
 * - `fill` — the filled-cell glyph; defaults to {@link BAR_FILL} (`█`). `empty` — the empty-cell
 *   glyph; defaults to {@link BAR_EMPTY} (`░`). Sized in visible columns ({@link
 *   import('./helpers.js').width}), so a multi-cell glyph still yields a `width`-wide track.
 * - `styler` — colors the filled run when supplied (the empty run + the trailing label stay plain);
 *   the layout is identical with or without color, since the track is measured on visible width.
 * - `style` — an optional by-value style rendered through `styler` for the filled run.
 */
export interface BarOptions {
	readonly current: number
	readonly total: number
	readonly width?: number
	readonly fill?: string
	readonly empty?: string
	readonly styler?: StylerInterface
	readonly style?: Style
}

/**
 * Declares the observable events a {@link SpinnerInterface} emits.
 *
 * @remarks
 * - `frame` — the core event: fires once per advance (every `tick()`, whether driven by the internal
 *   timer or called directly) and on the final `succeed` / `fail` line, carrying the rendered frame
 *   line (the same text written to the sink, minus the leading `\r`). The hook a non-sink consumer
 *   (a test, a remote mirror) rides to observe the animation without a terminal.
 * - `start` / `stop` — the lifecycle signals bracketing the internal timer: `start` fires when the
 *   timer is armed (the first `start()` on an inactive spinner), `stop` when it is cleared (a
 *   `stop()` / `succeed()` / `fail()` on an active spinner, and from `destroy()`); both pure signals
 *   (empty tuples) so a consumer can observe the activity lifecycle.
 *
 * Listener isolation is the emitter's: a listener throw routes to the emitter's `error`
 * handler, never onto this map. Declared as a `type` alias (not `interface extends EventMap`):
 * a type-literal satisfies the `EventMap` constraint structurally, whereas an interface lacks the
 * index signature.
 */
export type SpinnerEventMap = {
	/** Fires after a frame was produced (a `tick()` advance or the final `succeed` / `fail` line) — the rendered line. */
	readonly frame: readonly [line: string]
	/** Fires after the internal timer was armed (an inactive spinner's `start()`). */
	readonly start: readonly []
	/** Fires after the internal timer was cleared (an active spinner's `stop()` / `succeed()` / `fail()` / `destroy()`). */
	readonly stop: readonly []
}

/**
 * Configures the {@link import('./Spinner.js').Spinner} constructor.
 *
 * @remarks
 * - `on` — the reserved {@link EmitterHooks} key: initial listeners for the
 *   {@link SpinnerEventMap}, wired at construction.
 * - `error` — the emitter's listener-error handler; a listener throw routes here.
 * - `message` — the text shown beside the spinner glyph; defaults to `''` (a bare glyph). Changed
 *   live through `update(message)` and overridden by a `succeed` / `fail` argument.
 * - `frames` — the cycle of glyph frames the spinner advances through; defaults to
 *   {@link SPINNER_FRAMES} (the braille set `⠋⠙⠹…`). Each `tick()` advances to the next, wrapping.
 * - `interval` — the timer period in milliseconds between frames; defaults to
 *   {@link DEFAULT_SPINNER_INTERVAL}. The timer is always cleared on `succeed` / `fail` / `stop` /
 *   `destroy`, so it never leaks; tests drive frames deterministically through `tick()` (no real clock).
 * - `sink` — where each `\r` + frame line is written; defaults to
 *   {@link import('./factories.js').createConsoleSink}. A TTY sink overwrites on the `\r`.
 * - `styler` — the {@link StylerInterface} the glyph is colored through; defaults to
 *   {@link import('./factories.js').createStyler} (ANSI). The one styler the whole system shares.
 * - `theme` — the {@link Theme} supplying the accent and outcome roles; defaults to
 *   {@link DEFAULT_THEME}.
 */
export interface SpinnerOptions {
	readonly on?: EmitterHooks<SpinnerEventMap>
	readonly error?: EmitterErrorHandler
	readonly message?: string
	readonly frames?: readonly string[]
	readonly interval?: number
	readonly sink?: SinkInterface
	readonly styler?: StylerInterface
	readonly theme?: Theme
}

/**
 * Declares a self-driving, observable activity spinner — a glyph cycle that advances on a
 * periodic timer, writing each `\r` + frame line to its {@link SinkInterface} and emitting it on
 * `frame`. The line-overwrite is the sink's job (a TTY sink overwrites on the `\r`; a plain sink
 * degrades to a fresh line).
 *
 * @remarks
 * - **Self-driving but deterministically testable.** `start()` arms a `setInterval` (universal — no
 *   `node:*`) that calls `tick()` each `interval`; each `tick()` advances the frame index, builds the
 *   styled `glyph + message` line, emits it on `frame`, and writes `'\r' + line` to the sink. A test
 *   drives frames by calling `tick()` directly (no real clock) and proves the timer arms / clears
 *   with fake timers — the timer is always cleared on `succeed` / `fail` / `stop` / `destroy`, so it
 *   never leaks.
 * - **Idempotent `start`.** A `start()` while already `active` is a no-op (it never arms a second
 *   timer). `active` reflects whether the timer is armed.
 * - **Outcome lines.** `succeed(message?)` / `fail(message?)` clear the timer, then write + emit a
 *   final line — the theme's success / error status icon + style (`✔` / `✖` by default) + the
 *   message — terminated by a newline (the activity is over; the line is committed, not overwritten).
 *   `fail` routes to the sink's error stream.
 * - **Lifecycle.** `stop()` clears the timer and leaves the current line (no final write);
 *   `destroy()` stops then destroys the emitter. `update(message)` swaps the message (re-rendering
 *   immediately when active, so the change shows without waiting for the next tick).
 */
export interface SpinnerInterface {
	readonly emitter: EmitterInterface<SpinnerEventMap>
	/** Reports whether the internal timer is armed (between `start()` and `stop` / `succeed` / `fail`). */
	readonly active: boolean
	/** Holds the current message shown beside the glyph. */
	readonly message: string
	/** Arms the periodic timer and renders the first frame — a no-op when already `active`. */
	start(): void
	/** Advances one frame: builds the line, emits `frame`, and writes `\r` + line to the sink. */
	tick(): void
	/** Changes the message; re-renders immediately when `active` so the change shows at once. */
	update(message: string): void
	/** Stops with a success line — clears the timer, writes + emits `✔ message` + newline. */
	succeed(message?: string): void
	/** Stops with an error line — clears the timer, writes + emits `✖ message` + newline (error stream). */
	fail(message?: string): void
	/** Clears the timer and leaves the current line (no final write) — a no-op when not `active`. */
	stop(): void
	/** Tears down — `stop()` then destroys the emitter. */
	destroy(): void
}

/**
 * Declares the bounded, level-keyed retention buffer a capture keeps its records in — one capped total
 * buffer plus one capped bucket per level configured at construction.
 *
 * @remarks
 * - **Bounded on both axes.** The total buffer and each bucket are capped at the same `limit`,
 *   dropping the oldest record first, so neither can grow without bound.
 * - **Buckets are fixed at construction.** A record whose `level` has no bucket still joins the
 *   total buffer, and `records(level)` for an unconfigured level returns an empty list rather than
 *   failing.
 * - **Copies out.** Each `records` call returns a fresh list, so a caller can never mutate the
 *   retained state through the value it receives.
 */
export interface RetentionInterface<T extends { readonly level: string }> {
	/** Retains one record — appends it to the total buffer and to its level's bucket, evicting the oldest of each past the cap. */
	add(record: T): void
	/** Returns a copy of the whole retained buffer, oldest first. */
	records(): readonly T[]
	/** Returns a copy of one level's bucket, oldest first; empty for a level with no bucket. */
	records(level: T['level']): readonly T[]
	/** Drops every retained record from the total buffer and every bucket. */
	clear(): void
}

/**
 * Reports one advance of a {@link ProgressInterface} — the clamped `{ current, total }` payload
 * carried by the `update` event of {@link ProgressEventMap}.
 *
 * @remarks
 * `current` is always the value after clamping into `[0, total]`, so a listener never sees an
 * overrun or a negative. `total` is the bar's fixed target, repeated on every report so a listener
 * needs no reference to the bar itself. The same record is emitted from `update`, `succeed`, and
 * `fail`.
 */
export interface ProgressReport {
	readonly current: number
	readonly total: number
}

/**
 * Declares the observable events a {@link ProgressInterface} emits.
 *
 * @remarks
 * - `update` — the core event: fires on every `update(current)` (and on `succeed` / `fail`),
 *   carrying the `{ current, total }` progress (the clamped `current`). The hook a non-sink consumer
 *   rides to observe progress without a terminal.
 * - `succeed` — the terminal signal: fires once from `succeed()` (a successful finish), a pure
 *   signal (empty tuple) so a consumer can observe the bar reaching its end. (`fail()` emits a final
 *   `update` and routes its line to the error stream, but is not a `succeed` — the bar's positive
 *   outcome is the same word the spinner and the reporter use.)
 *
 * Listener isolation is the emitter's. Declared as a `type` alias (not
 * `interface extends EventMap`): a type-literal satisfies the `EventMap` constraint
 * structurally, whereas an interface lacks the index signature.
 */
export type ProgressEventMap = {
	/** Reports progress advancing — the clamped `{ current, total }` (fires on `update` and on `succeed` / `fail`). */
	readonly update: readonly [progress: ProgressReport]
	/** Fires after the bar reached its end through `succeed()` (a successful finish). */
	readonly succeed: readonly []
}

/**
 * Configures the {@link import('./Progress.js').Progress} constructor.
 *
 * @remarks
 * - `on` — the reserved {@link EmitterHooks} key: initial listeners for the
 *   {@link ProgressEventMap}, wired at construction.
 * - `error` — the emitter's listener-error handler; a listener throw routes here.
 * - `total` — the value `current` advances toward (the `100%` point); the only required option.
 * - `message` — text shown after the bar; defaults to `''`. Overridden per-`update` and by a
 *   `succeed` / `fail` argument.
 * - `width` — the bar track's visible cell count, handed to {@link import('./helpers.js').renderBar};
 *   defaults to {@link DEFAULT_BAR_WIDTH}.
 * - `fill` / `empty` — the filled and empty track glyphs handed to
 *   {@link import('./helpers.js').renderBar}; default to {@link BAR_FILL} / {@link BAR_EMPTY}.
 * - `sink` — where each `\r` + bar line is written; defaults to
 *   {@link import('./factories.js').createConsoleSink}. A TTY sink overwrites on the `\r`.
 * - `styler` — the {@link StylerInterface} the filled run is colored through; defaults to
 *   {@link import('./factories.js').createStyler} (ANSI). The one styler the whole system shares.
 * - `theme` — the {@link Theme} supplying the filled run's accent role; defaults to
 *   {@link DEFAULT_THEME}.
 */
export interface ProgressOptions {
	readonly on?: EmitterHooks<ProgressEventMap>
	readonly error?: EmitterErrorHandler
	readonly total: number
	readonly message?: string
	readonly width?: number
	readonly fill?: string
	readonly empty?: string
	readonly sink?: SinkInterface
	readonly styler?: StylerInterface
	readonly theme?: Theme
}

/**
 * Declares an update-driven, observable progress bar — `update(current)` recomputes the bar through
 * {@link import('./helpers.js').renderBar}, writes `\r` + bar to its {@link SinkInterface}, and emits
 * the `{ current, total }` on `update`. The line-overwrite is the sink's job (a TTY sink overwrites
 * on the `\r`; a plain sink degrades to a fresh line). No self-timer — the caller drives it.
 *
 * @remarks
 * - **Update-driven.** Each `update(current, message?)` clamps `current` to `[0, total]`, renders
 *   the bar (filled to `current / total`, with the trailing `percent (current/total)` + message),
 *   emits `update`, and writes `'\r' + bar`. There is no internal timer (unlike {@link
 *   SpinnerInterface}) — progress advances only when the caller reports it.
 * - **Outcome lines.** `succeed(message?)` renders a full bar (`current = total`) + message,
 *   terminated by a newline, emits a final `update` then `succeed`, and marks `succeeded`.
 *   `fail(message?)` renders the bar at its current fill + message + newline and routes to the sink's
 *   error stream (no `succeed` — the work did not finish). Both are terminal: a later `update` after
 *   a `succeed` / `fail` is ignored (`active` is `false`).
 * - **Bounded.** `current` is always clamped to `[0, total]`; `succeeded` reports whether
 *   `succeed()` has run; `active` is `true` until a `succeed` / `fail`.
 */
export interface ProgressInterface {
	readonly emitter: EmitterInterface<ProgressEventMap>
	/** Reports whether the bar is still advancing (before any `succeed()` / `fail()`). */
	readonly active: boolean
	/** Reports whether `succeed()` has run (the bar finished successfully). */
	readonly succeeded: boolean
	/** Holds the current value, clamped to `[0, total]`. */
	readonly current: number
	/** Holds the target value the bar fills toward. */
	readonly total: number
	/** Reports progress: clamps `current`, re-renders the bar, emits `update`, writes `\r` + bar. Ignored once terminal. */
	update(current: number, message?: string): void
	/** Finishes successfully — renders a full bar + newline, emits a final `update` then `succeed`. */
	succeed(message?: string): void
	/** Finishes unsuccessfully — renders the bar at its current fill + newline to the error stream (no `succeed`). */
	fail(message?: string): void
	/** Tears down — destroys the emitter. */
	destroy(): void
}
