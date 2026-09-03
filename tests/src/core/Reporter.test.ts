import type { ReporterInterface } from '@src/core'
import { createStyler, createTheme, DEFAULT_THEME, Reporter, strip } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createRecordingSink } from '../../setup.js'

// Reporter — the lean, EVENT-FREE narrative front-end: section / step / timing / status /
// table / tree / box / line / blank, each formatting through the ONE styler + the pure
// renderers and writing to the ONE sink. Tests use a recording sink (capturing text + the
// optional level hint) and a DISABLED styler (plain lines) so layout assertions read the
// content, not escape codes; a couple assert the enabled-styler coloring + error routing.

// A reporter whose output is fully captured + deterministic: a recording sink + a disabled
// styler (plain text). `width` is small + fixed so separator / box layouts are exact.
function createTestReporter(width = 12): {
	reporter: ReporterInterface
	sink: ReturnType<typeof createRecordingSink>
} {
	const sink = createRecordingSink()
	const reporter = new Reporter({ sink, styler: createStyler({ enabled: false }), width })
	return { reporter, sink }
}

// The text of the first (usually only) line a verb wrote.
function firstLine(sink: ReturnType<typeof createRecordingSink>): string {
	return sink.calls[0]?.[0] ?? ''
}

describe('Reporter', () => {
	describe('section', () => {
		it('writes a titled separator rule to the reporter width', () => {
			const { reporter, sink } = createTestReporter(13)
			reporter.section('Hi')
			// width 13: ` Hi ` (4 visible) centered, 9 fill split 4 / 5.
			expect(firstLine(sink)).toBe('──── Hi ─────')
			expect(strip(firstLine(sink))).toHaveLength(13)
		})

		it('writes through the sink with no level hint (not the error stream)', () => {
			const { reporter, sink } = createTestReporter()
			reporter.section('Setup')
			expect(sink.calls[0]?.[1]).toBeUndefined()
		})
	})

	describe('step', () => {
		it('writes a bare step line with no position', () => {
			const { reporter, sink } = createTestReporter()
			reporter.step('compiling')
			expect(firstLine(sink)).toBe('compiling')
		})

		it('prefixes [index/total] when a position is given', () => {
			const { reporter, sink } = createTestReporter()
			reporter.step('bundling', { index: 2, total: 5 })
			expect(firstLine(sink)).toBe('[2/5] bundling')
		})
	})

	describe('timing', () => {
		it('renders sub-second durations as milliseconds', () => {
			const { reporter, sink } = createTestReporter()
			reporter.timing('lint', 850)
			expect(firstLine(sink)).toBe('lint … 850ms')
		})

		it('renders >= 1s durations as seconds to 2 decimals', () => {
			const { reporter, sink } = createTestReporter()
			reporter.timing('build', 1234)
			expect(firstLine(sink)).toBe('build … 1.23s')
		})
	})

	describe('status', () => {
		it('writes an icon + message for each level (plain styler)', () => {
			const { reporter, sink } = createTestReporter()
			reporter.status('success', 'ok')
			reporter.status('error', 'boom')
			reporter.status('warn', 'careful')
			reporter.status('info', 'fyi')
			expect(sink.calls.map(([text]) => text)).toEqual(['✔ ok', '✖ boom', '⚠ careful', 'ℹ fyi'])
		})

		it('routes ONLY error to the sink error stream; the rest carry no level', () => {
			const { reporter, sink } = createTestReporter()
			reporter.status('success', 'a')
			reporter.status('error', 'b')
			reporter.status('warn', 'c')
			reporter.status('info', 'd')
			expect(sink.calls.map(([, level]) => level)).toEqual([
				undefined,
				'error',
				undefined,
				undefined,
			])
		})

		it('colors the icon + message through the styler when enabled (orthogonal to routing)', () => {
			const sink = createRecordingSink()
			const reporter = new Reporter({ sink, styler: createStyler() })
			reporter.status('error', 'failure')
			const text = firstLine(sink)
			expect(text).toContain('\x1b[31m') // red — error's color
			expect(strip(text)).toBe('✖ failure')
			expect(sink.calls[0]?.[1]).toBe('error')
		})

		it('uses the supplied status icon and style for both icon and message', () => {
			const sink = createRecordingSink()
			const reporter = new Reporter({
				sink,
				styler: createStyler(),
				theme: createTheme({
					statuses: {
						warn: { icon: '?', style: createStyler().brightMagenta.bold.style },
					},
				}),
			})
			reporter.status('warn', 'check')
			expect(firstLine(sink)).toBe('\x1b[1;95m?\x1b[0m \x1b[1;95mcheck\x1b[0m')
		})
	})

	describe('theme roles', () => {
		it('pins the exact default-theme bytes for success, warn, and info statuses', () => {
			const sink = createRecordingSink()
			const reporter = new Reporter({ sink })
			reporter.status('success', 'ok')
			reporter.status('warn', 'careful')
			reporter.status('info', 'fyi')
			expect(sink.calls).toEqual([
				['\x1b[32m✔\x1b[0m \x1b[32mok\x1b[0m', undefined],
				['\x1b[33m⚠\x1b[0m \x1b[33mcareful\x1b[0m', undefined],
				['\x1b[34mℹ\x1b[0m \x1b[34mfyi\x1b[0m', undefined],
			])
		})

		it('pins the exact default-theme bytes for a chrome-framed section', () => {
			const sink = createRecordingSink()
			const reporter = new Reporter({ sink, width: 8 })
			reporter.section('S')
			expect(firstLine(sink)).toBe('\x1b[2m──\x1b[0m \x1b[2mS\x1b[0m \x1b[2m───\x1b[0m')
		})

		it('pins the exact default-theme bytes for a two-level tree', () => {
			const sink = createRecordingSink()
			const reporter = new Reporter({ sink })
			reporter.tree({ root: { label: 'root', children: [{ label: 'a' }, { label: 'b' }] } })
			expect(firstLine(sink)).toBe('root\n\x1b[2m├─ \x1b[0ma\n\x1b[2m└─ \x1b[0mb')
		})

		it('uses accent only for the positioned step prefix', () => {
			const sink = createRecordingSink()
			const reporter = new Reporter({
				sink,
				styler: createStyler(),
				theme: createTheme({ accent: createStyler().brightMagenta.bold.style }),
			})
			reporter.step('bundle', { index: 2, total: 5 })
			expect(firstLine(sink)).toBe('\x1b[1;95m[2/5]\x1b[0m bundle')
		})

		it('uses chrome for section, timing suffix, table, tree, and box frames', () => {
			const sink = createRecordingSink()
			const reporter = new Reporter({
				sink,
				styler: createStyler(),
				width: 8,
				theme: createTheme({ chrome: createStyler().underline.style }),
			})
			reporter.section('S')
			reporter.timing('build', 1000)
			reporter.table({ columns: [{ label: 'A' }], rows: [['1']] })
			reporter.tree({ root: { label: 'root', children: [{ label: 'leaf' }] } })
			reporter.box({ content: 'body' })
			const output = sink.calls.map(([text]) => text)
			expect(output[0]).toContain('\x1b[4m')
			expect(output[1]).toBe('build \x1b[4m… 1.00s\x1b[0m')
			expect(output[2]).toContain('\x1b[4m┌───┐\x1b[0m')
			expect(output[2]).toContain('\n\x1b[4m│\x1b[0m 1 \x1b[4m│\x1b[0m')
			expect(output[3]).toBe('root\n\x1b[4m└─ \x1b[0mleaf')
			expect(output[4]).toContain('\x1b[4m┌──────┐\x1b[0m')
			expect(output[4]).toContain('\n\x1b[4m│\x1b[0m body \x1b[4m│\x1b[0m')
		})

		it('keeps all nine verb outputs byte-identical with the explicit default theme', () => {
			const implicitSink = createRecordingSink()
			const explicitSink = createRecordingSink()
			const implicit = new Reporter({ sink: implicitSink, width: 12 })
			const explicit = new Reporter({ sink: explicitSink, width: 12, theme: DEFAULT_THEME })
			implicit.section('S')
			explicit.section('S')
			implicit.step('step', { index: 1, total: 2 })
			explicit.step('step', { index: 1, total: 2 })
			implicit.timing('time', 12)
			explicit.timing('time', 12)
			implicit.status('success', 'ok')
			explicit.status('success', 'ok')
			implicit.table({ columns: [{ label: 'A' }], rows: [['1']] })
			explicit.table({ columns: [{ label: 'A' }], rows: [['1']] })
			implicit.tree({ root: { label: 'root', children: [{ label: 'leaf' }] } })
			explicit.tree({ root: { label: 'root', children: [{ label: 'leaf' }] } })
			implicit.box({ content: 'body' })
			explicit.box({ content: 'body' })
			implicit.line('raw')
			explicit.line('raw')
			implicit.blank()
			explicit.blank()
			expect(implicitSink.calls).toEqual(explicitSink.calls)
		})
	})

	describe('table / tree / box delegate to the renderers + write', () => {
		it('lets a caller-supplied table styler own the frame without merging theme chrome', () => {
			const sink = createRecordingSink()
			const reporter = new Reporter({ sink, styler: createStyler() })
			reporter.table({
				columns: [{ label: 'A' }],
				rows: [['1']],
				styler: createStyler().red,
			})
			expect(firstLine(sink)).toContain('\x1b[31m┌───┐\x1b[0m')
			expect(firstLine(sink)).not.toContain('\x1b[2;31m')
		})

		it('table writes a bordered grid built from the columns + rows', () => {
			const { reporter, sink } = createTestReporter()
			reporter.table({ columns: [{ label: 'A' }, { label: 'B' }], rows: [['1', '22']] })
			expect(firstLine(sink)).toBe(
				['┌───┬────┐', '│ A │ B  │', '├───┼────┤', '│ 1 │ 22 │', '└───┴────┘'].join('\n'),
			)
		})

		it('tree writes the nested connectors', () => {
			const { reporter, sink } = createTestReporter()
			reporter.tree({
				root: {
					label: 'root',
					children: [{ label: 'a' }, { label: 'b', children: [{ label: 'c' }] }],
				},
			})
			expect(firstLine(sink)).toBe(['root', '├─ a', '└─ b', '   └─ c'].join('\n'))
		})

		it('box frames the content, defaulting its width to the reporter width', () => {
			const { reporter, sink } = createTestReporter(8)
			reporter.box({ content: 'hi' })
			// width 8 ⇒ inner 4 (8 − 2 borders − 2 padding); 'hi' left-padded to 4.
			expect(firstLine(sink)).toBe(['┌──────┐', '│ hi   │', '└──────┘'].join('\n'))
		})

		it('an explicit box option overrides the reporter default', () => {
			const { reporter, sink } = createTestReporter(40)
			reporter.box({ content: 'x', border: 'double' })
			// double border + the box hugs 'x' since no per-call width (the reporter default applies).
			expect(firstLine(sink)).toContain('╔')
			expect(firstLine(sink)).toContain('║ x')
		})
	})

	describe('line / blank', () => {
		it('line writes the text verbatim (already-styled content honored)', () => {
			const { reporter, sink } = createTestReporter()
			reporter.line('  indented raw line  ')
			expect(firstLine(sink)).toBe('  indented raw line  ')
		})

		it('blank writes one empty line by default', () => {
			const { reporter, sink } = createTestReporter()
			reporter.blank()
			expect(sink.calls).toEqual([['', undefined]])
		})

		it('blank writes `count` empty lines', () => {
			const { reporter, sink } = createTestReporter()
			reporter.blank(3)
			expect(sink.calls.map(([text]) => text)).toEqual(['', '', ''])
		})
	})

	describe('boundary + edge inputs', () => {
		it('timing renders exactly one second as 1.00s (the ms→s threshold is inclusive)', () => {
			const { reporter, sink } = createTestReporter()
			reporter.timing('exact', 1000)
			expect(firstLine(sink)).toBe('exact … 1.00s')
		})

		it('timing renders 0ms', () => {
			const { reporter, sink } = createTestReporter()
			reporter.timing('instant', 0)
			expect(firstLine(sink)).toBe('instant … 0ms')
		})

		it('blank(0) writes no lines', () => {
			const { reporter, sink } = createTestReporter()
			reporter.blank(0)
			expect(sink.calls).toHaveLength(0)
		})

		it('section with an empty title still emits a rule of the reporter width', () => {
			const { reporter, sink } = createTestReporter(10)
			reporter.section('')
			// An empty title centers '  ' (two gap spaces) in the rule; the visible width stays exact.
			expect(strip(firstLine(sink))).toHaveLength(10)
		})

		it('a step position renders verbatim even when index exceeds total (caller-controlled)', () => {
			const { reporter, sink } = createTestReporter()
			reporter.step('overrun', { index: 7, total: 5 })
			expect(firstLine(sink)).toBe('[7/5] overrun')
		})

		it('line writes a multi-line payload as ONE sink write (newlines are part of the text)', () => {
			const { reporter, sink } = createTestReporter()
			reporter.line('first\nsecond')
			expect(sink.calls).toHaveLength(1)
			expect(firstLine(sink)).toBe('first\nsecond')
		})

		it('a table with a styled cell keeps every visible row the same width through the reporter', () => {
			const { reporter, sink } = createTestReporter()
			reporter.table({
				columns: [{ label: 'X' }],
				rows: [[`${'\x1b['}31mred\x1b[0m`], ['ab']],
			})
			const widths = firstLine(sink)
				.split('\n')
				.map((row) => strip(row).length)
			expect(new Set(widths).size).toBe(1)
		})

		it('status colors only through the styler — a disabled styler yields a plain icon + message', () => {
			// A disabled styler paints nothing, so the icon + message come through plain.
			const { reporter, sink } = createTestReporter()
			reporter.status('warn', 'plain warn')
			expect(firstLine(sink)).toBe('⚠ plain warn')
			expect(strip(firstLine(sink))).toBe('⚠ plain warn') // no escapes to strip
		})
	})

	describe('event-free — the reporter carries no emitter', () => {
		it('carries no emitter — it is a pure formatting front-end', () => {
			const { reporter } = createTestReporter()
			expect('emitter' in reporter).toBe(false)
		})
	})

	describe('default sink', () => {
		it('defaults to the snapshotted console sink (writes one line through console.log)', () => {
			const seen: string[] = []
			const original = console.log
			console.log = (text: string) => seen.push(text)
			try {
				const reporter = new Reporter({ styler: createStyler({ enabled: false }) })
				reporter.line('via default sink')
				expect(seen).toEqual(['via default sink'])
			} finally {
				console.log = original
			}
		})
	})
})
