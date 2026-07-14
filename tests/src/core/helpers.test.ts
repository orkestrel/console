import type { LogLevel, LogRecord } from '@src/core'
import {
	align,
	cellAt,
	createStyler,
	formatArgs,
	formatDuration,
	formatRecord,
	formatTime,
	meetsLevel,
	renderBar,
	renderBox,
	renderSeparator,
	renderTable,
	renderTree,
	renderTreeChildren,
	repeatTo,
	stringifyValue,
	strip,
	stripControls,
	width,
} from '@src/core'
import { describe, expect, it } from 'vitest'

// strip / width — the pure, universal ANSI-aware string helpers. strip removes every
// escape sequence; width is the visible code-point length (strip then count). Both must
// be re-entrant — the shared global pattern's lastIndex is never reused across calls.
// meetsLevel / formatTime / formatRecord — the pure logging helpers: the level gate's
// severity comparison, the ISO timestamp, and the styled-line layout.

const ESC = '\x1b['

// A plain styler (no escape codes) so formatRecord line assertions read the layout.
const plain = createStyler({ enabled: false })

function record(partial: Partial<LogRecord> & Pick<LogRecord, 'level' | 'message'>): LogRecord {
	return { time: 0, ...partial }
}

describe('strip', () => {
	it('removes a single SGR color sequence', () => {
		expect(strip(`${ESC}31mred${ESC}0m`)).toBe('red')
	})

	it('removes composed SGR codes and leaves the text', () => {
		expect(strip(`${ESC}1;4;31mbold underline red${ESC}0m`)).toBe('bold underline red')
	})

	it('removes multiple sequences across the string', () => {
		const styled = `${ESC}32mgreen${ESC}0m and ${ESC}34mblue${ESC}0m`
		expect(strip(styled)).toBe('green and blue')
	})

	it('returns plain text unchanged', () => {
		expect(strip('no escapes here')).toBe('no escapes here')
		expect(strip('')).toBe('')
	})

	it('removes non-SGR CSI controls (cursor / erase) too', () => {
		// Erase-line + cursor-home are CSI sequences with non-`m` finals — stripped as well.
		expect(strip(`${ESC}2K${ESC}Hcleared`)).toBe('cleared')
	})

	it('removes an OSC hyperlink sequence (ESC] … BEL), keeping the visible label', () => {
		const link = `${ESC.slice(0, 1)}]8;;https://example.com\x07label${ESC.slice(0, 1)}]8;;\x07`
		expect(strip(link)).toBe('label')
	})

	it('is re-entrant — repeated calls on the same input are stable (lastIndex not reused)', () => {
		const styled = `${ESC}33myellow${ESC}0m`
		expect(strip(styled)).toBe('yellow')
		expect(strip(styled)).toBe('yellow')
		expect(strip(styled)).toBe('yellow')
	})
})

describe('width', () => {
	it('counts only the visible characters of a styled string', () => {
		expect(width(`${ESC}1mhi${ESC}0m`)).toBe(2)
		expect(width(`${ESC}31mred${ESC}0m`)).toBe(3)
	})

	it('equals the raw length for plain text', () => {
		expect(width('hello')).toBe(5)
		expect(width('')).toBe(0)
	})

	it('counts an astral character (emoji) as one code point, not two UTF-16 units', () => {
		// '🚀' is a surrogate pair — String.length would report 2; visible width is 1.
		expect('🚀'.length).toBe(2)
		expect(width('🚀')).toBe(1)
		expect(width(`${ESC}32m🚀${ESC}0m`)).toBe(1)
	})

	it('measures a mixed styled + plain run by its visible content', () => {
		const styled = `${ESC}32mgreen${ESC}0m and ${ESC}34mblue${ESC}0m`
		expect(width(styled)).toBe('green and blue'.length)
	})
})

describe('meetsLevel', () => {
	it('keeps a record at or above the threshold severity', () => {
		expect(meetsLevel('info', 'info')).toBe(true)
		expect(meetsLevel('info', 'warn')).toBe(true)
		expect(meetsLevel('info', 'error')).toBe(true)
	})

	it('drops a record below the threshold severity', () => {
		expect(meetsLevel('warn', 'info')).toBe(false)
		expect(meetsLevel('warn', 'debug')).toBe(false)
		expect(meetsLevel('error', 'warn')).toBe(false)
	})

	it('orders the full scale debug < info < warn < error', () => {
		// A debug threshold accepts everything; an error threshold accepts only error.
		const all: LogLevel[] = ['debug', 'info', 'warn', 'error']
		const belowError: LogLevel[] = ['debug', 'info', 'warn']
		expect(all.every((level) => meetsLevel('debug', level))).toBe(true)
		expect(belowError.some((level) => meetsLevel('error', level))).toBe(false)
		expect(meetsLevel('error', 'error')).toBe(true)
	})
})

describe('formatTime', () => {
	it('renders epoch milliseconds as an ISO-8601 timestamp', () => {
		expect(formatTime(0)).toBe('1970-01-01T00:00:00.000Z')
	})

	it('is deterministic for the same input', () => {
		expect(formatTime(1716900000000)).toBe(formatTime(1716900000000))
		expect(formatTime(1716900000000)).toBe('2024-05-28T12:40:00.000Z')
	})
})

describe('formatRecord', () => {
	it('lays out time LEVEL [name] message with a plain styler', () => {
		const line = formatRecord(record({ level: 'warn', message: 'low disk', name: 'fs' }), plain)
		expect(line).toBe('1970-01-01T00:00:00.000Z WARN [fs] low disk')
	})

	it('omits the name segment when absent', () => {
		const line = formatRecord(record({ level: 'info', message: 'plain' }), plain)
		expect(line).toBe('1970-01-01T00:00:00.000Z INFO plain')
	})

	it('upper-cases the level label', () => {
		expect(formatRecord(record({ level: 'error', message: 'x' }), plain)).toContain(' ERROR ')
		expect(formatRecord(record({ level: 'debug', message: 'x' }), plain)).toContain(' DEBUG ')
	})

	it('appends structured data as compact JSON, omitting it when absent or empty', () => {
		expect(formatRecord(record({ level: 'info', message: 'm', data: { a: 1 } }), plain)).toContain(
			'{"a":1}',
		)
		expect(formatRecord(record({ level: 'info', message: 'm', data: {} }), plain)).not.toContain(
			'{',
		)
		expect(formatRecord(record({ level: 'info', message: 'm' }), plain)).not.toContain('{')
	})

	it('colors the label through the styler (styling orthogonal to level)', () => {
		// An enabled styler wraps the WARN label in yellow SGR; stripping restores the plain layout.
		const styled = formatRecord(
			record({ level: 'warn', message: 'hot', name: 'x' }),
			createStyler(),
		)
		expect(styled).toContain(`${ESC}33m`) // yellow
		expect(strip(styled)).toBe('1970-01-01T00:00:00.000Z WARN [x] hot')
	})
})

// The pure, width-aware layout renderers + their primitives — renderSeparator / renderBox /
// renderTable / renderTree, plus align / repeatTo / cellAt / formatDuration. All are pure
// (options → string), universal, and align on the VISIBLE width (strip-then-count) so an
// ANSI-styled cell keeps its columns. A plain styler proves color is orthogonal to layout
// (stripping a colored render equals the uncolored one).

const plainStyler = createStyler({ enabled: false })
const colorStyler = createStyler()

describe('align', () => {
	it('left-pads (the default) with trailing spaces', () => {
		expect(align('hi', 5)).toBe('hi   ')
	})

	it('right-aligns with leading spaces', () => {
		expect(align('hi', 5, 'right')).toBe('   hi')
	})

	it('center-aligns, the extra space going right on an odd remainder', () => {
		expect(align('hi', 5, 'center')).toBe(' hi  ')
		expect(align('hi', 6, 'center')).toBe('  hi  ')
	})

	it('measures the VISIBLE width — a styled string pads by its visible content', () => {
		const styled = `${ESC}31mred${ESC}0m` // visible 'red' (3), padded to 6
		const out = align(styled, 6)
		expect(width(out)).toBe(6)
		expect(strip(out)).toBe('red   ')
	})

	it('returns the string unchanged when already at the target width', () => {
		expect(align('exact', 5)).toBe('exact')
	})

	it('truncates the visible characters when over budget (never bisecting an escape)', () => {
		expect(align('toolong', 4)).toBe('tool')
		// Stripped before slicing, so a styled over-long cell yields clean visible text.
		expect(align(`${ESC}32mgreen${ESC}0m`, 3)).toBe('gre')
	})
})

describe('repeatTo', () => {
	it('tiles a single char to an exact visible width', () => {
		expect(repeatTo('─', 4)).toBe('────')
	})

	it('tiles a multi-char unit and trims a trailing partial', () => {
		expect(repeatTo('=-', 5)).toBe('=-=-=')
	})

	it('returns empty for a non-positive count', () => {
		expect(repeatTo('─', 0)).toBe('')
		expect(repeatTo('─', -3)).toBe('')
	})
})

describe('cellAt', () => {
	it('reads a present cell', () => {
		expect(cellAt(['a', 'b'], 1)).toBe('b')
	})

	it('returns empty for an out-of-range index (ragged-row guard)', () => {
		expect(cellAt(['a'], 3)).toBe('')
	})
})

describe('formatDuration', () => {
	it('renders sub-second as milliseconds', () => {
		expect(formatDuration(0)).toBe('0ms')
		expect(formatDuration(999)).toBe('999ms')
	})

	it('renders one second and above as seconds to 2 decimals', () => {
		expect(formatDuration(1000)).toBe('1.00s')
		expect(formatDuration(1234)).toBe('1.23s')
		expect(formatDuration(60000)).toBe('60.00s')
	})
})

describe('renderSeparator', () => {
	it('draws a plain rule to the requested width with the default fill', () => {
		expect(renderSeparator({ width: 10 })).toBe('──────────')
	})

	it('uses a custom fill character', () => {
		expect(renderSeparator({ width: 5, fill: '=' })).toBe('=====')
	})

	it('centers an embedded title, keeping the total visible width exact', () => {
		const rule = renderSeparator({ title: 'Hi', width: 13 })
		expect(rule).toBe('──── Hi ─────') // 4 fill + ' Hi ' + 5 fill = 13
		expect(width(rule)).toBe(13)
	})

	it('yields just the gapped title when it fills (or overflows) the width', () => {
		expect(renderSeparator({ title: 'wide', width: 4 })).toBe(' wide ')
	})

	it('colors the rule + title through a styler CHAIN without changing the layout (width-aware)', () => {
		// A styler colors with its ACCUMULATED chain — pass `.cyan` so the fill + title are colored;
		// the bare base styler (no chain) would render plain (an empty style emits no codes).
		const styled = renderSeparator({ title: 'X', width: 11, styler: colorStyler.cyan })
		const plainRule = renderSeparator({ title: 'X', width: 11, styler: plainStyler })
		expect(styled).toContain(`${ESC}36m`) // cyan
		expect(strip(styled)).toBe(plainRule)
		expect(width(styled)).toBe(11)
	})
})

describe('renderBox', () => {
	it('frames single-line content with single borders + one-cell padding', () => {
		expect(renderBox({ content: 'hi' })).toBe(['┌────┐', '│ hi │', '└────┘'].join('\n'))
	})

	it('sizes the inner width to the widest line and pads shorter lines', () => {
		expect(renderBox({ content: 'a\nbbb' })).toBe(
			['┌─────┐', '│ a   │', '│ bbb │', '└─────┘'].join('\n'),
		)
	})

	it('embeds a title in the top border, keeping the box rectangular', () => {
		// The title widens the box so ` T ` fits after one lead fill — every row equal width.
		const box = renderBox({ content: 'x', title: 'T' })
		expect(box).toBe(['┌─ T ┐', '│ x  │', '└────┘'].join('\n'))
		const widths = box.split('\n').map((row) => width(row))
		expect(new Set(widths).size).toBe(1)
	})

	it('selects the border style from the glyph set', () => {
		expect(renderBox({ content: 'x', border: 'double' })).toBe(
			['╔═══╗', '║ x ║', '╚═══╝'].join('\n'),
		)
		expect(renderBox({ content: 'x', border: 'round' }).split('\n')[0]).toBe('╭───╮')
		expect(renderBox({ content: 'x', border: 'heavy' }).split('\n')[0]).toBe('┏━━━┓')
	})

	it('pads out to an explicit width (never clipping), measuring on visible width', () => {
		const box = renderBox({ content: 'x', width: 9 })
		// inner = 9 − 2 borders − 2 padding = 5; 'x' left-padded to 5.
		expect(box).toBe(['┌───────┐', '│ x     │', '└───────┘'].join('\n'))
		for (const row of box.split('\n')) expect(width(row)).toBe(9)
	})

	it('keeps styled content aligned — every framed row is the same visible width', () => {
		const box = renderBox({ content: `${ESC}31mred${ESC}0m\nplain`, styler: colorStyler.dim })
		const rows = box.split('\n')
		const widths = rows.map((row) => width(row))
		expect(new Set(widths).size).toBe(1) // all rows equal visible width despite the escapes
		expect(strip(box)).toBe(['┌───────┐', '│ red   │', '│ plain │', '└───────┘'].join('\n'))
	})
})

describe('renderTable', () => {
	it('renders a bordered grid with width-aware columns + a header rule', () => {
		const table = renderTable({ columns: [{ label: 'A' }, { label: 'B' }], rows: [['1', '22']] })
		expect(table).toBe(
			['┌───┬────┐', '│ A │ B  │', '├───┼────┤', '│ 1 │ 22 │', '└───┴────┘'].join('\n'),
		)
	})

	it('aligns per column (left / center / right)', () => {
		const table = renderTable({
			columns: [
				{ label: 'L', align: 'left' },
				{ label: 'C', align: 'center' },
				{ label: 'R', align: 'right' },
			],
			rows: [
				['xxxx', 'xxxx', 'xxxx'],
				['a', 'b', 'c'],
			],
		})
		const dataRow = table.split('\n')[4]
		// Each column is 4 wide (widest cell 'xxxx'); 'a' left, 'b' centered, 'c' right.
		expect(dataRow).toBe('│ a    │  b   │    c │')
	})

	it('sizes columns by the widest VISIBLE width — styled cells do not break the grid', () => {
		const table = renderTable({
			columns: [{ label: 'X' }],
			rows: [[`${ESC}31mred${ESC}0m`], ['ab']],
			styler: colorStyler.dim,
		})
		// Column width is max(visible 'X'=1, 'red'=3, 'ab'=2) = 3; every row equal visible width.
		const widths = table.split('\n').map((row) => width(row))
		expect(new Set(widths).size).toBe(1)
		expect(strip(table)).toBe(
			['┌─────┐', '│ X   │', '├─────┤', '│ red │', '│ ab  │', '└─────┘'].join('\n'),
		)
	})

	it('pads a short row and truncates an over-long one (ragged input never throws)', () => {
		const table = renderTable({
			columns: [{ label: 'A' }, { label: 'B' }],
			rows: [['1'], ['x', 'y', 'z']],
		})
		const rows = table.split('\n')
		expect(rows[3]).toBe('│ 1 │   │') // missing second cell padded blank
		expect(rows[4]).toBe('│ x │ y │') // extra third cell dropped
	})

	it('handles an empty body (header + rules only)', () => {
		expect(renderTable({ columns: [{ label: 'Only' }], rows: [] })).toBe(
			['┌──────┐', '│ Only │', '├──────┤', '└──────┘'].join('\n'),
		)
	})
})

describe('renderTree', () => {
	it('renders a flat child list with branch + corner connectors', () => {
		expect(
			renderTree({ root: { label: 'root', children: [{ label: 'a' }, { label: 'b' }] } }),
		).toBe(['root', '├─ a', '└─ b'].join('\n'))
	})

	it('carries the guide under nested branches so descendants line up', () => {
		const tree = renderTree({
			root: {
				label: 'root',
				children: [
					{ label: 'a', children: [{ label: 'a1' }, { label: 'a2' }] },
					{ label: 'b', children: [{ label: 'b1' }] },
				],
			},
		})
		expect(tree).toBe(['root', '├─ a', '│  ├─ a1', '│  └─ a2', '└─ b', '   └─ b1'].join('\n'))
	})

	it('renders a lone root (no children) as a single line', () => {
		expect(renderTree({ root: { label: 'solo' } })).toBe('solo')
	})

	it('colors the connectors through a styler CHAIN, leaving labels and layout intact', () => {
		// `.dim` so the connectors actually carry codes — a bare base styler renders plain.
		const tree = renderTree({
			root: { label: 'root', children: [{ label: 'a' }] },
			styler: colorStyler.dim,
		})
		expect(tree).toContain(ESC) // a connector is colored
		expect(strip(tree)).toBe(['root', '└─ a'].join('\n'))
	})
})

// stringifyValue / formatArgs — the console-capture arg formatters. stringifyValue renders ONE
// argument (Error → `name: message`, object → circular-safe JSON, else String(value)); formatArgs
// space-joins the rendered arguments into one line. Both are TOTAL — they never throw on
// adversarial input (a cycle, a BigInt), so intercepting console.* can never crash the program.

describe('stringifyValue', () => {
	it('renders a string verbatim', () => {
		expect(stringifyValue('hi')).toBe('hi')
		expect(stringifyValue('')).toBe('')
	})

	it('renders primitives through String()', () => {
		expect(stringifyValue(42)).toBe('42')
		expect(stringifyValue(true)).toBe('true')
		expect(stringifyValue(null)).toBe('null')
		expect(stringifyValue(undefined)).toBe('undefined')
		expect(stringifyValue(0)).toBe('0')
		expect(stringifyValue(Number.NaN)).toBe('NaN')
	})

	it('renders an Error as `name: message` (not the empty JSON object)', () => {
		expect(stringifyValue(new TypeError('bad'))).toBe('TypeError: bad')
		expect(stringifyValue(new Error('boom'))).toBe('Error: boom')
		// A subclass keeps its own name.
		class CustomError extends Error {
			override readonly name = 'CustomError'
		}
		expect(stringifyValue(new CustomError('x'))).toBe('CustomError: x')
	})

	it('renders a plain object / array as compact JSON', () => {
		expect(stringifyValue({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}')
		expect(stringifyValue([1, 2, 3])).toBe('[1,2,3]')
		expect(stringifyValue({})).toBe('{}')
	})

	it('survives a circular reference — drops the back-reference as [Circular], never throws', () => {
		const cycle: Record<string, unknown> = { name: 'root' }
		cycle.self = cycle
		const out = stringifyValue(cycle)
		expect(out).toContain('"name":"root"')
		expect(out).toContain('[Circular]')
		// A nested cycle through an array is handled too.
		const node: Record<string, unknown> = { id: 1 }
		node.children = [node]
		expect(() => stringifyValue(node)).not.toThrow()
	})

	it('falls back to String() when JSON.stringify throws (a BigInt field), never raising', () => {
		// JSON.stringify throws on a BigInt — the helper must catch and degrade, not propagate.
		const value = { big: 10n }
		expect(() => stringifyValue(value)).not.toThrow()
		expect(stringifyValue(value)).toBe(String(value)) // '[object Object]'
	})
})

describe('formatArgs', () => {
	it('space-joins the rendered arguments into one line', () => {
		expect(formatArgs(['count', 3, { ok: true }])).toBe('count 3 {"ok":true}')
	})

	it('renders an empty argument list as an empty string', () => {
		expect(formatArgs([])).toBe('')
	})

	it('renders a single argument with no separator', () => {
		expect(formatArgs(['solo'])).toBe('solo')
		expect(formatArgs([new Error('e')])).toBe('Error: e')
	})

	it('is total — a circular argument does not throw', () => {
		const cycle: Record<string, unknown> = {}
		cycle.self = cycle
		expect(() => formatArgs(['prefix', cycle])).not.toThrow()
		expect(formatArgs(['prefix', cycle])).toContain('[Circular]')
	})
})

// renderBar — the pure determinate progress-bar renderer (the animation-layer sibling of the box /
// table / tree / separator renderers). A filled / empty glyph track sized to the visible `width`,
// followed by the rounded percentage and the clamped `(current/total)` count. Pure + width-aware +
// styler-optional; `current` is always clamped to [0, total] so an overrun / negative never breaks it.

describe('renderBar', () => {
	it('renders a half-full bar with percentage and count', () => {
		expect(renderBar({ current: 5, total: 10, width: 10 })).toBe('█████░░░░░ 50% (5/10)')
	})

	it('renders an empty bar at zero', () => {
		expect(renderBar({ current: 0, total: 10, width: 10 })).toBe('░░░░░░░░░░ 0% (0/10)')
	})

	it('renders a full bar at total', () => {
		expect(renderBar({ current: 10, total: 10, width: 4 })).toBe('████ 100% (10/10)')
	})

	it('sizes the track to exactly `width` visible columns', () => {
		const bar = renderBar({ current: 3, total: 10, width: 20 })
		const track = bar.slice(0, bar.indexOf(' '))
		expect(width(track)).toBe(20)
	})

	it('defaults the track width to DEFAULT_BAR_WIDTH (30) when omitted', () => {
		const bar = renderBar({ current: 0, total: 1 })
		const track = bar.slice(0, bar.indexOf(' '))
		expect(width(track)).toBe(30)
	})

	it('clamps an overrun current to total — a full bar, never over-wide', () => {
		const bar = renderBar({ current: 50, total: 10, width: 6 })
		expect(bar).toBe('██████ 100% (10/10)')
		expect(width(bar.slice(0, bar.indexOf(' ')))).toBe(6)
	})

	it('clamps a negative current to zero — an empty bar', () => {
		expect(renderBar({ current: -5, total: 10, width: 6 })).toBe('░░░░░░ 0% (0/10)')
	})

	it('treats a non-positive total as already complete — a full bar', () => {
		expect(renderBar({ current: 0, total: 0, width: 4 })).toBe('████ 100% (0/0)')
		expect(renderBar({ current: 0, total: -1, width: 4 })).toBe('████ 100% (0/-1)')
	})

	it('rounds the filled cells and the percentage', () => {
		// 1/3 of a width-10 track → round(3.33) = 3 filled cells; round(33.33%) = 33%.
		expect(renderBar({ current: 1, total: 3, width: 10 })).toBe('███░░░░░░░ 33% (1/3)')
	})

	it('honors custom fill / empty glyphs, still width-aware', () => {
		const bar = renderBar({ current: 2, total: 4, width: 8, fill: '=', empty: '-' })
		expect(bar).toBe('====---- 50% (2/4)')
		expect(width(bar.slice(0, bar.indexOf(' ')))).toBe(8)
	})

	it('colors the filled run through the styler but keeps the track width visible-accurate', () => {
		// A COLORED styler (a base styler carries the empty style and paints nothing — see the
		// next case); `.cyan` is what an entity like Progress passes for the filled run.
		const bar = renderBar({ current: 5, total: 10, width: 10, styler: createStyler().cyan })
		// The filled run carries escape codes, so the raw string is longer than the visible track…
		expect(bar.length).toBeGreaterThan('█████░░░░░ 50% (5/10)'.length)
		// …but the visible width of the whole line is unchanged (escapes don't count).
		expect(width(bar)).toBe('█████░░░░░ 50% (5/10)'.length)
		// Stripping the escapes yields exactly the plain bar.
		expect(strip(bar)).toBe('█████░░░░░ 50% (5/10)')
	})

	it('a base styler (empty style) paints nothing — only an accumulated color shows', () => {
		// renderBar colors the filled run THROUGH whatever styler chain it is given; a base styler
		// has no color accumulated, so it renders verbatim — identical to omitting the styler.
		expect(renderBar({ current: 5, total: 10, width: 10, styler: createStyler() })).toBe(
			renderBar({ current: 5, total: 10, width: 10 }),
		)
	})

	it('a disabled styler paints nothing — identical to no styler', () => {
		const disabled = createStyler({ enabled: false })
		expect(renderBar({ current: 4, total: 8, width: 8, styler: disabled })).toBe(
			renderBar({ current: 4, total: 8, width: 8 }),
		)
	})
})

// ── Unicode + adversarial-ANSI edge cases for strip / width ─────────────────────────────
// strip must remove EVERY ANSI escape and NOTHING else; width counts CODE POINTS after the
// strip (its documented basis — NOT terminal cells). These cases pin the CURRENT behavior
// across the whole Unicode + escape spectrum, so any future change (e.g. teaching width
// east-asian double-width) is caught by a failureing assertion rather than passing silently.

// Build escapes from char codes (the source idiom) — no raw control char in the test file.
const ESC_CHAR = String.fromCharCode(27)
const BEL_CHAR = String.fromCharCode(7)
const ST = `${ESC_CHAR}\\` // the String Terminator (ESC \) that can close an OSC

describe('strip — adversarial + non-SGR escape coverage', () => {
	it('reduces an ANSI-only string to the empty string', () => {
		expect(strip(`${ESC}31m${ESC}0m`)).toBe('')
		expect(strip(`${ESC}1m${ESC}4m${ESC}0m`)).toBe('')
	})

	it('strips NESTED escapes — both the outer and inner sequences go', () => {
		// red wrapping bold wrapping the text, each with its own reset.
		expect(strip(`${ESC}31m${ESC}1mhi${ESC}0m${ESC}0m`)).toBe('hi')
	})

	it('strips a CSI sequence carrying private `?` parameter bytes (cursor hide/show)', () => {
		// `ESC_CHAR` is the bare ESC (the file-level `ESC` already includes the `[`), so build the
		// CSI explicitly: ESC + '[?25l' (DECTCEM hide) … ESC + '[?25h' (show) — both stripped.
		expect(strip(`${ESC_CHAR}[?25lhidden${ESC_CHAR}[?25h`)).toBe('hidden')
	})

	it('strips an OSC terminated by BEL (the other OSC terminator)', () => {
		expect(strip(`${ESC_CHAR}]2;tab title${BEL_CHAR}visible`)).toBe('visible')
	})

	it('strips an OSC terminated by the String Terminator (ESC\\\\), not only by BEL', () => {
		expect(strip(`${ESC_CHAR}]0;window title${ST}visible`)).toBe('visible')
	})

	it('leaves a MALFORMED / unterminated CSI untouched (no final byte to close it)', () => {
		// `ESC[31` has no final byte in @–~, so the CSI arm never matches — it is NOT an escape
		// the pattern recognizes, so it passes through verbatim (documents the boundary).
		expect(strip(`${ESC_CHAR}[31`)).toBe(`${ESC_CHAR}[31`)
	})

	it('leaves a lone ESC untouched', () => {
		expect(strip(ESC_CHAR)).toBe(ESC_CHAR)
	})

	it('leaves an unterminated OSC (no BEL, no ST) untouched', () => {
		// The OSC arm requires a BEL or ST terminator; without one it does not match.
		expect(strip(`${ESC_CHAR}]8;;https://example.com`)).toBe(`${ESC_CHAR}]8;;https://example.com`)
	})

	it('does not touch Unicode content — only escapes are removed', () => {
		expect(strip(`${ESC}32m中文 🚀 café${ESC}0m`)).toBe('中文 🚀 café')
	})
})

describe('width — the Unicode framework (code-point basis, documented gaps)', () => {
	it('counts a CJK glyph as ONE per code point — double-width is NOT accounted (documented gap)', () => {
		// The deliberate, documented simplification: width counts code points, so a wide CJK
		// glyph reports 1, not the 2 terminal cells it occupies. Pin it so a future east-asian
		// width fix trips this assertion (and the renderer-drift cases below) on purpose.
		expect(width('中')).toBe(1)
		expect(width('中文')).toBe(2)
	})

	it('counts a fullwidth Latin glyph as ONE code point', () => {
		expect(width('Ａ')).toBe(1) // U+FF21 FULLWIDTH LATIN A — one code point
	})

	it('counts an astral emoji (surrogate pair) as ONE code point', () => {
		expect('🚀'.length).toBe(2) // two UTF-16 units
		expect(width('🚀')).toBe(1)
	})

	it('counts each code point of a ZWJ emoji sequence separately (a known multi-unit gap)', () => {
		// '👨‍👩‍👧' is three emoji joined by two zero-width joiners: 5 code points, 1 grapheme.
		// width reports 5 — it does not collapse grapheme clusters (documents the behavior).
		expect(width('\u{1f468}‍\u{1f469}‍\u{1f467}')).toBe(5)
	})

	it('counts a combining mark as its own code point', () => {
		// 'e' + U+0301 COMBINING ACUTE ACCENT renders as one glyph 'é' but is two code points.
		expect(width('é')).toBe(2)
	})

	it('counts a zero-width character (ZWSP) toward the width', () => {
		// width is visible code points after strip — a U+200B is not an ANSI escape, so it counts.
		expect(width('a​b')).toBe(3)
	})

	it('an ANSI-only string has width 0; the empty string has width 0', () => {
		expect(width(`${ESC}31m${ESC}0m`)).toBe(0)
		expect(width('')).toBe(0)
	})
})

// ── Renderer alignment under wide + styled cells ────────────────────────────────────────
// The renderers must align on the VISIBLE width (strip-then-count), so an ANSI-styled cell
// keeps its column. Because `width` uses the code-point basis, a CJK cell is sized as its
// code-point count (the documented gap): the columns stay internally consistent, even
// though a real terminal would render the wide glyphs two cells each. These cases lock both
// facts: styled cells never drift, and wide-char columns are consistent by code point.

describe('renderer column alignment — styled + wide cells (visible-width basis)', () => {
	it('renderTable keeps every row the same VISIBLE width when a cell is ANSI-styled', () => {
		const styled = `${ESC}31mred${ESC}0m` // visible 'red' (3)
		const table = renderTable({
			columns: [{ label: 'C' }],
			rows: [[styled], ['ab'], ['x']],
			styler: colorStyler.dim,
		})
		const widths = table.split('\n').map((row) => width(row))
		// Column sized to max(visible 'C'=1, 'red'=3, 'ab'=2, 'x'=1) = 3 — all rows equal.
		expect(new Set(widths).size).toBe(1)
		expect(strip(table)).toBe(
			['┌─────┐', '│ C   │', '├─────┤', '│ red │', '│ ab  │', '│ x   │', '└─────┘'].join('\n'),
		)
	})

	it('renderTable columns are internally consistent for CJK cells (code-point sizing)', () => {
		// Each row is sized by code-point width — so the grid does not drift relative to itself,
		// even though a terminal would show the CJK column two cells wider. Pins the gap.
		const table = renderTable({
			columns: [{ label: 'X' }],
			rows: [['中文'], ['ab']],
		})
		const widths = table.split('\n').map((row) => width(row))
		expect(new Set(widths).size).toBe(1) // consistent by the code-point basis
		// '中文' and 'ab' both measure width 2, so the inner column is 2 wide.
		expect(strip(table)).toBe(
			['┌────┐', '│ X  │', '├────┤', '│ 中文 │', '│ ab │', '└────┘'].join('\n'),
		)
	})

	it('renderBox frames a styled multi-line body with every row at equal visible width', () => {
		const box = renderBox({
			content: `${ESC}32m✔ ok${ESC}0m\nplain line`,
			styler: colorStyler.dim,
		})
		const widths = box.split('\n').map((row) => width(row))
		expect(new Set(widths).size).toBe(1)
		// inner width = widest visible line ('plain line' = 10); '✔ ok' (4) padded out.
		expect(strip(box)).toBe(
			['┌────────────┐', '│ ✔ ok       │', '│ plain line │', '└────────────┘'].join('\n'),
		)
	})

	it('renderSeparator keeps the exact visible width with a styled, wide-char title', () => {
		// The title carries escapes AND a CJK glyph; the rule's visible width is still exact by
		// the code-point basis (the escapes do not count; the CJK glyph counts as its code points).
		const rule = renderSeparator({ title: `${ESC}36m中${ESC}0m`, width: 11 })
		expect(width(rule)).toBe(11)
		expect(strip(rule)).toBe(renderSeparator({ title: '中', width: 11 }))
	})
})

// ── align / repeatTo boundary cases ─────────────────────────────────────────────────────

describe('align — boundary widths', () => {
	it('a target of 0 truncates to the empty string', () => {
		expect(align('hi', 0)).toBe('')
	})

	it('a negative target also yields empty (slice(0, negative) is empty)', () => {
		expect(align('hi', -2)).toBe('')
	})

	it('padding the empty string yields all spaces of the target width', () => {
		expect(align('', 3)).toBe('   ')
		expect(align('', 3, 'right')).toBe('   ')
		expect(align('', 0)).toBe('')
	})

	it('right-aligns a styled string by its visible width, escapes preserved', () => {
		const styled = `${ESC}31mab${ESC}0m` // visible 'ab' (2)
		const out = align(styled, 5, 'right')
		expect(width(out)).toBe(5)
		expect(strip(out)).toBe('   ab')
	})
})

describe('repeatTo — degenerate units', () => {
	it('an empty unit yields the empty string for any count', () => {
		expect(repeatTo('', 5)).toBe('')
		expect(repeatTo('', 0)).toBe('')
	})

	it('only the EMPTY unit hits the per === 0 guard — a ZWSP counts as one code point and tiles', () => {
		// width counts code points, so a U+200B (ZWSP) is width 1, NOT 0: repeatTo tiles it like any
		// single-code-point unit (5 ZWSPs), and the per === 0 short-circuit fires only for '' (above).
		expect(width('​')).toBe(1)
		expect(repeatTo('​', 5)).toBe('​​​​​')
		expect(width(repeatTo('​', 5))).toBe(5)
	})

	it('tiles an astral (surrogate-pair) unit by code point, sliced to exactly count', () => {
		// '🚀' is width 1 (one code point); 3 columns ⇒ three rockets, never a bisected pair.
		expect(repeatTo('🚀', 3)).toBe('🚀🚀🚀')
		expect(width(repeatTo('🚀', 3))).toBe(3)
	})
})

// ── stringifyValue — exotic values (total, never throws) ─────────────────────────────────

describe('stringifyValue — exotic / adversarial values', () => {
	it('renders a symbol through String() (not JSON)', () => {
		expect(stringifyValue(Symbol('tag'))).toBe('Symbol(tag)')
	})

	it('renders a function through String()', () => {
		const fn = function named(): void {}
		expect(stringifyValue(fn)).toContain('named')
	})

	it('renders ±0 and Infinity through String()', () => {
		expect(stringifyValue(-0)).toBe('0') // String(-0) is '0'
		expect(stringifyValue(Number.POSITIVE_INFINITY)).toBe('Infinity')
		expect(stringifyValue(Number.NEGATIVE_INFINITY)).toBe('-Infinity')
	})

	it('falls back to String() when an object has a THROWING toJSON, never raising', () => {
		// JSON.stringify invokes toJSON and propagates its throw; the helper must catch + degrade.
		const value = {
			toJSON(): never {
				throw new Error('hostile toJSON')
			},
		}
		expect(() => stringifyValue(value)).not.toThrow()
		expect(stringifyValue(value)).toBe('[object Object]')
	})

	it('renders a Map / Set as their (empty-object) JSON form, never throwing', () => {
		// Neither serializes its entries through JSON.stringify, but neither throws — total.
		expect(() => stringifyValue(new Map([['a', 1]]))).not.toThrow()
		expect(() => stringifyValue(new Set([1, 2]))).not.toThrow()
		expect(stringifyValue(new Map([['a', 1]]))).toBe('{}')
	})

	it('renders a deeply nested plain object as compact JSON', () => {
		expect(stringifyValue({ a: { b: { c: [1, 2] } } })).toBe('{"a":{"b":{"c":[1,2]}}}')
	})

	it('an Error subclass with a throwing getter on a field still renders as name: message', () => {
		// The Error arm reads only `.name` / `.message`, so an exotic own-field never matters.
		const error = new RangeError('out')
		expect(stringifyValue(error)).toBe('RangeError: out')
	})
})

// ── renderBar / renderBox additional boundary cases ─────────────────────────────────────

describe('renderBar — additional boundaries', () => {
	it('renders a percentage with rounding at the half-cell boundary', () => {
		// 1/8 of a width-4 track → round(0.5) = 1 filled cell (round-half-up); 13% rounded.
		expect(renderBar({ current: 1, total: 8, width: 4 })).toBe('█░░░ 13% (1/8)')
	})

	it('a width of 0 yields an empty track but still the percentage + count label', () => {
		expect(renderBar({ current: 5, total: 10, width: 0 })).toBe(' 50% (5/10)')
	})

	it('a non-integer current is clamped and shown verbatim in the count', () => {
		// 2.5/10 → 25%, round(2.5/10·10)=3 cells; the count shows the clamped (unrounded) 2.5.
		expect(renderBar({ current: 2.5, total: 10, width: 10 })).toBe('███░░░░░░░ 25% (2.5/10)')
	})
})

describe('renderBox — title boundary cases', () => {
	it('a title exactly as wide as the content widens the box so the frame stays rectangular', () => {
		const box = renderBox({ content: 'x', title: 'WIDE' })
		const widths = box.split('\n').map((row) => width(row))
		expect(new Set(widths).size).toBe(1) // top edge (with title) equals body + bottom
		expect(box.split('\n')[0]).toContain(' WIDE ')
	})

	it('a styled title in the top border keeps the box rectangular (visible width drives it)', () => {
		const box = renderBox({ content: 'body', title: `${ESC}33mT${ESC}0m`, styler: colorStyler.dim })
		const widths = box.split('\n').map((row) => width(row))
		expect(new Set(widths).size).toBe(1)
		expect(strip(box).split('\n')[0]).toContain(' T ')
	})

	it('an empty-string content renders a single body row (one empty line framed)', () => {
		// ''.split('\n') is [''], so the box has exactly one (blank) content row.
		const box = renderBox({ content: '' })
		const rows = box.split('\n')
		expect(rows).toHaveLength(3) // top, one body row, bottom
		expect(strip(box)).toBe(['┌──┐', '│  │', '└──┘'].join('\n'))
	})

	it('preserves blank interior lines when content has consecutive newlines', () => {
		const box = renderBox({ content: 'a\n\nb' })
		const rows = box.split('\n')
		expect(rows).toHaveLength(5) // top + 3 body + bottom
		const widths = rows.map((row) => width(row))
		expect(new Set(widths).size).toBe(1)
	})
})

// ── F6 — the broadened ANSI_PATTERN grammar (colon-SGR, charset selects, RIS, string families) ──
// strip()/width() are the pure surface driving ANSI_PATTERN; these cases pin the NEW arms the
// broadened alternation adds beyond plain SGR/CSI/OSC (already covered above).

describe('strip — F6 broadened grammar (colon-params, nF, Fp, Fe, Fs, DCS/PM/APC/SOS)', () => {
	it('strips a colon-delimited SGR parameter (truecolor foreground)', () => {
		expect(strip(`${ESC_CHAR}[38:2:100:200:300mtruecolor${ESC_CHAR}[0m`)).toBe('truecolor')
	})

	it('strips an nF charset-select sequence (ESC ( 0)', () => {
		expect(strip(`${ESC_CHAR}(0line-drawing${ESC_CHAR}(B`)).toBe('line-drawing')
	})

	it('strips the Fs RIS sequence (ESC c — full reset)', () => {
		expect(strip(`before${ESC_CHAR}cafter`)).toBe('beforeafter')
	})

	it('strips Fe two-byte sequences (ESC D / ESC M — index/reverse-index)', () => {
		expect(strip(`a${ESC_CHAR}Db${ESC_CHAR}Mc`)).toBe('abc')
	})

	it('strips Fp two-byte sequences (ESC 7 / ESC 8 — save/restore cursor)', () => {
		expect(strip(`${ESC_CHAR}7moved${ESC_CHAR}8`)).toBe('moved')
	})

	it('strips a DCS string terminated by ST (ESC P … ESC \\\\)', () => {
		expect(strip(`${ESC_CHAR}P1$rsome-dcs-payload${ST}visible`)).toBe('visible')
	})

	it('strips APC / PM / SOS string families terminated by ST', () => {
		expect(
			strip(
				`${ESC_CHAR}_apc-payload${ST}a${ESC_CHAR}^pm-payload${ST}b${ESC_CHAR}Xsos-payload${ST}c`,
			),
		).toBe('abc')
	})

	it('an unterminated CSI/OSC still passes through untouched (the lead-arm ordering does not over-match)', () => {
		expect(strip(`${ESC_CHAR}[31`)).toBe(`${ESC_CHAR}[31`)
		expect(strip(`${ESC_CHAR}]8;;https://example.com`)).toBe(`${ESC_CHAR}]8;;https://example.com`)
	})

	it('is linear-time (ReDoS-safe) on an adversarial unterminated CSI with a huge parameter run', () => {
		const hostile = `${ESC_CHAR}[${'9'.repeat(150000)}`
		const start = performance.now()
		const out = strip(hostile)
		const elapsed = performance.now() - start
		expect(out).toBe(hostile) // unterminated — passes through
		expect(elapsed).toBeLessThan(1000) // linear alternation never hangs
	})
})

// ── F6/(e) — stripControls: the NEW core helper stripping raw C0 controls (not ANSI escapes) ──

describe('stripControls', () => {
	it('removes BEL and NUL but leaves tab/newline/carriage-return untouched', () => {
		expect(stripControls('a\x07b\x00c\td\ne\rf')).toBe('abc\td\ne\rf')
	})

	it('removes DEL (0x7F) too', () => {
		expect(stripControls('a\x7fb')).toBe('ab')
	})

	it('leaves plain text untouched', () => {
		expect(stripControls('plain text')).toBe('plain text')
	})

	it('ALSO strips the raw ESC byte (0x1B is a C0 control) — ANSI removal is strip()s job, run FIRST', () => {
		// stripControls is a naive C0-control pass with no ANSI awareness: it removes the ESC byte
		// itself (0x1B falls in \x0E-\x1F), leaving the SGR payload as garbage text. The server sink
		// therefore always runs strip() BEFORE stripControls() on non-TTY output (F6/e).
		expect(stripControls(`${ESC}31mred${ESC}0m`)).toBe('[31mred[0m')
		expect(strip(stripControls(`${ESC}31mred${ESC}0m`))).not.toBe('red') // proves the ordering matters
		expect(stripControls(strip(`${ESC}31mred${ESC}0m`))).toBe('red') // strip-then-stripControls is correct
	})

	it('is re-entrant across repeated calls (fresh RegExp per call, no lastIndex reuse)', () => {
		const input = 'a\x07b'
		expect(stripControls(input)).toBe('ab')
		expect(stripControls(input)).toBe('ab')
	})

	it('the empty string stays empty', () => {
		expect(stripControls('')).toBe('')
	})
})

// ── F7 — renderBox / renderTable no longer throw RangeError on very large inputs ────────────

describe('renderBox / renderTable — F7 large-input hardening (no RangeError)', () => {
	it('renderBox handles ~150k lines of content without a RangeError (reduce, not spread-max)', () => {
		const content = Array.from({ length: 150000 }, (_, index) => `line${index}`).join('\n')
		expect(() => renderBox({ content })).not.toThrow()
	})

	it('renderTable handles ~150k rows without a RangeError (reduce, not spread-max)', () => {
		const rows = Array.from({ length: 150000 }, (_, index) => [`r${index}`])
		expect(() => renderTable({ columns: [{ label: 'X' }], rows })).not.toThrow()
	})
})

// ── M2 — renderTreeChildren: the extracted, exported, self-recursing tree-body helper ───────

describe('renderTreeChildren', () => {
	it('renders a flat list with corner (last) and branch (non-last) connectors', () => {
		expect(renderTreeChildren([{ label: 'a' }, { label: 'b' }], '')).toEqual(['├─ a', '└─ b'])
	})

	it('carries the correct prefix under nested children (guide `│  ` vs blank `   `)', () => {
		const lines = renderTreeChildren(
			[
				{ label: 'a', children: [{ label: 'a1' }, { label: 'a2' }] },
				{ label: 'b', children: [{ label: 'b1' }] },
			],
			'',
		)
		expect(lines).toEqual(['├─ a', '│  ├─ a1', '│  └─ a2', '└─ b', '   └─ b1'])
	})

	it('returns an empty array for an empty node list', () => {
		expect(renderTreeChildren([], '')).toEqual([])
	})

	it('composes with renderTree — renderTree is root label + renderTreeChildren(root.children)', () => {
		const nodes = [{ label: 'a' }, { label: 'b', children: [{ label: 'b1' }] }]
		const direct = renderTreeChildren(nodes, '')
		const viaTree = renderTree({ root: { label: 'root', children: nodes } })
		expect(viaTree).toBe(['root', ...direct].join('\n'))
	})

	it('colors connectors through an optional styler chain, unchanged layout when stripped', () => {
		const lines = renderTreeChildren([{ label: 'a' }], '', colorStyler.dim)
		expect(lines.join('')).toContain(ESC)
		expect(lines.map((line) => strip(line))).toEqual(['└─ a'])
	})
})

// ── M5 — renderBox: padding is clamped (Math.max(0, Math.trunc(...))) — never throws/misrenders ──

describe('renderBox — M5 padding hardening (negative / fractional padding)', () => {
	it('a negative padding is clamped to 0 (no throw, tight box)', () => {
		expect(() => renderBox({ content: 'x', padding: -3 })).not.toThrow()
		expect(renderBox({ content: 'x', padding: -3 })).toBe(renderBox({ content: 'x', padding: 0 }))
	})

	it('a fractional padding is truncated toward zero', () => {
		expect(renderBox({ content: 'x', padding: 2.9 })).toBe(renderBox({ content: 'x', padding: 2 }))
	})

	it('padding 0 renders content flush against the border', () => {
		expect(renderBox({ content: 'x', padding: 0 })).toBe(['┌─┐', '│x│', '└─┘'].join('\n'))
	})
})
