import type {
	Alignment,
	BoxOptions,
	LogLevel,
	LogRecord,
	ProgressBarOptions,
	SeparatorOptions,
	Style,
	StylerInterface,
	TableOptions,
	TreeNode,
	TreeOptions,
	Theme,
	WriterSet,
} from './types.js'
import {
	ANSI_PATTERN,
	BAR_EMPTY,
	BAR_FILL,
	BORDER_CHARS,
	CONTROL_PATTERN,
	DEFAULT_ALIGN,
	DEFAULT_BAR_WIDTH,
	DEFAULT_BORDER,
	DEFAULT_PADDING,
	DEFAULT_WIDTH,
	LEVEL_SEVERITY,
	SECOND_MS,
	SEPARATOR_FILL,
	SEPARATOR_TITLE_GAP,
} from './constants.js'

// Pure, universal string helpers for the console / terminal system. `strip` removes
// ANSI escapes; `width` is the visible length (strip then count). Both are needed later
// by the box / table / progress layout — kept here, environment-agnostic, so every
// surface shares one implementation. Every function exported.
// The logging helpers (`meetsLevel`, `formatTime`, `formatRecord`) are likewise pure and
// shared — the level gate's comparison and the styled-line layout, kept off the impl class.

/**
 * Removes every ANSI escape sequence from `text`, returning the plain visible string.
 *
 * @remarks
 * Strips SGR color/style codes and other CSI controls (cursor, erase) plus OSC
 * sequences (titles, hyperlinks) — see {@link ANSI_PATTERN}. A fresh `RegExp` is built
 * per call from the canonical pattern's `source` + `flags`, so the shared global
 * pattern's `lastIndex` is never mutated across calls (re-entrant and deterministic).
 *
 * @param text - Any string, styled or plain
 * @returns `text` with all ANSI escapes removed
 *
 * @example
 * ```ts
 * strip('\x1b[31mred\x1b[0m') // 'red'
 * ```
 */
export function strip(text: string): string {
	return text.replace(new RegExp(ANSI_PATTERN.source, ANSI_PATTERN.flags), '')
}

/**
 * Removes every non-printing C0 control character from `text` except `\t` / `\n` / `\r`
 * (meaningful whitespace), plus DEL — returning the sanitized string.
 *
 * @remarks
 * Deliberately separate from {@link strip} (ANSI-escape removal only, so `width` /
 * `align` stay untouched) — this is the additional pass a non-TTY output sink applies
 * on top of `strip`, so a captured `\x07` bell or stray `\x00` never reaches a log file
 * / non-terminal target. A fresh `RegExp` is built per call from {@link CONTROL_PATTERN}'s
 * `source` + `flags`, the same re-entrant idiom as `strip`.
 *
 * @param text - Any string, possibly carrying raw control bytes
 * @returns `text` with C0 controls (other than tab/newline/CR) and DEL removed
 *
 * @example
 * ```ts
 * stripControls('a\x07b\nc') // 'ab\nc'
 * ```
 */
export function stripControls(text: string): string {
	return text.replace(new RegExp(CONTROL_PATTERN.source, CONTROL_PATTERN.flags), '')
}

/**
 * Measures how many visible columns `text` occupies — its length after ANSI escapes are stripped, counted in
 * Unicode code points (so an astral character such as an emoji counts as one, not the
 * two UTF-16 units `String.length` would report).
 *
 * @remarks
 * The basis for terminal layout (box / table / progress alignment): the column count a
 * styled string occupies, independent of its escape codes. It does not account for
 * wide (CJK / fullwidth) glyphs occupying two cells — a deliberate, documented
 * simplification at this layer; callers needing east-asian width handle it above.
 *
 * @param text - Any string, styled or plain
 * @returns The count of visible code points
 *
 * @example
 * ```ts
 * width('\x1b[1mhi\x1b[0m') // 2
 * ```
 */
export function width(text: string): number {
	return [...strip(text)].length
}

/**
 * Snapshots and deeply freezes one {@link Style} value.
 *
 * @param style - The caller-owned style to snapshot
 * @returns A frozen style record with an independently frozen attributes list
 *
 * @remarks
 * The record spread captures accessor values once and preserves each present color channel.
 * Copying `attributes` prevents later mutation of a caller-owned list from changing the result.
 *
 * @example
 * ```ts
 * freezeStyle({ foreground: 'red', attributes: ['bold'] })
 * ```
 */
export function freezeStyle(style: Style): Style {
	return Object.freeze({ ...style, attributes: Object.freeze([...style.attributes]) })
}

/**
 * Checks whether a record at `level` passes a logger gated at `threshold` — i.e. its severity is
 * at or above the threshold's.
 *
 * @remarks
 * The level gate (the comparison lives here, not inlined in the logger). Reads
 * the ascending {@link LEVEL_SEVERITY} order: `meetsLevel('warn', 'error')` is `true`
 * (error ≥ warn), `meetsLevel('warn', 'info')` is `false` (info < warn).
 *
 * @param threshold - The logger's configured minimum {@link LogLevel}
 * @param level - The record's {@link LogLevel}
 * @returns True if `level` is at least as severe as `threshold`; false otherwise
 *
 * @example
 * ```ts
 * meetsLevel('info', 'error') // true
 * meetsLevel('error', 'warn') // false
 * ```
 */
export function meetsLevel(threshold: LogLevel, level: LogLevel): boolean {
	return LEVEL_SEVERITY[level] >= LEVEL_SEVERITY[threshold]
}

/**
 * Selects the member of a {@link WriterSet} a {@link LogLevel} routes to — `error` to `error`,
 * `warn` to `warn`, every other level and an omitted level to `log`.
 *
 * @remarks
 * The single owner of the level-to-target decision every sink backend shares, so core's console
 * sink, the browser `%c` sink, and the server stream sink cannot drift apart. A backend that sends
 * two levels to one destination passes the same member twice: the server sink routes `warn`
 * alongside `error` by supplying its error stream for both, which matches `console.warn` writing
 * to `stderr`. The member type is the caller's, so the same leaf selects a bound console method, a
 * stream target, or a per-target styling fact.
 *
 * @param level - The originating record's {@link LogLevel}, or `undefined` when the caller has none
 * @param writers - See {@link WriterSet}
 * @returns The member `level` routes to
 *
 * @example
 * ```ts
 * selectWriter('error', { log: 'out', warn: 'out', error: 'err' }) // 'err'
 * selectWriter('debug', { log: 'out', warn: 'out', error: 'err' }) // 'out'
 * selectWriter(undefined, { log: 'out', warn: 'out', error: 'err' }) // 'out'
 * ```
 */
export function selectWriter<T>(level: LogLevel | undefined, writers: WriterSet<T>): T {
	if (level === 'error') return writers.error
	if (level === 'warn') return writers.warn
	return writers.log
}

/**
 * Formats a {@link LogRecord}'s `time` (epoch milliseconds) as an ISO-8601 timestamp string.
 *
 * @remarks
 * Deterministic and serializable — `new Date(time).toISOString()`, e.g.
 * `1716900000000 → '2024-05-28T12:40:00.000Z'`. The timestamp portion of the formatted log
 * line; kept a pure helper so the line layout and the logger stay decoupled.
 *
 * @param time - Epoch milliseconds (a record's `time`)
 * @returns The ISO-8601 timestamp
 */
export function formatTime(time: number): string {
	return new Date(time).toISOString()
}

/**
 * Formats a {@link LogRecord} into a single styled line — the default human line layout a
 * {@link import('./types.js').LoggerInterface} writes to its sink.
 *
 * @remarks
 * Layout: `{time} {LEVEL} {[name]} {message}{ data}` — the ISO timestamp (dimmed), the
 * upper-cased level label (rendered through the theme's level role),
 * the originating logger's `name` in brackets (omitted when absent), the message, and the
 * structured `data` appended as compact JSON (omitted when absent / empty). Coloring flows
 * through the injected `styler`, so a disabled styler yields a plain line and a browser
 * `%c` styler retargets it — the layout never changes. Pure: same record + styler →
 * same line.
 *
 * @param record - The {@link LogRecord} to render
 * @param styler - The {@link StylerInterface} the labels are colored through
 * @param theme - The {@link Theme} supplying the level and chrome roles
 * @returns The formatted, styled line (no trailing newline — the sink's target adds it)
 *
 * @example
 * ```ts
 * formatRecord(
 * 	{ level: 'warn', message: 'low disk', time: 0, name: 'fs' },
 * 	createStyler(),
 * 	DEFAULT_THEME,
 * )
 * // '<dim>1970-01-01T00:00:00.000Z</> <yellow>WARN</> [fs] low disk'
 * ```
 */
export function formatRecord(record: LogRecord, styler: StylerInterface, theme: Theme): string {
	const time = styler.render(theme.chrome, formatTime(record.time))
	const label = styler.render(theme.levels[record.level], record.level.toUpperCase())
	const name =
		record.name === undefined ? '' : ` ${styler.render(theme.chrome, `[${record.name}]`)}`
	const data =
		record.data === undefined || Object.keys(record.data).length === 0
			? ''
			: ` ${styler.render(theme.chrome, JSON.stringify(record.data))}`
	return `${time} ${label}${name} ${record.message}${data}`
}

/**
 * Pads (or, when over budget, truncates) `text` to exactly `target` visible columns, positioning
 * it by `alignment`. The width primitive the box / table renderers align every cell with.
 *
 * @remarks
 * Measures with {@link width} (visible code points, ANSI-aware), so a styled string aligns by
 * its visible content, not its escape codes. When `width(text) < target`, the deficit is added
 * as spaces — all trailing (`left`), all leading (`right`), or split with the extra space on
 * the right (`center`). When `width(text) > target`, the visible characters are sliced to
 * `target` (a defensive guard — the renderers size columns to fit, so this is rarely hit; it
 * slices the stripped text, so it never bisects an escape sequence into a broken half).
 *
 * @param text - The cell content (may be styled)
 * @param target - The visible column count to fit `text` into
 * @param alignment - Where to position `text` within the width; defaults to `left`
 * @returns `text` fitted to exactly `target` visible columns
 *
 * @example
 * ```ts
 * align('hi', 5) // 'hi   '
 * align('hi', 5, 'right') // '   hi'
 * align('hi', 5, 'center') // ' hi  '
 * ```
 */
export function align(text: string, target: number, alignment: Alignment = DEFAULT_ALIGN): string {
	const visible = width(text)
	if (visible > target) return [...strip(text)].slice(0, target).join('')
	const deficit = target - visible
	if (alignment === 'right') return `${' '.repeat(deficit)}${text}`
	if (alignment === 'center') {
		const left = Math.floor(deficit / 2)
		return `${' '.repeat(left)}${text}${' '.repeat(deficit - left)}`
	}
	return `${text}${' '.repeat(deficit)}`
}

/**
 * Formats a millisecond duration as a compact human string — `…ms` below one second, `…s`
 * (seconds to 2 decimal places) at or above one second. The timing rendering behind
 * {@link import('./types.js').ReporterInterface.timing}.
 *
 * @remarks
 * `999 → '999ms'`, `1000 → '1.00s'`, `1230 → '1.23s'` (the threshold is {@link SECOND_MS}).
 * Pure and deterministic; kept a shared helper so the layout and the reporter stay decoupled.
 *
 * @param ms - The duration in milliseconds
 * @returns The formatted duration (`'<n>ms'` or `'<n>s'`)
 */
export function formatDuration(ms: number): string {
	return ms < SECOND_MS ? `${ms}ms` : `${(ms / SECOND_MS).toFixed(2)}s`
}

/**
 * Colors `text` through `styler`, or returns it verbatim when `styler` is `undefined` — the
 * single optional-styling primitive every renderer applies to its border / title / connector
 * glyphs (the one styler seam, shared, never re-hand-rolled per renderer).
 *
 * @remarks
 * The renderers all take an optional `styler`: present ⇒ glyphs are colored, absent ⇒ plain.
 * Folding that `styler === undefined ? text : styler(text)` ternary into one exported helper
 * keeps the renderers terse and the styling decision in one tested place. A disabled styler
 * (`enabled: false`) is still a styler — it returns its text verbatim — so passing one paints
 * a no-op, exactly as omitting it does.
 *
 * @param styler - The {@link StylerInterface} to color with, or `undefined` for no styling
 * @param text - The glyphs / text to color
 * @param style - An optional {@link Style} to render by value instead of the styler's chain
 * @returns `styler(text)` when a styler is given, else `text` unchanged
 */
export function paint(styler: StylerInterface | undefined, text: string, style?: Style): string {
	if (styler === undefined) return text
	return style === undefined ? styler(text) : styler.render(style, text)
}

/**
 * Repeats `unit` until it fills exactly `count` visible columns, trimming a trailing partial
 * unit so the run is never over-wide — the fill primitive the separator + box edges draw with.
 *
 * @remarks
 * Counts in code points ({@link width}-consistent), so a multi-cell or astral `unit` is laid
 * down whole and the result is sliced to exactly `count` visible columns. `count <= 0` (or an
 * empty / zero-width `unit`) yields `''`.
 *
 * @param unit - The (possibly multi-character) fill unit
 * @param count - The visible column count to fill
 * @returns `unit` tiled to exactly `count` visible columns
 *
 * @example
 * ```ts
 * repeatTo('─', 4) // '────'
 * repeatTo('=-', 5) // '=-=-='
 * ```
 */
export function repeatTo(unit: string, count: number): string {
	if (count <= 0) return ''
	const per = width(unit)
	if (per === 0) return ''
	const built = unit.repeat(Math.ceil(count / per))
	return [...built].slice(0, count).join('')
}

/**
 * Returns the cell at `index` of a (possibly ragged) row — `''` when the row is shorter than the
 * column count, so a short row pads out instead of throwing (the ragged-row guard
 * {@link renderTable} reads every cell through).
 *
 * @param row - The row's cells
 * @param index - The column index to read
 * @returns The cell text, or `''` when the row has no cell at `index`
 */
export function cellAt(row: readonly string[], index: number): string {
	return row[index] ?? ''
}

/**
 * Renders a horizontal rule — an optional centered title embedded in a line of fill characters,
 * to a fixed visible width. Pure: same {@link SeparatorOptions} → same string.
 *
 * @remarks
 * - **Plain rule.** With no `title`, returns `fill` repeated to `width` visible columns.
 * - **Titled rule.** With a `title`, centers ` title ` (one {@link SEPARATOR_TITLE_GAP} each
 *   side) in the line, splitting the remaining fill between the two sides (the extra column,
 *   when the remainder is odd, goes to the right). The visible width stays exactly `width`,
 *   even when the title is styled (the title's escape codes don't count toward the budget) —
 *   a title at least as wide as `width` yields just the gapped title (no fill).
 * - **Styling.** When `options.styler` is given, the fill runs (and the embedded title) are
 *   colored through it; the layout is identical with or without color, since width is measured
 *   on the visible content (width-aware via {@link width}).
 *
 * @param options - See {@link SeparatorOptions}
 * @returns The rule line (no trailing newline)
 *
 * @example
 * ```ts
 * renderSeparator({ width: 10 }) // '──────────'
 * renderSeparator({ title: 'Build', width: 13 }) // '── Build ──'  (centered)
 * ```
 */
export function renderSeparator(options: SeparatorOptions): string {
	const total = options.width ?? DEFAULT_WIDTH
	const fill = options.fill ?? SEPARATOR_FILL
	if (options.title === undefined)
		return paint(options.styler, repeatTo(fill, total), options.style)
	const gapped = `${SEPARATOR_TITLE_GAP}${paint(options.styler, options.title, options.style)}${SEPARATOR_TITLE_GAP}`
	const room = total - width(options.title) - SEPARATOR_TITLE_GAP.length * 2
	if (room <= 0) return gapped
	const left = Math.floor(room / 2)
	return `${paint(options.styler, repeatTo(fill, left), options.style)}${gapped}${paint(options.styler, repeatTo(fill, room - left), options.style)}`
}

/**
 * Renders `content` framed in box-drawing characters, optionally captioned, width-aware so
 * styled content stays aligned inside the frame. Pure: same {@link BoxOptions} → same string.
 *
 * @remarks
 * - **Lines.** `content` is split on `\n` or `\r\n`, so caller text written on Windows frames
 *   exactly as the same text written on POSIX; a lone `\r` is kept inside its line (it is a
 *   cursor control — the animation frame prefix — not a line separator). Each line is padded
 *   (left-aligned) to the inner
 *   width by {@link align} — measured on visible width, so a styled line never breaks the
 *   right edge. The inner width is the widest line's visible width (or `width − borders −
 *   2·padding` when an explicit `width` is given and is wider), plus `padding` blank cells
 *   inside each {@link BorderChars.vertical} edge.
 * - **Title.** An optional `title` is embedded in the top border (` title `), the remaining
 *   top edge drawn as fill; a title wider than the inner width widens the box to fit it.
 * - **Border + styling.** The {@link BorderStyle} (`options.border`, default
 *   {@link DEFAULT_BORDER}) selects the glyph set from {@link BORDER_CHARS}; `options.styler`
 *   colors the frame + title when given (content cells are written as supplied).
 * - **Multi-line result.** Returns the box as `\n`-joined rows (top, one row per content line,
 *   bottom) with no trailing newline.
 *
 * @param options - See {@link BoxOptions}
 * @returns The framed box (multiple lines joined by `\n`)
 */
export function renderBox(options: BoxOptions): string {
	const chars = BORDER_CHARS[options.border ?? DEFAULT_BORDER]
	const padding = Math.max(0, Math.trunc(options.padding ?? DEFAULT_PADDING))
	const styler = options.styler
	// Split on a line feed or a CRLF pair, so caller text written on Windows frames exactly as the
	// same text written on POSIX. A lone carriage return is deliberately not a separator: the
	// animation frame prefix is a bare `\r` cursor control, so splitting on it would cut a frame in
	// half. The literal is local because this is the one caller-text split in the module.
	const lines = options.content.split(/\r\n|\n/)
	// The inner content width: the widest line, the title (when present), and any explicit
	// `width` budget (minus the two edges and the two padding gutters) all compete — the
	// widest wins, so nothing is ever clipped and an explicit width only ever pads outward.
	// The title's claim is its embedded form ` title ` (a gap each side) plus one lead fill
	// glyph, all spanning `inner + 2·padding` — so the top edge stays exactly as wide as the
	// rest of the box (the frame is always rectangular) and a long title widens the box.
	const titleRoom =
		options.title === undefined
			? 0
			: width(options.title) + SEPARATOR_TITLE_GAP.length * 2 + 1 - padding * 2
	const budget = options.width === undefined ? 0 : options.width - 2 - padding * 2
	const inner = lines.reduce(
		(max, line) => Math.max(max, width(line)),
		Math.max(0, titleRoom, budget),
	)
	const gutter = ' '.repeat(padding)
	const bar = paint(styler, chars.vertical, options.style)
	// The top border — the two corners with the horizontal run between, optionally carrying a
	// leading ` title ` embedded in the run. `span` is the full inner run (`inner + 2·padding`):
	// with no `title` the whole run is fill between the corners; with one, ` title ` sits after a
	// single leading fill glyph, the remainder drawn as fill — its visible width stays `span` (the
	// title's escape codes don't count).
	const span = inner + padding * 2
	let top: string
	if (options.title === undefined) {
		top = paint(
			styler,
			`${chars.topLeft}${repeatTo(chars.horizontal, span)}${chars.topRight}`,
			options.style,
		)
	} else {
		const caption = `${SEPARATOR_TITLE_GAP}${options.title}${SEPARATOR_TITLE_GAP}`
		const room = span - width(caption)
		const lead = paint(styler, repeatTo(chars.horizontal, 1), options.style)
		const rest =
			room - 1 <= 0 ? '' : paint(styler, repeatTo(chars.horizontal, room - 1), options.style)
		top = `${paint(styler, chars.topLeft, options.style)}${lead}${paint(styler, caption, options.style)}${rest}${paint(styler, chars.topRight, options.style)}`
	}
	const bottom = paint(
		styler,
		`${chars.bottomLeft}${repeatTo(chars.horizontal, inner + padding * 2)}${chars.bottomRight}`,
		options.style,
	)
	const body = lines.map((line) => `${bar}${gutter}${align(line, inner)}${gutter}${bar}`)
	return [top, ...body, bottom].join('\n')
}

/**
 * Renders a bordered grid of `columns` + `rows` with per-column alignment and width-aware
 * column sizing. Pure: same {@link TableOptions} → same string.
 *
 * @remarks
 * - **Column sizing — visible width.** Each column is sized to the widest visible width
 *   ({@link width}) among its header label and its cells, so an already-styled cell never
 *   breaks the column (its escape codes don't count toward the width).
 * - **Ragged rows.** A row shorter than the column count is padded with empty cells; a longer
 *   row is truncated to the column count — a ragged input never throws.
 * - **Alignment.** Each cell is positioned by its column's {@link ColumnSpec.align} (default
 *   {@link DEFAULT_ALIGN}) via {@link align}.
 * - **Frame.** The {@link BorderStyle} (`options.border`, default {@link DEFAULT_BORDER})
 *   draws the outer frame, the header rule (a `teeRight … cross … teeLeft` line), and the
 *   `vertical` column separators; `options.styler` colors the frame + header labels when
 *   given. Returns the table as `\n`-joined rows (top, header, rule, one row per data row,
 *   bottom), no trailing newline.
 *
 * @param options - See {@link TableOptions}
 * @returns The rendered table (multiple lines joined by `\n`)
 */
export function renderTable(options: TableOptions): string {
	const chars = BORDER_CHARS[options.border ?? DEFAULT_BORDER]
	const styler = options.styler
	const columns = options.columns
	// Each column's visible width: the max of its header label and every cell it holds.
	const widths = columns.map((column, index) =>
		options.rows.reduce(
			(max, row) => Math.max(max, width(cellAt(row, index))),
			width(column.label),
		),
	)
	const aligns = columns.map((column) => column.align ?? DEFAULT_ALIGN)
	const rows = [
		columns.map((column) => paint(styler, column.label, options.style)),
		...options.rows.map((row) => columns.map((_column, index) => cellAt(row, index))),
	]
	// Frame the header and every body row in one pass: align each cell to its column width, add
	// one-space gutters, and join with the painted vertical separator.
	const renderedRows = rows.map((cells) => {
		const bar = paint(styler, chars.vertical, options.style)
		const inner = cells
			.map(
				(cell, index) =>
					` ${align(cell, widths[index] ?? width(cell), aligns[index] ?? DEFAULT_ALIGN)} `,
			)
			.join(bar)
		return `${bar}${inner}${bar}`
	})
	const segments = widths.map((columnWidth) => repeatTo(chars.horizontal, columnWidth + 2))
	const top = paint(
		styler,
		`${chars.topLeft}${segments.join(chars.teeDown)}${chars.topRight}`,
		options.style,
	)
	const rule = paint(
		styler,
		`${chars.teeRight}${segments.join(chars.cross)}${chars.teeLeft}`,
		options.style,
	)
	const bottom = paint(
		styler,
		`${chars.bottomLeft}${segments.join(chars.teeUp)}${chars.bottomRight}`,
		options.style,
	)
	return [top, ...renderedRows.slice(0, 1), rule, ...renderedRows.slice(1), bottom].join('\n')
}

/**
 * Renders a nested {@link TreeNode} tree with box-drawing connectors. Pure: same
 * {@link TreeOptions} → same string.
 *
 * @remarks
 * The `root` label is the unindented first line; its descendants are drawn beneath it with
 * {@link BORDER_CHARS} — `├─ ` before each child but the last, `└─ ` before the last, and the
 * carried prefix using `│  ` under an ancestor that still has later siblings or `   ` under a
 * last ancestor (so the guides line up exactly under the branch they descend from). Node
 * labels are written as given (an already-styled label is honored); `options.styler` colors
 * the connectors when supplied. Returns the tree as `\n`-joined lines, no trailing newline.
 *
 * @param options - See {@link TreeOptions}
 * @returns The rendered tree (multiple lines joined by `\n`)
 *
 * @example
 * ```ts
 * renderTree({ root: { label: 'root', children: [{ label: 'a' }, { label: 'b' }] } })
 * // root
 * // ├─ a
 * // └─ b
 * ```
 */
export function renderTree(options: TreeOptions): string {
	const border = options.border ?? DEFAULT_BORDER
	return [
		options.root.label,
		...renderTreeChildren(options.root.children ?? [], '', { ...options, border }),
	].join('\n')
}

/**
 * Renders the connector-prefixed lines for a {@link TreeNode} list — the recursive core
 * behind {@link renderTree}. Each child is drawn as `prefix` + its connector (`├─ ` for
 * any but the last, `└─ ` for the last) + its label, with its own descendants recursed
 * beneath under the carried guide (`│  ` under a non-last node, `   ` under the last).
 *
 * @remarks
 * A centralized, exported recursion branch so it is directly testable and
 * reusable outside {@link renderTree}'s top-level `root.label` framing.
 *
 * @param nodes - The sibling {@link TreeNode}s to render at this depth
 * @param prefix - The guide/gap string carried in from the ancestor chain (`''` at the root)
 * @param options - The required `border` selection plus optional connector `styler` and
 * by-value `style`
 * @returns The rendered lines for `nodes` and all their descendants
 *
 * @example
 * ```ts
 * renderTreeChildren([{ label: 'a' }, { label: 'b' }], '', { border: 'single' })
 * // ['├─ a', '└─ b']
 * ```
 */
export function renderTreeChildren(
	nodes: readonly TreeNode[],
	prefix: string,
	options: Required<Pick<TreeOptions, 'border'>> & Pick<TreeOptions, 'style' | 'styler'>,
): readonly string[] {
	const chars = BORDER_CHARS[options.border]
	const branch = `${chars.teeRight}${chars.horizontal} `
	const corner = `${chars.bottomLeft}${chars.horizontal} `
	const guide = `${chars.vertical}  `
	const lines: string[] = []
	nodes.forEach((node, index) => {
		const last = index === nodes.length - 1
		lines.push(
			`${prefix}${paint(options.styler, last ? corner : branch, options.style)}${node.label}`,
		)
		const carry = `${prefix}${paint(options.styler, last ? '   ' : guide, options.style)}`
		lines.push(...renderTreeChildren(node.children ?? [], carry, options))
	})
	return lines
}

/**
 * Stringifies one captured console argument into a line fragment — the per-argument rule behind
 * {@link formatArgs}: an `Error` → `name: message`, a plain object / array → circular-safe JSON,
 * anything else (string, number, boolean, `null`, `undefined`, symbol, function) → `String(value)`.
 *
 * @remarks
 * - **Total + never throws.** Like a guard, this never throws on adversarial input — a value
 *   carrying a circular reference, a `BigInt`, or a throwing `toJSON` is rendered, not raised. The
 *   `JSON.stringify` runs with a circular-guard replacer (a seen-set drops a back-reference as
 *   `'[Circular]'`); should `JSON.stringify` still throw (e.g. a `BigInt`), the value falls back to
 *   `String(value)`. So a `Capture` can never crash the program whose `console.*` it intercepts.
 * - **`Error` first.** An `Error` renders as `name: message` (e.g. `TypeError: bad`) — the useful
 *   one-line form, since `JSON.stringify(error)` is `{}` (its fields are non-enumerable).
 * - **Objects → JSON.** A non-null `object` (including an array) is `JSON.stringify`d; a primitive
 *   (or `null` / `undefined` / `function` / `symbol`) goes through `String`.
 *
 * @param value - One console argument (any value)
 * @returns The argument's one-line string form
 *
 * @example
 * ```ts
 * stringifyValue('hi') // 'hi'
 * stringifyValue({ a: 1 }) // '{"a":1}'
 * stringifyValue(new TypeError('bad')) // 'TypeError: bad'
 * const cycle: Record<string, unknown> = {}
 * cycle.self = cycle
 * stringifyValue(cycle) // '{"self":"[Circular]"}'
 * ```
 */
export function stringifyValue(value: unknown): string {
	if (value instanceof Error) return `${value.name}: ${value.message}`
	if (value === null || typeof value !== 'object') return String(value)
	// A circular-safe replacer — a seen-set drops any back-reference so a cyclic graph serializes
	// instead of throwing (total, like a guard). A residual throw (e.g. a BigInt field) falls
	// back to String(value), so this helper is total on every input.
	const seen = new WeakSet<object>()
	try {
		return JSON.stringify(value, (_key, nested: unknown) => {
			if (nested !== null && typeof nested === 'object') {
				if (seen.has(nested)) return '[Circular]'
				seen.add(nested)
			}
			return nested
		})
	} catch {
		return String(value)
	}
}

/**
 * Stringifies a captured `console.*` argument list into one line — the text of a {@link
 * import('./types.js').CapturedMessage}. Each argument is rendered by {@link stringifyValue} and
 * the parts are space-joined, mirroring how a console concatenates its arguments.
 *
 * @remarks
 * Total and never throws (it composes {@link stringifyValue}, which is total) — a `Capture` builds
 * every message through this, so intercepting `console.*` can never crash the underlying program.
 * An empty argument list yields `''` (an empty `console.log()` is captured as a blank line).
 *
 * @param args - The arguments a `console.*` method was called with
 * @returns The arguments stringified and space-joined into one line
 *
 * @example
 * ```ts
 * formatArgs(['count', 3, { ok: true }]) // 'count 3 {"ok":true}'
 * formatArgs([]) // ''
 * ```
 */
export function formatArgs(args: readonly unknown[]): string {
	return args.map(stringifyValue).join(' ')
}

/**
 * Renders a determinate progress bar string — a filled / empty glyph track followed by the percentage
 * and the `(current/total)` count (`█████░░░░░ 50% (5/10)`). Pure: same {@link ProgressBarOptions} →
 * same string. The animation-layer sibling of the `render*` renderers (box / table / tree /
 * separator), shared so a {@link import('./types.js').ProgressInterface} and any direct caller draw
 * the one bar — never a second, hand-rolled one.
 *
 * @remarks
 * - **Fill fraction, clamped.** The filled cell count is `round((current / total) · width)` with
 *   `current` clamped to `[0, total]`, so an overrun never over-fills and a negative never under-fills.
 *   A `total <= 0` renders a full track (there is nothing to fill toward — the work is trivially done).
 * - **Width-aware track.** The filled run is `fill` tiled to the filled cell count and the empty run
 *   `empty` tiled to the remainder, each via {@link repeatTo} — so the track is exactly `width` visible
 *   columns even for a multi-cell glyph (its escape codes / extra cells never break the width).
 * - **Styling.** `options.styler` colors the filled run only (the empty run + the trailing
 *   `percent (count)` label stay plain), through {@link paint}; the layout is identical with or
 *   without color, since the track is measured on visible width.
 * - **Label.** The percentage is the rounded `current / total` (e.g. `50%`); the count is the clamped
 *   `current` over `total` (`(5/10)`), a single space separating the track, the percent, and the count.
 *
 * @param options - See {@link ProgressBarOptions}
 * @returns The rendered bar line (no trailing newline)
 *
 * @example
 * ```ts
 * renderBar({ current: 5, total: 10, width: 10 }) // '█████░░░░░ 50% (5/10)'
 * renderBar({ current: 10, total: 10, width: 4 }) // '████ 100% (10/10)'
 * ```
 */
export function renderBar(options: ProgressBarOptions): string {
	const track = options.width ?? DEFAULT_BAR_WIDTH
	const fill = options.fill ?? BAR_FILL
	const empty = options.empty ?? BAR_EMPTY
	// Clamp `current` into [0, total], and treat a non-positive `total` as already complete (a full
	// track) — so the fraction is always a sound [0, 1] and an overrun / negative never breaks the bar.
	const current = options.total <= 0 ? 0 : Math.max(0, Math.min(options.total, options.current))
	const fraction = options.total <= 0 ? 1 : current / options.total
	const filledCells = Math.round(fraction * track)
	const bar = `${paint(options.styler, repeatTo(fill, filledCells), options.style)}${repeatTo(empty, track - filledCells)}`
	const percent = Math.round(fraction * 100)
	return `${bar} ${percent}% (${current}/${options.total})`
}
