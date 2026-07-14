import type {
	Alignment,
	Attribute,
	BorderChars,
	BorderStyle,
	CaptureLevel,
	Color,
	LogLevel,
	Style,
	StatusLevel,
} from './types.js'

// The SGR (Select Graphic Rendition) code data the ANSI renderer maps style DATA
// through, plus the reset terminator and the ANSI-strip pattern. UPPER_SNAKE,
// `Object.freeze`d, every member exported (AGENTS §5). These are the standard SGR
// numbers (ECMA-48) — a fixed external spec, so the literals ARE the source of truth.
// `default` carries no code (it leaves the target's own ink) and so is absent from the
// color maps — the renderer emits a code only for a present, non-`default` color.

/**
 * Each {@link Color}'s SGR FOREGROUND parameter — the 8 base colors at 30–37 and their
 * bright variants at 90–97. `default` is intentionally absent (it emits no code).
 */
export const FOREGROUND_CODES: Readonly<Record<Exclude<Color, 'default'>, number>> = Object.freeze({
	black: 30,
	red: 31,
	green: 32,
	yellow: 33,
	blue: 34,
	magenta: 35,
	cyan: 36,
	white: 37,
	brightBlack: 90,
	brightRed: 91,
	brightGreen: 92,
	brightYellow: 93,
	brightBlue: 94,
	brightMagenta: 95,
	brightCyan: 96,
	brightWhite: 97,
})

/**
 * Each {@link Color}'s SGR BACKGROUND parameter — the 8 base colors at 40–47 and their
 * bright variants at 100–107. `default` is intentionally absent (it emits no code).
 */
export const BACKGROUND_CODES: Readonly<Record<Exclude<Color, 'default'>, number>> = Object.freeze({
	black: 40,
	red: 41,
	green: 42,
	yellow: 43,
	blue: 44,
	magenta: 45,
	cyan: 46,
	white: 47,
	brightBlack: 100,
	brightRed: 101,
	brightGreen: 102,
	brightYellow: 103,
	brightBlue: 104,
	brightMagenta: 105,
	brightCyan: 106,
	brightWhite: 107,
})

/**
 * Each {@link Attribute}'s SGR "on" parameter — `bold` 1, `dim` 2, `italic` 3,
 * `underline` 4, `inverse` 7, `strikethrough` 9. The renderer composes several by
 * joining their codes with `;` in one SGR sequence.
 */
export const ATTRIBUTE_CODES: Readonly<Record<Attribute, number>> = Object.freeze({
	bold: 1,
	dim: 2,
	italic: 3,
	underline: 4,
	inverse: 7,
	strikethrough: 9,
})

/**
 * The EMPTY {@link Style} — no foreground, no background, no attributes — frozen. The
 * neutral starting point a base styler builds from, and what a renderer passes through
 * unchanged (it carries no codes). Deeply frozen, so it is safe to share as the base.
 */
export const EMPTY_STYLE: Style = Object.freeze({ attributes: Object.freeze([]) })

/**
 * Every named {@link Color} except `default`, frozen — the colors the styler exposes as
 * chainable accessors. The source of truth for the color axis; the styler drives its
 * accessors from this array so the literals live in one place.
 */
export const COLORS: readonly Exclude<Color, 'default'>[] = Object.freeze([
	'black',
	'red',
	'green',
	'yellow',
	'blue',
	'magenta',
	'cyan',
	'white',
	'brightBlack',
	'brightRed',
	'brightGreen',
	'brightYellow',
	'brightBlue',
	'brightMagenta',
	'brightCyan',
	'brightWhite',
])

/**
 * Every {@link Attribute}, frozen — the attributes the styler exposes as chainable
 * accessors. The source of truth for the attribute axis.
 */
export const ATTRIBUTES: readonly Attribute[] = Object.freeze([
	'bold',
	'dim',
	'italic',
	'underline',
	'inverse',
	'strikethrough',
])

/** The SGR RESET parameter (0) — terminates a styled run, clearing all colors and attributes. */
export const RESET_CODE = 0

/**
 * The ESC control character (`U+001B`) that begins every ANSI escape sequence. Built
 * with `String.fromCharCode` so no raw control character appears in source.
 */
export const ESC = String.fromCharCode(27)

/** The BEL control character (`U+0007`) that can terminate an OSC sequence. */
export const BEL = String.fromCharCode(7)

/** The Control Sequence Introducer (`ESC[`) that opens every SGR sequence. */
export const CSI = `${ESC}[`

/** The full SGR reset sequence (`ESC[0m`) appended after a styled run. */
export const RESET = `${CSI}${RESET_CODE}m`

/**
 * Matches any ANSI/VT escape sequence — CSI (SGR color/style plus cursor/erase/scroll,
 * including colon-parameterized SGR), OSC / DCS / PM / APC / SOS string sequences
 * (titles, hyperlinks, device strings), the `nF` charset-select family, and the
 * two-byte `Fp` / `Fe` / `Fs` sequences (e.g. `ESC 7`, `ESC D`, `ESC c` RIS). Global, so
 * `strip` removes every occurrence.
 *
 * @remarks
 * A global `RegExp` carries a mutable `lastIndex`; a scan must build a FRESH `RegExp`
 * from this one's `source` + `flags` rather than reuse this instance's `lastIndex`. This
 * is the canonical definition, not a shared scanner. The alternation is ORDERED so the
 * CSI / string-family arms (which can start with a byte a later single-byte arm would
 * also match) win first; every arm uses disjoint, non-nested character classes, so the
 * match is linear in input length — no catastrophic backtracking (ReDoS-safe) even on an
 * adversarial run of digits inside an unterminated CSI. Built from `String.fromCharCode`
 * so no control-character literal appears in a regex source (the codebase idiom).
 */
export const ANSI_PATTERN = new RegExp(
	`${ESC}(?:` +
		`\\[[0-?]*[ -/]*[@-~]` +
		`|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)` +
		`|[P^_X][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)` +
		`|[ -/]+[0-~]` +
		`|[0-?]` +
		`|[@-OQ-WYZ\\\\]` +
		`|[\`-~]` +
		`)`,
	'g',
)

/**
 * Matches every C0 control character EXCEPT `\t` / `\n` / `\r` (which are meaningful
 * whitespace), plus DEL (`0x7F`) — the non-printing bytes {@link
 * import('./helpers.js').stripControls} removes. Global, ASCII-only source (no raw
 * control-character literal), so a scan builds a fresh `RegExp` the same way as
 * {@link ANSI_PATTERN} to avoid a mutated `lastIndex`.
 *
 * @remarks
 * Deliberately SEPARATE from {@link ANSI_PATTERN}: `strip()` must stay pure ANSI-escape
 * removal (width / alignment computations depend on it leaving raw C0 bytes alone), while
 * C0-stripping is an ADDITIONAL, orthogonal pass a non-TTY output sink applies on top.
 */
export const CONTROL_PATTERN = new RegExp(
	`[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
	'g',
)

// Structured-logging constants — the severity order the level gate compares through, the
// default colors a level renders in (styling is ORTHOGONAL to level — a level → color map,
// not a level), and the default bounded-retention cap. UPPER_SNAKE, `Object.freeze`d, every
// member exported (AGENTS §5).

/**
 * Each {@link LogLevel}'s numeric SEVERITY — the ascending order the level gate compares
 * through (`debug` 0 < `info` 1 < `warn` 2 < `error` 3). A record is kept when its level's
 * severity is at or above the logger's threshold. The source of truth for level ordering.
 */
export const LEVEL_SEVERITY: Readonly<Record<LogLevel, number>> = Object.freeze({
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
})

/**
 * Each {@link LogLevel}'s default label {@link Color} — the level's VISUAL treatment, which
 * is a styling choice ORTHOGONAL to the level itself (never a separate pseudo-level). The
 * logger colors the level label through its styler with these; swapping a color never
 * changes leveling. `debug` is cyan, `info` blue, `warn` yellow, `error` red.
 *
 * @remarks
 * Excludes `default` so each value indexes a real styler accessor (the styler exposes a
 * getter per non-`default` {@link Color}) — a level always renders in a concrete color.
 */
export const LEVEL_COLORS: Readonly<Record<LogLevel, Exclude<Color, 'default'>>> = Object.freeze({
	debug: 'cyan',
	info: 'blue',
	warn: 'yellow',
	error: 'red',
})

/**
 * The default bounded-retention cap for a {@link import('./types.js').LoggerInterface} — at
 * most this many recent records are kept (oldest dropped first). Retention is ALWAYS bounded
 * (never the unbounded buffer scsr leaked); a consumer overrides it via `options.limit`.
 */
export const DEFAULT_LOG_LIMIT = 1000

/** The default {@link LogLevel} threshold a logger gates at when none is supplied — `info`. */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info'

/**
 * Every {@link LogLevel}, in ascending severity order — the levels a logger exposes as
 * methods and the manager fans out to. The source of truth for the level axis (drives
 * exhaustive tests); aligned with {@link LEVEL_SEVERITY}.
 */
export const LEVELS: readonly LogLevel[] = Object.freeze(['debug', 'info', 'warn', 'error'])

// Narrative-rendering constants — the box-drawing junction sets the renderers frame with, the
// status icons + colors a `Reporter.status` outcome shows, the tree connectors, and the default
// widths / paddings / glyphs. UPPER_SNAKE, deeply `Object.freeze`d DATA, every member exported
// (AGENTS §5). The box-drawing glyphs are the standard Unicode set (U+2500 block) — a fixed
// external spec, so the literals ARE the source of truth.

/**
 * The complete {@link BorderChars} junction set for each {@link BorderStyle} — the standard
 * Unicode box-drawing glyphs at the four line weights. The renderers ({@link
 * import('./helpers.js').renderBox} / {@link import('./helpers.js').renderTable}) look the
 * style up here, so no glyph literal lives in a renderer. Deeply frozen.
 *
 * @remarks
 * `round` shares `single`'s edges and tees — only its corners differ (the rounded `╭╮╰╯`).
 */
export const BORDER_CHARS: Readonly<Record<BorderStyle, BorderChars>> = Object.freeze({
	single: Object.freeze({
		horizontal: '─',
		vertical: '│',
		topLeft: '┌',
		topRight: '┐',
		bottomLeft: '└',
		bottomRight: '┘',
		cross: '┼',
		teeDown: '┬',
		teeUp: '┴',
		teeRight: '├',
		teeLeft: '┤',
	}),
	double: Object.freeze({
		horizontal: '═',
		vertical: '║',
		topLeft: '╔',
		topRight: '╗',
		bottomLeft: '╚',
		bottomRight: '╝',
		cross: '╬',
		teeDown: '╦',
		teeUp: '╩',
		teeRight: '╠',
		teeLeft: '╣',
	}),
	round: Object.freeze({
		horizontal: '─',
		vertical: '│',
		topLeft: '╭',
		topRight: '╮',
		bottomLeft: '╰',
		bottomRight: '╯',
		cross: '┼',
		teeDown: '┬',
		teeUp: '┴',
		teeRight: '├',
		teeLeft: '┤',
	}),
	heavy: Object.freeze({
		horizontal: '━',
		vertical: '┃',
		topLeft: '┏',
		topRight: '┓',
		bottomLeft: '┗',
		bottomRight: '┛',
		cross: '╋',
		teeDown: '┳',
		teeUp: '┻',
		teeRight: '┣',
		teeLeft: '┫',
	}),
})

/**
 * Each {@link StatusLevel}'s icon glyph — the leading mark a {@link
 * import('./types.js').ReporterInterface.status} outcome line shows: `success` ✔, `error` ✖,
 * `warn` ⚠, `info` ℹ. The narrative-outcome counterpart to a log level's label; frozen.
 */
export const STATUS_ICONS: Readonly<Record<StatusLevel, string>> = Object.freeze({
	success: '✔',
	error: '✖',
	warn: '⚠',
	info: 'ℹ',
})

/**
 * Each {@link StatusLevel}'s {@link Color} — the icon + message color a `status` line renders
 * in (`success` green, `error` red, `warn` yellow, `info` blue). The VISUAL treatment of a
 * narrative outcome, colored through the reporter's styler; orthogonal to leveling, like
 * {@link LEVEL_COLORS}. Excludes `default` so each value indexes a real styler accessor.
 */
export const STATUS_COLORS: Readonly<Record<StatusLevel, Exclude<Color, 'default'>>> =
	Object.freeze({
		success: 'green',
		error: 'red',
		warn: 'yellow',
		info: 'blue',
	})

/**
 * Every {@link StatusLevel}, frozen — the outcomes a `status` line supports (drives exhaustive
 * tests). The source of truth for the status axis; aligned with {@link STATUS_ICONS} /
 * {@link STATUS_COLORS}.
 */
export const STATUS_LEVELS: readonly StatusLevel[] = Object.freeze([
	'success',
	'error',
	'warn',
	'info',
])

/**
 * The tree connectors {@link import('./helpers.js').renderTree} draws — the `├─` branch (a
 * non-last child), the `└─` corner (the last child), the `│ ` guide (carried down through an
 * earlier branch's descendants), and the `  ` gap (under a last branch). Frozen.
 */
export const TREE_CHARS = Object.freeze({
	branch: '├─ ',
	corner: '└─ ',
	guide: '│  ',
	gap: '   ',
})

/**
 * The default visible column width for the width-aware renderers — the separator rule and a
 * {@link import('./helpers.js').renderBox} with no explicit `width`, and the reporter's
 * `section` rule. A sane terminal default (80 columns); a caller overrides it per-call or via
 * {@link import('./types.js').ReporterOptions}`.width`.
 */
export const DEFAULT_WIDTH = 80

/** The default horizontal padding inside a box's edges ({@link import('./helpers.js').renderBox}) — one cell. */
export const DEFAULT_PADDING = 1

/** The default {@link BorderStyle} the box / table renderers frame with when none is given — `single`. */
export const DEFAULT_BORDER: BorderStyle = 'single'

/** The default cell {@link Alignment} a {@link import('./types.js').ColumnSpec} uses when none is given — `left`. */
export const DEFAULT_ALIGN: Alignment = 'left'

/** The default fill character {@link import('./helpers.js').renderSeparator} draws its rule with — `─`. */
export const SEPARATOR_FILL = '─'

/**
 * The single padding cell on each side of a separator's embedded title (` title `) — keeps the
 * title from butting against the rule. One space.
 */
export const SEPARATOR_TITLE_GAP = ' '

/**
 * The number of milliseconds at or above which {@link import('./helpers.js').formatDuration}
 * (and so `Reporter.timing`) switches from a `…ms` rendering to a `…s` (seconds, 2 d.p.)
 * rendering — exactly one second.
 */
export const SECOND_MS = 1000

// Console-interception constants — the default set of `console.*` methods a Capture patches, the
// default bounded-buffer cap, and the CaptureLevel → LogLevel projection the optional sink forward
// routes through. UPPER_SNAKE, `Object.freeze`d, every member exported (AGENTS §5). The five level
// names ARE the universal `console.*` method names — a fixed external surface, so the literals are
// the source of truth.

/**
 * Every {@link CaptureLevel}, frozen — the `console.*` methods a {@link
 * import('./types.js').CaptureInterface} intercepts by default (and the source of truth for the
 * capture-level axis; drives exhaustive tests). The universal console methods: `log`, `info`,
 * `warn`, `error`, `debug`.
 */
export const CAPTURE_LEVELS: readonly CaptureLevel[] = Object.freeze([
	'log',
	'info',
	'warn',
	'error',
	'debug',
])

/**
 * The default set of {@link CaptureLevel}s a Capture patches when `options.levels` is omitted —
 * all five universal `console.*` methods ({@link CAPTURE_LEVELS}). A consumer narrows it (e.g. just
 * `['warn', 'error']`) via `options.levels`.
 */
export const DEFAULT_CAPTURE_LEVELS: readonly CaptureLevel[] = CAPTURE_LEVELS

/**
 * The default bounded-buffer cap for a {@link import('./types.js').CaptureInterface} — at most this
 * many recent {@link CapturedMessage}s are retained per buffer (the total buffer AND each by-level
 * bucket; oldest dropped first). Capture retention is ALWAYS bounded so a long-running capture can
 * never grow without bound (the same retention precedent as {@link DEFAULT_LOG_LIMIT}); a consumer
 * overrides it via `options.limit`.
 */
export const DEFAULT_CAPTURE_LIMIT = 1000

/**
 * Each {@link CaptureLevel}'s {@link LogLevel} for the optional sink forward — the projection the
 * Capture routes through when writing an intercepted call to a {@link
 * import('./types.js').SinkInterface} (`sink.write(text, CAPTURE_LEVEL_MAP[level])`). `warn` /
 * `error` / `debug` / `info` map to their matching {@link LogLevel}; `log` maps to `info` (a plain
 * console log is informational — the default stream), so a stream-aware sink routes `warn` / `error`
 * captures to the right stream. The source of truth for the capture-to-log projection.
 */
export const CAPTURE_LEVEL_MAP: Readonly<Record<CaptureLevel, LogLevel>> = Object.freeze({
	log: 'info',
	info: 'info',
	warn: 'warn',
	error: 'error',
	debug: 'debug',
})

// Live-animation constants — the spinner's glyph frame set + default timer period, and the
// determinate bar's fill / empty glyphs + default track width. UPPER_SNAKE, `Object.freeze`d, every
// member exported (AGENTS §5). The braille spinner frames + the block bar glyphs are the standard
// Unicode sets (the braille-patterns block U+2800 / the block-elements `█` U+2588 / `░` U+2591) — a
// fixed external glyph spec, so the literals ARE the source of truth. scsr shipped THREE spinners +
// THREE bars; this is the ONE of each.

/**
 * The default spinner frame cycle a {@link import('./types.js').SpinnerInterface} advances through —
 * the ten braille-pattern glyphs (U+2800 block) that read as a smoothly rotating dot, the universal
 * terminal-spinner convention. Frozen; a consumer swaps the whole cycle via `options.frames`.
 *
 * @remarks
 * Braille glyphs are single visible cells, so every frame occupies one column — the spinner glyph
 * never shifts the message beside it as it advances. The source of truth for the default frame axis.
 */
export const SPINNER_FRAMES: readonly string[] = Object.freeze([
	'⠋',
	'⠙',
	'⠹',
	'⠸',
	'⠼',
	'⠴',
	'⠦',
	'⠧',
	'⠇',
	'⠏',
])

/**
 * The default timer period in milliseconds between a {@link import('./types.js').SpinnerInterface}'s
 * frames — the `setInterval` interval `start()` arms. Eighty milliseconds (≈12.5 frames/second) is
 * the conventional spinner cadence: fast enough to read as motion, slow enough not to thrash a
 * terminal. A consumer overrides it via `options.interval`.
 */
export const DEFAULT_SPINNER_INTERVAL = 80

/**
 * The default FILLED-cell glyph {@link import('./helpers.js').renderBar} draws the completed run of a
 * progress bar with — the full block `█` (U+2588). A single visible cell; a consumer overrides it via
 * {@link import('./types.js').ProgressBarOptions}`.fill`.
 */
export const BAR_FILL = '█'

/**
 * The default EMPTY-cell glyph {@link import('./helpers.js').renderBar} draws the remaining run of a
 * progress bar with — the light-shade block `░` (U+2591). A single visible cell; a consumer overrides
 * it via {@link import('./types.js').ProgressBarOptions}`.empty`.
 */
export const BAR_EMPTY = '░'

/**
 * The default visible cell count of a progress-bar TRACK — the glyph run {@link
 * import('./helpers.js').renderBar} fills (and a {@link import('./types.js').ProgressInterface} sizes
 * its bar to). Thirty cells is a compact, terminal-friendly default; a consumer overrides it via
 * `options.width`. Distinct from {@link DEFAULT_WIDTH} (the renderers' 80-column line width) — a bar
 * track is one inline element, not a full-width rule.
 */
export const DEFAULT_BAR_WIDTH = 30
