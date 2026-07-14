import type { EmitterErrorHandler, EmitterHooks, EmitterInterface } from '@orkestrel/emitter'

// The console-method shape the {@link CaptureInterface} patch swaps in — a variadic sink of
// arbitrary arguments, exactly the universal `console.log` / `info` / `warn` / `error` / `debug`
// signature. It types the GLOBAL `console` viewed as a record keyed by {@link CaptureLevel} (every
// `CaptureLevel` IS a real `Console` method, so `console` is assignable to that view with no `as`,
// keeping the global-patch boundary honest, §14) — the boundary shape the capture snapshots + swaps.
export type ConsoleMethod = (...args: unknown[]) => void

// The console style engine — text style is DATA, rendered by a swappable renderer.
// A `Style` is a frozen record (a foreground/background `Color` + a set of text
// `Attribute`s), NOT a pre-baked escape string; a `RendererInterface` turns that data
// into output for one target (the default is ANSI/SGR; a browser `%c`/CSS renderer
// swaps in at the same seam). The `StylerInterface` is the fluent surface that builds a
// `Style` and renders it through the injected renderer. Event-free (AGENTS §13) — a
// pure styling primitive, like `Scheduler`.

/**
 * A named terminal color — the 8 standard base colors, their 8 bright variants, and
 * `default` (the target's own default ink, emitting no color code).
 *
 * @remarks
 * Style as DATA: a `Color` is a name, not an escape sequence. The renderer maps it to
 * its target's codes — the ANSI renderer to SGR 30–37 / 90–97 (foreground) and 40–47 /
 * 100–107 (background); a browser renderer maps the SAME names to CSS colors.
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
 * A text-style attribute — the six standard SGR text effects.
 *
 * @remarks
 * Style as DATA: an `Attribute` is a name. The ANSI renderer maps each to its SGR
 * on-code (`bold` → 1, `dim` → 2, `italic` → 3, `underline` → 4, `inverse` → 7,
 * `strikethrough` → 9), composing several at once; a browser renderer maps the same
 * names to CSS (`font-weight`, `font-style`, `text-decoration`, …).
 */
export type Attribute = 'bold' | 'dim' | 'italic' | 'underline' | 'inverse' | 'strikethrough'

/**
 * Text style as DATA — a frozen, readonly record of a foreground color, a background
 * color, and a set of text attributes. The single style value the whole console /
 * terminal system shares; a {@link RendererInterface} renders it for one target.
 *
 * @remarks
 * - `foreground` / `background` are absent (not `'default'`) when unset — the renderer
 *   emits a color code only for a set, non-`default` color.
 * - `attributes` is a de-duplicated, order-stable list (a set modelled as an array so
 *   the value stays plain JSON data — no `Set` to clone or serialize). An empty list +
 *   no colors is the EMPTY style, which renders text unchanged.
 * - The value is deeply frozen; compose a new style with the styler rather than mutating.
 */
export interface Style {
	readonly foreground?: Color
	readonly background?: Color
	readonly attributes: readonly Attribute[]
}

/**
 * A swappable style renderer — the seam that turns style DATA into output for ONE
 * target. The cross-environment default is the ANSI renderer (SGR escape codes); a
 * browser `%c` / CSS renderer implements the SAME contract over the SAME {@link Style}
 * model, so it drops in without touching the style data (the C-f browser branch).
 */
export interface RendererInterface {
	/**
	 * Render `text` wrapped in the target codes for `style`. The EMPTY style (no colors,
	 * no attributes) and the empty string both return `text` unchanged — no wrapping.
	 */
	render(style: Style, text: string): string
}

/**
 * Options for {@link createStyler}.
 *
 * @remarks
 * - `renderer` — the {@link RendererInterface} every style renders through; defaults to
 *   the ANSI renderer (the cross-environment default), so the styler works unchanged in
 *   any terminal. Inject a browser `%c` renderer (C-f) to retarget with no other change.
 * - `enabled` — the no-color switch. When `false`, the styler returns text VERBATIM
 *   (for a non-TTY, a `NO_COLOR` environment, or piped output); defaults to `true`.
 */
export interface StylerOptions {
	readonly renderer?: RendererInterface
	readonly enabled?: boolean
}

/**
 * The fluent, composable styling surface — the consumer-facing API. It is BOTH a
 * function (call it with text to render the accumulated style) AND a record of
 * chainable accessors: every {@link Color} and {@link Attribute} is a getter returning a
 * NEW styler with that token added, so `styler.red.bold('hi')` and
 * `styler.red(styler.bold('hi'))` both work and nothing is mutated.
 *
 * @remarks
 * - Each accessor returns a fresh `StylerInterface` (immutable, copy-on-write) — a base
 *   styler is reusable and the chains never interfere.
 * - Calling the styler builds the {@link Style} under the hood and renders it through the
 *   injected renderer. When `enabled` is `false`, it returns the text verbatim.
 * - `style` exposes the accumulated style DATA (the empty style on a base styler), and
 *   `enabled` reflects the switch — both inspectable and testable.
 * - A later color of the same channel wins (`styler.red.blue` is blue); a repeated
 *   attribute is idempotent (`styler.bold.bold` carries one `bold`).
 */
export interface StylerInterface {
	/** Render the accumulated style around `text` (verbatim when `enabled` is `false`). */
	(text: string): string
	/** The accumulated style DATA — the empty style on a base styler. */
	readonly style: Style
	/** Whether styling is applied; when `false`, calls return text unchanged. */
	readonly enabled: boolean
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

// Structured logging — the record + event ARE the transport seam. A `Logger` builds an
// immutable `LogRecord` per call, gates it by an ascending-severity `LogLevel`, emits it
// on `entry` ALWAYS (the pluggable-transport hook — file / JSON / remote sinks hang off
// `emitter.on('entry')`), and — unless silent — formats it into a styled line through the
// shared `Styler` and writes it to a `Sink`. `LoggerManager` is an event-free §9 registry
// of loggers + a convenience fan-out. Styling is ORTHOGONAL to level (a level's color is a
// style choice, never a separate level — no `success`/`ready` pseudo-levels).

/**
 * The severity level of a {@link LogRecord} — one coherent, ascending-severity scale.
 *
 * @remarks
 * Ordered least-to-most severe: `debug` < `info` < `warn` < `error`. A {@link LoggerInterface}
 * gates by THRESHOLD — a record at or above the logger's `level` is kept (and written),
 * one below it is dropped (see {@link LEVEL_SEVERITY} for the numeric order). A level is a
 * level — its visual treatment (color) is a separate styling concern, NEVER a pseudo-level
 * like `success` / `ready`.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * One immutable, serializable log entry — the universal record the whole logging system
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
 *   no context was supplied.
 * - The value is frozen at construction — a consumer reads it, never mutates it.
 */
export interface LogRecord {
	readonly level: LogLevel
	readonly message: string
	readonly time: number
	readonly name?: string
	readonly data?: Record<string, unknown>
}

/**
 * The minimal output primitive — the seam every formatted line is written through. A
 * `Sink` is the ONE place text leaves the logging system; redirect output (to a file, a
 * buffer, a test recorder, the browser `%c` path, a server TTY) by supplying a different
 * `SinkInterface`, with no change to the logger.
 *
 * @remarks
 * - **`write(text)` is the whole contract.** A custom sink (file / buffer / recorder)
 *   implements just `write(text)` and ignores the rest — the optional `level` exists ONLY so
 *   a stream-aware sink can ROUTE. The logger passes the originating record's {@link LogLevel}.
 * - **The default {@link import('./factories.js').createConsoleSink} routes by level** —
 *   `error` → `console.error`, `warn` → `console.warn`, everything else → `console.log` — and
 *   writes to the UNDERLYING `console` methods SNAPSHOTTED at creation, so a later `Capture`
 *   that patches `console` can never feed the sink's own output back into itself (the
 *   no-capture-loop principle). The same `level` seam lets the C-g server TTY sink send
 *   `error` / `warn` to `stderr`.
 */
export interface SinkInterface {
	/**
	 * Write one already-formatted chunk of output (the logger writes a full line; the sink's
	 * target supplies the newline). `level` is the originating record's {@link LogLevel} —
	 * supplied so a stream-aware sink can route (e.g. `error` to `stderr`); a plain sink ignores it.
	 */
	write(text: string, level?: LogLevel): void
}

/**
 * The observable events a {@link LoggerInterface} emits (AGENTS §13) — the transport seam.
 *
 * @remarks
 * `entry` fires for EVERY accepted record (one that passed the level gate), carrying the
 * frozen {@link LogRecord} — even when the logger is `silent` (silence suppresses only the
 * SINK WRITE, never the event, so transports keep receiving records). Listener isolation is
 * the emitter's (§13): a listener throw routes to the emitter's `error` handler, never onto
 * this map — so a buggy transport can never perturb logging.
 *
 * Declared as a `type` alias (not `interface extends EventMap`, §4.5): a type-literal
 * satisfies the `EventMap` constraint structurally, whereas an interface lacks the index signature.
 */
export type LoggerEventMap = {
	/** A record was logged (passed the level gate) — the frozen {@link LogRecord}. */
	readonly entry: readonly [record: LogRecord]
}

/**
 * Options for `createLogger` / the {@link LoggerInterface} constructor.
 *
 * @remarks
 * - `on` — the reserved {@link EmitterHooks} key (§8): initial listeners for the
 *   {@link LoggerEventMap}, wired at construction (e.g. `{ entry: (r) => sink2.write(...) }`).
 * - `error` — the emitter's listener-error handler (§13); a listener throw routes here.
 * - `level` — the severity THRESHOLD; records below it are dropped. Defaults to `info`.
 * - `name` — the logger's name, stamped onto every {@link LogRecord} (`record.name`) and
 *   shown in the formatted line. A manager registers each logger under its name.
 * - `sink` — where formatted lines are written; defaults to
 *   {@link import('./factories.js').createConsoleSink} (the snapshotted-console sink).
 * - `styler` — the {@link StylerInterface} the line is colored through; defaults to
 *   {@link import('./factories.js').createStyler} (ANSI). Styling is orthogonal to level.
 * - `limit` — the bounded retention cap: at most this many recent records are kept
 *   (oldest dropped first). Defaults to {@link DEFAULT_LOG_LIMIT}; never unbounded.
 * - `silent` — when `true`, suppresses the SINK WRITE only; `entry` still fires and the
 *   record is still retained. Defaults to `false`.
 */
export interface LoggerOptions {
	readonly on?: EmitterHooks<LoggerEventMap>
	readonly error?: EmitterErrorHandler
	readonly level?: LogLevel
	readonly name?: string
	readonly sink?: SinkInterface
	readonly styler?: StylerInterface
	readonly limit?: number
	readonly silent?: boolean
}

/**
 * An observable, leveled logger — builds a frozen {@link LogRecord} per call, gates it by
 * severity, retains a bounded tail, emits it on `entry`, and (unless silent) writes a
 * styled line to its {@link SinkInterface}.
 *
 * @remarks
 * - **Leveled.** Each of `debug` / `info` / `warn` / `error` builds a record at that
 *   {@link LogLevel}; a record below the logger's `level` threshold is dropped entirely (no
 *   event, no retention, no write).
 * - **Transport seam (§13).** An accepted record ALWAYS fires `entry` (even when `silent`),
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
	/** Log at `debug` — dropped unless the logger's `level` is `debug`. */
	debug(message: string, data?: Record<string, unknown>): void
	/** Log at `info`. */
	info(message: string, data?: Record<string, unknown>): void
	/** Log at `warn`. */
	warn(message: string, data?: Record<string, unknown>): void
	/** Log at `error`. */
	error(message: string, data?: Record<string, unknown>): void
	/** The bounded tail of recent {@link LogRecord}s, oldest first (capped at `limit`). */
	entries(): readonly LogRecord[]
	/** Drop every retained record (does not touch listeners). */
	clear(): void
	/** Tear down — clear retention and destroy the emitter. */
	destroy(): void
}

/**
 * Options for `createLoggerManager` / the {@link LoggerManagerInterface} constructor.
 *
 * @remarks
 * The manager is an event-free registry (§9) — it carries NO emitter of its own (each
 * registered {@link LoggerInterface} owns its observable `emitter`). These options supply
 * the DEFAULTS flowed into every logger the manager mints, unless a per-`register` override
 * wins: `level` (default threshold), `sink` (shared output target), `styler` (shared
 * coloring), `limit` (retention cap), and `silent`.
 */
export interface LoggerManagerOptions {
	readonly level?: LogLevel
	readonly sink?: SinkInterface
	readonly styler?: StylerInterface
	readonly limit?: number
	readonly silent?: boolean
}

/**
 * An event-free registry of named {@link LoggerInterface}s plus a convenience fan-out — the
 * §9 manager over the logging layer. It mints + stores loggers keyed by `name`, looks them
 * up, removes them, and broadcasts a one-off log to EVERY registered logger.
 *
 * @remarks
 * - **Registry (§9).** `register(name, options?)` mints a {@link LoggerInterface} (named
 *   `name`, the manager's defaults flowing in unless `options` overrides them), stores it
 *   (a re-`register` of the same name OVERWRITES — last write wins), and returns it.
 *   `logger(name)` looks one up; `loggers()` lists them in insertion order; `count` is the size.
 * - **Removal (§9.2).** `remove()` clears ALL, `remove(name)` drops ONE, `remove(names)` drops
 *   a batch (`true` when any was removed). `clear()` empties the registry.
 * - **Fan-out.** `debug` / `info` / `warn` / `error(message, data?)` forward the call to every
 *   registered logger (each gates / emits / writes per its own `level` and `sink`).
 * - **Event-free.** No emitter, no events — each logger carries its own observability; the
 *   manager is a pure registry (like {@link import('../agents/conversations/ConversationManager.js').ConversationManager}).
 */
export interface LoggerManagerInterface {
	readonly count: number
	register(name: string, options?: LoggerOptions): LoggerInterface
	logger(name: string): LoggerInterface | undefined
	loggers(): readonly LoggerInterface[]
	/** Fan out a `debug` log to every registered logger. */
	debug(message: string, data?: Record<string, unknown>): void
	/** Fan out an `info` log to every registered logger. */
	info(message: string, data?: Record<string, unknown>): void
	/** Fan out a `warn` log to every registered logger. */
	warn(message: string, data?: Record<string, unknown>): void
	/** Fan out an `error` log to every registered logger. */
	error(message: string, data?: Record<string, unknown>): void
	remove(): void
	remove(name: string): boolean
	remove(names: readonly string[]): boolean
	clear(): void
}

// Narrative reporting — the pure LAYOUT renderers + a lean `Reporter` front-end. This is
// human / build-run NARRATION (sections, steps, timings, tables, trees, boxes), DISTINCT
// from structured logging (above) but sharing the SAME substrate: the one `Styler` (colors +
// the ANSI-aware `width`) and the one `Sink`. The renderers are pure `options → string`,
// universal, and width-aware (they align on the VISIBLE width so ANSI-styled content keeps
// its columns); the `Reporter` formats through them and writes to the sink. Event-free
// (§13) — a formatting / output front-end with no observable lifecycle, like the renderers.

/**
 * Horizontal text alignment within a fixed-width cell — the conventional three-value set a
 * {@link ColumnSpec} (and the box / separator title) aligns by. A value pair / set, not a
 * binary toggle (§4.4), so it stays a union.
 */
export type Alignment = 'left' | 'center' | 'right'

/**
 * A box-drawing border style — the four standard Unicode line weights the renderers frame
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
 * One complete box-drawing junction set for a {@link BorderStyle} — every glyph the box /
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
 * Options for {@link import('./helpers.js').renderSeparator} — a horizontal rule, optionally
 * carrying a centered title.
 *
 * @remarks
 * - `title` — text to embed in the rule (e.g. a section heading). Omitted ⇒ an unbroken line.
 * - `width` — the visible column count of the whole rule; defaults to {@link DEFAULT_WIDTH}.
 * - `fill` — the single character the rule is drawn with; defaults to {@link SEPARATOR_FILL}
 *   (`─`). The VISIBLE width of the rule is `width` regardless of the fill's escape codes.
 * - `styler` — colors the rule (and the embedded title) when supplied; the layout is
 *   identical with or without it, since width is measured on the visible content.
 */
export interface SeparatorOptions {
	readonly title?: string
	readonly width?: number
	readonly fill?: string
	readonly styler?: StylerInterface
}

/**
 * Options for {@link import('./helpers.js').renderBox} — content framed in box-drawing
 * characters.
 *
 * @remarks
 * - `content` — the body text; embedded newlines split it into lines, each framed on its own
 *   row. Every row is padded to the inner width measured by {@link import('./helpers.js').width}
 *   (the VISIBLE width), so ANSI-styled content stays aligned inside the frame.
 * - `title` — an optional caption embedded in the TOP border.
 * - `padding` — horizontal cells of blank padding inside each vertical edge; defaults to
 *   {@link DEFAULT_PADDING}.
 * - `border` — the {@link BorderStyle}; defaults to {@link DEFAULT_BORDER} (`single`).
 * - `width` — the total visible width of the box. When omitted, the box hugs its widest line
 *   (plus padding + borders); when supplied, narrower lines pad out and the box is exactly
 *   that wide (content wider than the budget is not truncated — `renderTable` is the
 *   width-bounded renderer).
 * - `styler` — colors the border (and title) when supplied; alignment is unaffected.
 */
export interface BoxOptions {
	readonly content: string
	readonly title?: string
	readonly padding?: number
	readonly border?: BorderStyle
	readonly width?: number
	readonly styler?: StylerInterface
}

/**
 * One column of a {@link TableOptions} — its header label and how its cells align.
 *
 * @remarks
 * - `label` — the header text shown in the table's first row.
 * - `align` — how this column's header and cells align within the column width; defaults to
 *   {@link DEFAULT_ALIGN} (`left`). The column is sized to the widest VISIBLE content
 *   (header or any cell, measured by {@link import('./helpers.js').width}), so a styled cell
 *   never breaks the column.
 */
export interface ColumnSpec {
	readonly label: string
	readonly align?: Alignment
}

/**
 * Options for {@link import('./helpers.js').renderTable} — a bordered grid of columns + rows
 * with per-column alignment and width-aware sizing.
 *
 * @remarks
 * - `columns` — the {@link ColumnSpec}s, left to right; their `label`s form the header row.
 * - `rows` — the body, one `readonly string[]` per row. A short row is padded with empty
 *   cells, an over-long row is truncated to the column count, so a ragged input never throws.
 * - `border` — the {@link BorderStyle} the frame + header rule + column separators draw in;
 *   defaults to {@link DEFAULT_BORDER} (`single`).
 * - `styler` — colors the border + header labels when supplied; the cells are written as
 *   given (already-styled cells are honored — their VISIBLE width drives column sizing, never
 *   their raw `.length`).
 */
export interface TableOptions {
	readonly columns: readonly ColumnSpec[]
	readonly rows: readonly (readonly string[])[]
	readonly border?: BorderStyle
	readonly styler?: StylerInterface
}

/**
 * One node of a {@link TreeOptions} tree — a label plus optional children, recursively.
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
 * Options for {@link import('./helpers.js').renderTree} — a nested {@link TreeNode} tree drawn
 * with box-drawing connectors.
 *
 * @remarks
 * - `root` — the top {@link TreeNode}; its `label` is the unindented first line and its
 *   `children` descend beneath it (`├─` for each but the last, `└─` for the last, `│` guides
 *   carried down through earlier branches).
 * - `styler` — colors the connectors when supplied; node labels are written as given.
 */
export interface TreeOptions {
	readonly root: TreeNode
	readonly styler?: StylerInterface
}

/**
 * A narrative outcome level — the four states {@link ReporterInterface.status} reports, each
 * with its own icon + color ({@link STATUS_ICONS} / {@link STATUS_COLORS}).
 *
 * @remarks
 * DISTINCT from {@link LogLevel} (`debug` / `info` / `warn` / `error`): a `StatusLevel` is a
 * narrative OUTCOME (did the step success?), not a log SEVERITY threshold — there is no
 * ordering and no gating. `success` (`✔`, green), `error` (`✖`, red), `warn` (`⚠`, yellow),
 * `info` (`ℹ`, blue). `error` routes to the sink's error stream (the `level` hint passed to
 * {@link SinkInterface.write}); the other three go to the default stream.
 */
export type StatusLevel = 'success' | 'error' | 'warn' | 'info'

/**
 * A step's position in a sequence — the `{ index, total }` a {@link ReporterInterface.step}
 * renders as a `[2/5]` prefix.
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
 * Options for {@link createReporter} / the {@link ReporterInterface} constructor.
 *
 * @remarks
 * - `sink` — where every formatted line is written; defaults to
 *   {@link import('./factories.js').createConsoleSink} (the snapshotted, level-routing console
 *   sink) — the SAME seam the logger writes through. A `status('error', …)` passes the
 *   `error` level so a stream-aware sink routes it to `stderr`.
 * - `styler` — the {@link StylerInterface} every line is colored through; defaults to
 *   {@link import('./factories.js').createStyler} (ANSI). The ONE styler the whole system
 *   shares — no second colorizer. A disabled styler yields plain narration.
 * - `width` — the default column width handed to the separator / box renderers (the section
 *   rule, a `box` with no explicit width); defaults to {@link DEFAULT_WIDTH}.
 *
 * Event-free (§13): the reporter has no `on` / `error` — it is a formatting front-end with no
 * observable lifecycle, so (like the renderers and `Scheduler`) it carries no emitter.
 */
export interface ReporterOptions {
	readonly sink?: SinkInterface
	readonly styler?: StylerInterface
	readonly width?: number
}

/**
 * A lean, event-free narrative reporter — the composable verb set for human / build-run
 * output (sections, steps, timings, outcomes, tables, trees, boxes), formatting through the
 * shared {@link StylerInterface} + layout renderers and writing to a {@link SinkInterface}.
 *
 * @remarks
 * - **A SMALL composable set**, not a grab-bag: `section` / `step` / `timing` / `status` /
 *   `table` / `tree` / `box` / `line` / `blank`. Coloring is the ONE styler; layout is the
 *   pure renderers ({@link import('./helpers.js').renderSeparator} /
 *   {@link import('./helpers.js').renderBox} / {@link import('./helpers.js').renderTable} /
 *   {@link import('./helpers.js').renderTree}). No second colorizer, no spinner / bar (that
 *   is the animation chunk), no buffering / capture (that is the capture chunk).
 * - **`status` is a narrative outcome, not a log level.** Its {@link StatusLevel} is
 *   `success` / `error` / `warn` / `info` (DISTINCT from {@link LogLevel}); `error` routes to
 *   the sink's error stream.
 * - **Event-free (§13).** No emitter — a pure formatting front-end. Each verb FORMATS then
 *   WRITES immediately; there is no retained state worth observing.
 */
export interface ReporterInterface {
	/** Write a titled separator block — a section heading framed by a horizontal rule. */
	section(title: string): void
	/** Write a step line, optionally prefixed with its `[index/total]` {@link StepPosition}. */
	step(message: string, position?: StepPosition): void
	/** Write a timing line — `label … 1.23s` (sub-second shown as `…ms`). */
	timing(label: string, ms: number): void
	/** Write an icon + colored outcome line for `level` (`error` routes to the error stream). */
	status(level: StatusLevel, message: string): void
	/** Render a {@link TableOptions} grid through {@link import('./helpers.js').renderTable} and write it. */
	table(options: TableOptions): void
	/** Render a {@link TreeOptions} tree through {@link import('./helpers.js').renderTree} and write it. */
	tree(options: TreeOptions): void
	/** Render a {@link BoxOptions} frame through {@link import('./helpers.js').renderBox} and write it. */
	box(options: BoxOptions): void
	/** Write one raw line, colored through the styler if any styling is embedded — no prefix, no icon. */
	line(text: string): void
	/** Write `count` blank lines (default `1`). */
	blank(count?: number): void
}

// Console interception — taking control of the console on the READ side. A `Capture` snapshots
// the configured global `console.*` methods, replaces them with wrappers that BUFFER each call
// (total + by level) as a frozen `CapturedMessage`, emit it on `capture`, optionally MIRROR it
// to the snapshot-original console, and optionally FORWARD it to a `Sink`. Universal —
// `console.*` exists in browser + Node. It catches THIRD-PARTY `console.*`, never our own output:
// the default console sink (and so the Logger / Reporter) snapshots the real `console` at
// creation, so a Capture installed afterward never feeds our writes back into itself (the
// no-capture-loop principle). PROCESS-GLOBAL + NON-REENTRANT — patching the one global `console`,
// so a single capture may be active at a time; two at once interleave / clobber each other's
// restore. Observable (§13) — a buffered, mirroring, forwarding interceptor with a lifecycle.

/**
 * One intercepted `console` method — the names a {@link CaptureInterface} patches and reports
 * under. A fixed set keyed off the universal `console.*` methods (`console.log` / `info` / `warn`
 * / `error` / `debug`); a named value family (it indexes {@link CAPTURE_LEVEL_MAP} to a
 * {@link LogLevel} for the optional sink forward), never a binary toggle — so it stays a union.
 *
 * @remarks
 * DISTINCT from {@link LogLevel}: a `CaptureLevel` names the ORIGINATING console method (which
 * `console.x` was called), not a severity threshold — there is no ordering and no gating (every
 * configured method is captured). `log` and `info` are separate methods (both default-stream),
 * mapped to the sink's default / `info` stream respectively; `warn` / `error` / `debug` map to
 * their matching {@link LogLevel}. The default configured set is {@link DEFAULT_CAPTURE_LEVELS}.
 */
export type CaptureLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

/**
 * One captured console call — an immutable, serializable record of a single intercepted
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
 * The observable events a {@link CaptureInterface} emits (AGENTS §13).
 *
 * @remarks
 * - `capture` — the core event: fires for EVERY intercepted `console.*` call (one per call,
 *   while active), carrying the frozen {@link CapturedMessage}. The hook a live console viewer /
 *   tee rides.
 * - `start` / `stop` — the lifecycle signals: `start` fires when interception is installed (the
 *   first `start()` on an inactive capture), `stop` when it is torn down (a `stop()` on an active
 *   capture, and from `destroy()`); both are pure signals (empty tuples) so a consumer can mirror
 *   the global-patch lifecycle (e.g. log that capture is engaged). They earn their place by
 *   bracketing the process-global side effect a consumer needs to observe.
 *
 * Listener isolation is the emitter's (§13): a listener throw routes to the emitter's `error`
 * handler, never onto this map — so a buggy `capture` listener can never perturb interception (or
 * the underlying program's own `console.*` call). Declared as a `type` alias (not
 * `interface extends EventMap`, §4.5): a type-literal satisfies the `EventMap` constraint
 * structurally, whereas an interface lacks the index signature.
 */
export type CaptureEventMap = {
	/** An intercepted `console.*` call — the frozen {@link CapturedMessage}. */
	readonly capture: readonly [message: CapturedMessage]
	/** Interception was installed (an inactive capture's `start()`). */
	readonly start: readonly []
	/** Interception was torn down (an active capture's `stop()` / `destroy()`). */
	readonly stop: readonly []
}

/**
 * Options for `createCapture` / the {@link CaptureInterface} constructor.
 *
 * @remarks
 * - `on` — the reserved {@link EmitterHooks} key (§8): initial listeners for the
 *   {@link CaptureEventMap}, wired at construction (e.g. `{ capture: (m) => tee(m) }`).
 * - `error` — the emitter's listener-error handler (§13); a listener throw routes here.
 * - `levels` — which `console.*` methods to intercept; defaults to {@link DEFAULT_CAPTURE_LEVELS}
 *   (all five). Only the listed methods are patched — an unlisted method is left untouched and
 *   its calls pass through normally.
 * - `mirror` — when `true`, each intercepted call is ALSO forwarded to the snapshot-original
 *   `console` method, so the program's own console output still appears while being captured;
 *   defaults to `false` (capture silently). Mirrors through the method snapshotted AT `start()`,
 *   never the live (re-patched) one — no echo loop.
 * - `sink` — an optional {@link SinkInterface} each intercepted call is also written to
 *   (`sink.write(text, level)` with the {@link CaptureLevel} mapped to a {@link LogLevel} via
 *   {@link CAPTURE_LEVEL_MAP}), to tee captured output into the logging pipeline / a file. Absent
 *   ⇒ no forward.
 * - `limit` — the bounded buffer cap: at most this many recent messages are retained per buffer
 *   (the total buffer and EACH by-level bucket; oldest dropped first). Defaults to
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
 * An observable console interceptor (AGENTS §13) — it takes control of the global `console.*` on
 * the READ side: while `active`, every configured `console.x` call is captured as a frozen
 * {@link CapturedMessage}, buffered (total + by level, bounded), emitted on `capture`, and —
 * per options — mirrored to the real console and/or forwarded to a {@link SinkInterface}.
 *
 * @remarks
 * - **Snapshot-at-start.** `start()` snapshots the CURRENT `console[level]` for each configured
 *   {@link CaptureLevel}, then installs the wrappers. The mirror writes through that snapshot, so
 *   our OWN console sink output (the Logger / Reporter, which snapshot the real `console` at
 *   creation) is never recaptured — `Capture` catches THIRD-PARTY `console.*`, not our writes
 *   (the no-capture-loop principle). Create your loggers BEFORE installing a capture.
 * - **Idempotent + non-reentrant.** `start()` while already `active` is a no-op (it never
 *   double-patches), and `stop()` while inactive is a no-op. It is PROCESS-GLOBAL — it patches the
 *   one global `console` — so at most ONE capture may be active at a time; running two
 *   concurrently interleaves their buffers and clobbers each other's restore.
 * - **Bounded buffers.** `messages()` returns a copy of the whole buffer (oldest first),
 *   `byLevel(level)` a copy of one level's bucket — each capped at `limit` (oldest dropped first),
 *   never unbounded. `clear()` empties them (it does NOT stop interception).
 * - **Lifecycle (§10).** `start` / `stop` toggle interception; `destroy()` stops (restoring
 *   `console`) then destroys the emitter (its listeners go).
 */
export interface CaptureInterface {
	readonly emitter: EmitterInterface<CaptureEventMap>
	/** Whether interception is currently installed (between `start()` and `stop()`). */
	readonly active: boolean
	/** Snapshot the configured `console.*` and install the interceptors — a no-op when already `active`. */
	start(): void
	/** Restore the snapshot-original `console.*` — a no-op when not `active`. */
	stop(): void
	/** A copy of the whole captured buffer, oldest first (capped at `limit`). */
	messages(): readonly CapturedMessage[]
	/** A copy of the captured buffer for ONE {@link CaptureLevel}, oldest first (capped at `limit`). */
	byLevel(level: CaptureLevel): readonly CapturedMessage[]
	/** Drop every buffered message (total + by level); does NOT stop interception. */
	clear(): void
	/** Tear down — `stop()` (restoring `console`) then destroy the emitter. */
	destroy(): void
}

/**
 * The structured outcome of {@link import('./factories.js').withCapture} — the wrapped function's
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

// Live activity animations — pure frame PRODUCERS over the SAME substrate (the one `Styler`, the
// one `Sink`). A `Spinner` is a self-driving glyph cycle (a periodic timer advances the frame); a
// `Progress` is an update-driven bar. Both build a frame LINE and write `\r` + that line to an
// injected `Sink`, then emit it — but the actual line-OVERWRITE is the SINK's job: a TTY sink (C-g)
// makes the leading `\r` overwrite for a smooth animation, while a browser / plain sink (C-f) drops
// `\r` to the start of a fresh, non-overwriting line (the locked decision). UNIVERSAL — `Sink` + a
// timer + the styler, NO `node:*`, NO `process.stdout`. The bar string itself is rendered by the
// pure {@link import('./helpers.js').renderBar} (a sibling of the C-c `render*` renderers). Both are
// observable (§13): a spinner's frames + lifecycle, a progress's updates + completion.

/**
 * Options for the pure {@link import('./helpers.js').renderBar} renderer — a determinate progress
 * bar string (`█████░░░░░ 50% (5/10)`), width-aware and styler-optional.
 *
 * @remarks
 * - `current` / `total` — the filled fraction is `current / total`, clamped to `[0, total]` (a
 *   `current` past `total` renders a full bar, a negative one an empty bar) — so a caller's overrun
 *   never produces an over-long bar. A `total` of `0` (or below) renders a full bar (nothing to do).
 * - `width` — the visible cell count of the bar TRACK (the glyph run between no brackets); defaults
 *   to {@link DEFAULT_BAR_WIDTH}. The percentage + `(current/total)` count follow the track.
 * - `fill` — the filled-cell glyph; defaults to {@link BAR_FILL} (`█`). `empty` — the empty-cell
 *   glyph; defaults to {@link BAR_EMPTY} (`░`). Sized in VISIBLE columns ({@link
 *   import('./helpers.js').width}), so a multi-cell glyph still yields a `width`-wide track.
 * - `styler` — colors the FILLED run when supplied (the empty run + the trailing label stay plain);
 *   the layout is identical with or without color, since the track is measured on visible width.
 */
export interface ProgressBarOptions {
	readonly current: number
	readonly total: number
	readonly width?: number
	readonly fill?: string
	readonly empty?: string
	readonly styler?: StylerInterface
}

/**
 * The observable events a {@link SpinnerInterface} emits (AGENTS §13).
 *
 * @remarks
 * - `frame` — the core event: fires once per advance (every `tick()`, whether driven by the internal
 *   timer or called directly) AND on the final `success` / `failure` line, carrying the rendered frame
 *   line (the SAME text written to the sink, minus the leading `\r`). The hook a non-sink consumer
 *   (a test, a remote mirror) rides to observe the animation without a terminal.
 * - `start` / `stop` — the lifecycle signals bracketing the internal timer: `start` fires when the
 *   timer is armed (the first `start()` on an inactive spinner), `stop` when it is cleared (a
 *   `stop()` / `success()` / `failure()` on an active spinner, and from `destroy()`); both pure signals
 *   (empty tuples) so a consumer can observe the activity lifecycle.
 *
 * Listener isolation is the emitter's (§13): a listener throw routes to the emitter's `error`
 * handler, never onto this map. Declared as a `type` alias (not `interface extends EventMap`, §4.5):
 * a type-literal satisfies the `EventMap` constraint structurally, whereas an interface lacks the
 * index signature.
 */
export type SpinnerEventMap = {
	/** A frame was produced (a `tick()` advance or the final `success` / `failure` line) — the rendered line. */
	readonly frame: readonly [line: string]
	/** The internal timer was armed (an inactive spinner's `start()`). */
	readonly start: readonly []
	/** The internal timer was cleared (an active spinner's `stop()` / `success()` / `failure()` / `destroy()`). */
	readonly stop: readonly []
}

/**
 * Options for `createSpinner` / the {@link SpinnerInterface} constructor.
 *
 * @remarks
 * - `on` — the reserved {@link EmitterHooks} key (§8): initial listeners for the
 *   {@link SpinnerEventMap}, wired at construction.
 * - `error` — the emitter's listener-error handler (§13); a listener throw routes here.
 * - `message` — the text shown beside the spinner glyph; defaults to `''` (a bare glyph). Changed
 *   live via `update(message)` and overridden by a `success` / `failure` argument.
 * - `frames` — the cycle of glyph frames the spinner advances through; defaults to
 *   {@link SPINNER_FRAMES} (the braille set `⠋⠙⠹…`). Each `tick()` advances to the next, wrapping.
 * - `interval` — the timer period in milliseconds between frames; defaults to
 *   {@link DEFAULT_SPINNER_INTERVAL}. The timer is ALWAYS cleared on `success` / `failure` / `stop` /
 *   `destroy`, so it never leaks; tests drive frames deterministically via `tick()` (no real clock).
 * - `sink` — where each `\r` + frame line is written; defaults to
 *   {@link import('./factories.js').createConsoleSink}. A TTY sink (C-g) overwrites on the `\r`.
 * - `styler` — the {@link StylerInterface} the glyph is colored through; defaults to
 *   {@link import('./factories.js').createStyler} (ANSI). The ONE styler the whole system shares.
 */
export interface SpinnerOptions {
	readonly on?: EmitterHooks<SpinnerEventMap>
	readonly error?: EmitterErrorHandler
	readonly message?: string
	readonly frames?: readonly string[]
	readonly interval?: number
	readonly sink?: SinkInterface
	readonly styler?: StylerInterface
}

/**
 * A self-driving, observable activity spinner (AGENTS §13) — a glyph cycle that advances on a
 * periodic timer, writing each `\r` + frame line to its {@link SinkInterface} and emitting it on
 * `frame`. The line-OVERWRITE is the sink's job (a TTY sink overwrites on the `\r`; a plain sink
 * degrades to a fresh line).
 *
 * @remarks
 * - **Self-driving but deterministically testable.** `start()` arms a `setInterval` (universal — no
 *   `node:*`) that calls `tick()` each `interval`; each `tick()` advances the frame index, builds the
 *   styled `glyph + message` line, emits it on `frame`, and writes `'\r' + line` to the sink. A test
 *   drives frames by calling `tick()` directly (NO real clock) and proves the timer arms / clears
 *   with fake timers — the timer is ALWAYS cleared on `success` / `failure` / `stop` / `destroy`, so it
 *   never leaks.
 * - **Idempotent `start`.** A `start()` while already `active` is a no-op (it never arms a second
 *   timer). `active` reflects whether the timer is currently armed.
 * - **Outcome lines.** `success(message?)` / `failure(message?)` clear the timer, then write + emit a
 *   FINAL line — the {@link STATUS_ICONS} `✔` / `✖` (colored via {@link STATUS_COLORS}) + the
 *   message — terminated by a newline (the activity is over; the line is committed, not overwritten).
 *   `failure` routes to the sink's error stream.
 * - **Lifecycle (§10).** `stop()` clears the timer and LEAVES the current line (no final write);
 *   `destroy()` stops then destroys the emitter. `update(message)` swaps the message (re-rendering
 *   immediately when active, so the change shows without waiting for the next tick).
 */
export interface SpinnerInterface {
	readonly emitter: EmitterInterface<SpinnerEventMap>
	/** Whether the internal timer is currently armed (between `start()` and `stop` / `success` / `failure`). */
	readonly active: boolean
	/** The current message shown beside the glyph. */
	readonly message: string
	/** Arm the periodic timer and render the first frame — a no-op when already `active`. */
	start(): void
	/** Advance one frame: build the line, emit `frame`, and write `\r` + line to the sink. */
	tick(): void
	/** Change the message; re-renders immediately when `active` so the change shows at once. */
	update(message: string): void
	/** Stop with a SUCCESS line — clear the timer, write + emit `✔ message` + newline. */
	success(message?: string): void
	/** Stop with a FAILURE line — clear the timer, write + emit `✖ message` + newline (error stream). */
	failure(message?: string): void
	/** Clear the timer and LEAVE the current line (no final write) — a no-op when not `active`. */
	stop(): void
	/** Tear down — `stop()` then destroy the emitter. */
	destroy(): void
}

/**
 * The observable events a {@link ProgressInterface} emits (AGENTS §13).
 *
 * @remarks
 * - `update` — the core event: fires on every `update(current)` (and on `complete` / `failure`),
 *   carrying the `{ current, total }` progress (the clamped `current`). The hook a non-sink consumer
 *   rides to observe progress without a terminal.
 * - `complete` — the terminal signal: fires once from `complete()` (a successful finish), a pure
 *   signal (empty tuple) so a consumer can observe the bar reaching its end. (`failure()` emits a final
 *   `update` and routes its line to the error stream, but is NOT a `complete` — completion means the
 *   work finished successfully.)
 *
 * Listener isolation is the emitter's (§13). Declared as a `type` alias (not
 * `interface extends EventMap`, §4.5): a type-literal satisfies the `EventMap` constraint
 * structurally, whereas an interface lacks the index signature.
 */
export type ProgressEventMap = {
	/** Progress advanced — the clamped `{ current, total }` (fires on `update` and on `complete` / `failure`). */
	readonly update: readonly [progress: { readonly current: number; readonly total: number }]
	/** The bar reached its end via `complete()` (a successful finish). */
	readonly complete: readonly []
}

/**
 * Options for `createProgress` / the {@link ProgressInterface} constructor.
 *
 * @remarks
 * - `on` — the reserved {@link EmitterHooks} key (§8): initial listeners for the
 *   {@link ProgressEventMap}, wired at construction.
 * - `error` — the emitter's listener-error handler (§13); a listener throw routes here.
 * - `total` — the value `current` advances toward (the `100%` point); the only REQUIRED option.
 * - `message` — text shown after the bar; defaults to `''`. Overridden per-`update` and by a
 *   `complete` / `failure` argument.
 * - `width` — the bar track's visible cell count, handed to {@link import('./helpers.js').renderBar};
 *   defaults to {@link DEFAULT_BAR_WIDTH}.
 * - `sink` — where each `\r` + bar line is written; defaults to
 *   {@link import('./factories.js').createConsoleSink}. A TTY sink (C-g) overwrites on the `\r`.
 * - `styler` — the {@link StylerInterface} the filled run is colored through; defaults to
 *   {@link import('./factories.js').createStyler} (ANSI). The ONE styler the whole system shares.
 */
export interface ProgressOptions {
	readonly on?: EmitterHooks<ProgressEventMap>
	readonly error?: EmitterErrorHandler
	readonly total: number
	readonly message?: string
	readonly width?: number
	readonly sink?: SinkInterface
	readonly styler?: StylerInterface
}

/**
 * An update-driven, observable progress bar (AGENTS §13) — `update(current)` recomputes the bar via
 * {@link import('./helpers.js').renderBar}, writes `\r` + bar to its {@link SinkInterface}, and emits
 * the `{ current, total }` on `update`. The line-OVERWRITE is the sink's job (a TTY sink overwrites
 * on the `\r`; a plain sink degrades to a fresh line). NO self-timer — the caller drives it.
 *
 * @remarks
 * - **Update-driven.** Each `update(current, message?)` clamps `current` to `[0, total]`, renders
 *   the bar (filled to `current / total`, with the trailing `percent (current/total)` + message),
 *   emits `update`, and writes `'\r' + bar`. There is no internal timer (unlike {@link
 *   SpinnerInterface}) — progress advances only when the caller reports it.
 * - **Outcome lines.** `complete(message?)` renders a FULL bar (`current = total`) + message,
 *   terminated by a newline, emits a final `update` then `complete`, and marks `completed`.
 *   `failure(message?)` renders the bar at its CURRENT fill + message + newline and routes to the sink's
 *   error stream (no `complete` — the work did not finish). Both are terminal: a later `update` after
 *   a `complete` / `failure` is ignored (`active` is `false`).
 * - **Bounded.** `current` is always clamped to `[0, total]`; `completed` reports whether
 *   `complete()` has run; `active` is `true` until a `complete` / `failure`.
 */
export interface ProgressInterface {
	readonly emitter: EmitterInterface<ProgressEventMap>
	/** Whether the bar is still advancing (before any `complete()` / `failure()`). */
	readonly active: boolean
	/** Whether `complete()` has run (the bar finished successfully). */
	readonly completed: boolean
	/** The current value, clamped to `[0, total]`. */
	readonly current: number
	/** The target value the bar fills toward. */
	readonly total: number
	/** Report progress: clamp `current`, re-render the bar, emit `update`, write `\r` + bar. Ignored once terminal. */
	update(current: number, message?: string): void
	/** Finish successfully — render a FULL bar + newline, emit a final `update` then `complete`. */
	complete(message?: string): void
	/** Finish unsuccessfully — render the bar at its current fill + newline to the error stream (no `complete`). */
	failure(message?: string): void
	/** Tear down — destroy the emitter. */
	destroy(): void
}
