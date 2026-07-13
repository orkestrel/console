import type { ReporterInterface } from '@src/core'
import { createReporter, createStyler, Reporter, strip } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createRecordingSink } from '../../../setup.js'

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
	})

	describe('table / tree / box delegate to the renderers + write', () => {
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

		it('status colors only via the styler — a disabled styler yields a plain icon + message', () => {
			// The reporter's default `.dim` chain still resolves to the level color; a disabled styler
			// (createTestReporter) paints nothing, so the icon + message come through plain.
			const { reporter, sink } = createTestReporter()
			reporter.status('warn', 'plain warn')
			expect(firstLine(sink)).toBe('⚠ plain warn')
			expect(strip(firstLine(sink))).toBe('⚠ plain warn') // no escapes to strip
		})
	})

	describe('event-free (AGENTS §13)', () => {
		it('carries no emitter — it is a pure formatting front-end', () => {
			const { reporter } = createTestReporter()
			expect('emitter' in reporter).toBe(false)
		})
	})

	describe('factory parity', () => {
		it('createReporter yields a working reporter over a supplied sink + plain styler', () => {
			const sink = createRecordingSink()
			const reporter = createReporter({ sink, styler: createStyler({ enabled: false }), width: 10 })
			reporter.status('info', 'hello')
			expect(firstLine(sink)).toBe('ℹ hello')
		})

		it('defaults to the snapshotted console sink (writes one line through console.log)', () => {
			const seen: string[] = []
			const original = console.log
			console.log = (text: string) => seen.push(text)
			try {
				const reporter = createReporter({ styler: createStyler({ enabled: false }) })
				reporter.line('via default sink')
				expect(seen).toEqual(['via default sink'])
			} finally {
				console.log = original
			}
		})
	})
})
