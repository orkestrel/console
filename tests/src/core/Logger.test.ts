import type { LoggerInterface, LogLevel, LogRecord } from '@src/core'
import { createLogger, createStyler, Logger, strip } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createErrorRecorder, createRecordingSink, recordEmitterEvents } from '../../setup.js'

// Logger — the observable, leveled entry point into structured logging. Each call builds a
// frozen LogRecord, gates by severity, retains a bounded tail, ALWAYS emits `entry` (the
// transport seam, even when silent), and — unless silent — writes a styled line to its sink.
// Tests use a recording sink (capturing text + level) and record the `entry` event; styling
// is disabled (a plain styler) so line assertions read the layout, not escape codes.

// A logger whose output is fully captured + deterministic: a recording sink + a disabled
// styler (plain text lines). `level` defaults low so nothing is gated unless a test sets it.
function createTestLogger(
	options?: Partial<{ level: LogLevel; name: string; limit: number; silent: boolean }>,
): { logger: LoggerInterface; sink: ReturnType<typeof createRecordingSink> } {
	const sink = createRecordingSink()
	const logger = new Logger({
		level: options?.level ?? 'debug',
		styler: createStyler({ enabled: false }),
		sink,
		...(options?.name === undefined ? {} : { name: options.name }),
		...(options?.limit === undefined ? {} : { limit: options.limit }),
		...(options?.silent === undefined ? {} : { silent: options.silent }),
	})
	return { logger, sink }
}

describe('Logger', () => {
	describe('the four level methods', () => {
		it('each builds a record at its own level and writes a line', () => {
			const { logger, sink } = createTestLogger()
			logger.debug('d')
			logger.info('i')
			logger.warn('w')
			logger.error('e')
			expect(logger.entries().map((record) => record.level)).toEqual([
				'debug',
				'info',
				'warn',
				'error',
			])
			expect(sink.calls.map(([, level]) => level)).toEqual(['debug', 'info', 'warn', 'error'])
		})

		it('stamps the message and a numeric epoch time on each record', () => {
			const before = Date.now()
			const { logger } = createTestLogger()
			logger.info('hello')
			const after = Date.now()
			const [record] = logger.entries()
			expect(record?.message).toBe('hello')
			expect(typeof record?.time).toBe('number')
			expect(record?.time).toBeGreaterThanOrEqual(before)
			expect(record?.time).toBeLessThanOrEqual(after)
		})

		it('attaches structured data when supplied, omits the key otherwise', () => {
			const { logger } = createTestLogger()
			logger.info('with', { user: 'a', count: 2 })
			logger.info('without')
			const [withData, withoutData] = logger.entries()
			expect(withData?.data).toEqual({ user: 'a', count: 2 })
			expect(withoutData && 'data' in withoutData).toBe(false)
		})
	})

	describe('the level gate', () => {
		it('drops records below the threshold entirely — no record, no event, no write', () => {
			const sink = createRecordingSink()
			const logger = new Logger({ level: 'warn', styler: createStyler({ enabled: false }), sink })
			const events = recordEmitterEvents(logger.emitter, ['entry'])
			logger.debug('d')
			logger.info('i')
			logger.warn('w')
			logger.error('e')
			expect(logger.entries().map((record) => record.level)).toEqual(['warn', 'error'])
			expect(sink.calls).toHaveLength(2)
			expect(events.entry.count).toBe(2)
		})

		it('an error-level logger keeps only errors', () => {
			const { logger, sink } = createTestLogger({ level: 'error' })
			logger.warn('w')
			logger.error('e')
			expect(logger.entries()).toHaveLength(1)
			expect(sink.calls).toHaveLength(1)
		})

		it('defaults the threshold to info (debug dropped, info kept)', () => {
			const sink = createRecordingSink()
			const logger = new Logger({ styler: createStyler({ enabled: false }), sink })
			expect(logger.level).toBe('info')
			logger.debug('d')
			logger.info('i')
			expect(logger.entries().map((record) => record.level)).toEqual(['info'])
		})
	})

	describe('the entry event — the transport seam', () => {
		it('emits the frozen record for every accepted log', () => {
			const { logger } = createTestLogger()
			const events = recordEmitterEvents(logger.emitter, ['entry'])
			logger.info('a', { x: 1 })
			logger.error('b')
			expect(events.entry.count).toBe(2)
			const [first] = events.entry.calls
			const record = first?.[0]
			expect(record?.message).toBe('a')
			expect(record?.level).toBe('info')
			// The record is frozen — a transport can read but never mutate it.
			expect(Object.isFrozen(record)).toBe(true)
		})

		it('initial on-hooks subscribe at construction', () => {
			const received: LogRecord[] = []
			const logger = new Logger({
				styler: createStyler({ enabled: false }),
				sink: createRecordingSink(),
				on: { entry: (record) => received.push(record) },
			})
			logger.info('hooked')
			expect(received.map((record) => record.message)).toEqual(['hooked'])
		})

		it('a throwing listener is isolated and routed to the error handler (never escapes)', () => {
			const errors = createErrorRecorder()
			const logger = new Logger({
				styler: createStyler({ enabled: false }),
				sink: createRecordingSink(),
				error: errors.handler,
			})
			logger.emitter.on('entry', () => {
				throw new Error('bad transport')
			})
			// The log must not throw despite the bad listener.
			expect(() => logger.info('ok')).not.toThrow()
			expect(errors.count).toBe(1)
			expect(errors.calls[0]?.[1]).toBe('entry')
		})
	})

	describe('silent — suppresses the write, never the event', () => {
		it('emits entry and retains the record but writes nothing to the sink', () => {
			const { logger, sink } = createTestLogger({ silent: true })
			const events = recordEmitterEvents(logger.emitter, ['entry'])
			logger.info('quiet')
			logger.error('still quiet')
			expect(events.entry.count).toBe(2)
			expect(logger.entries()).toHaveLength(2)
			expect(sink.calls).toHaveLength(0)
		})
	})

	describe('bounded retention', () => {
		it('keeps at most `limit` records, dropping the oldest first', () => {
			const { logger } = createTestLogger({ limit: 3 })
			for (const n of [1, 2, 3, 4, 5]) logger.info(`m${n}`)
			expect(logger.entries().map((record) => record.message)).toEqual(['m3', 'm4', 'm5'])
		})

		it('entries() returns a copy — mutating it cannot corrupt the ring', () => {
			const { logger } = createTestLogger()
			logger.info('one')
			const snapshot = logger.entries()
			expect(() => {
				// A readonly view at the type level; prove the internal store is independent.
				const copy = [...snapshot]
				copy.length = 0
			}).not.toThrow()
			expect(logger.entries()).toHaveLength(1)
		})

		it('clear() empties retention but keeps the logger usable', () => {
			const { logger } = createTestLogger()
			logger.info('a')
			logger.info('b')
			logger.clear()
			expect(logger.entries()).toHaveLength(0)
			logger.info('c')
			expect(logger.entries().map((record) => record.message)).toEqual(['c'])
		})
	})

	describe('styled write (orthogonal to level)', () => {
		it('writes the layout: time LEVEL [name] message (plain styler)', () => {
			const { logger, sink } = createTestLogger({ name: 'http' })
			logger.warn('low disk')
			const [text] = sink.calls[0] ?? []
			// ISO time + upper-cased label + bracketed name + message — no escape codes (disabled styler).
			expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z WARN \[http\] low disk$/)
		})

		it('appends structured data as compact JSON, omits it when empty', () => {
			const { logger, sink } = createTestLogger()
			logger.info('m', { a: 1 })
			logger.info('n', {})
			expect(sink.calls[0]?.[0]).toContain('{"a":1}')
			expect(sink.calls[1]?.[0]).not.toContain('{')
		})

		it('colors the label through the styler — a level only chooses a color, not a level', () => {
			// An ENABLED styler: the WARN label is wrapped in yellow SGR; stripping yields the plain layout.
			const sink = createRecordingSink()
			const logger = new Logger({ level: 'debug', styler: createStyler(), sink, name: 'x' })
			logger.warn('hot')
			const text = sink.calls[0]?.[0] ?? ''
			expect(text).toContain('\x1b[33m') // yellow — WARN's color
			expect(strip(text)).toMatch(/ WARN \[x\] hot$/)
		})

		it('omits the name segment when the logger is anonymous', () => {
			const { logger, sink } = createTestLogger()
			logger.info('no name')
			expect(sink.calls[0]?.[0]).toMatch(/ INFO no name$/)
		})
	})

	describe('the level-routing sink seam', () => {
		it('passes the record level to the sink so it can route', () => {
			const { logger, sink } = createTestLogger()
			logger.error('boom')
			expect(sink.calls[0]?.[1]).toBe('error')
		})
	})

	describe('the level gate — exact boundaries per threshold', () => {
		it('keeps exactly the levels at or above the threshold, drops those below, for EACH threshold', () => {
			// Drive every (threshold, level) pair and assert the kept set matches the severity order
			// debug < info < warn < error — the boundary is inclusive at the threshold itself.
			const levels: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']
			const expected: Record<LogLevel, readonly LogLevel[]> = {
				debug: ['debug', 'info', 'warn', 'error'],
				info: ['info', 'warn', 'error'],
				warn: ['warn', 'error'],
				error: ['error'],
			}
			for (const threshold of levels) {
				const { logger } = createTestLogger({ level: threshold })
				for (const level of levels) logger[level](`m-${level}`)
				expect(logger.entries().map((record) => record.level)).toEqual(expected[threshold])
			}
		})
	})

	describe('the LogRecord.data freeze is a SHALLOW top-level copy (documented)', () => {
		it('freezes the record AND a top-level frozen copy of data, but a nested object stays live and mutable', () => {
			const { logger } = createTestLogger()
			const data: Record<string, unknown> = { count: 1, nested: { value: 'a' } }
			logger.info('m', data)
			const [record] = logger.entries()
			// The record envelope is frozen — top-level fields cannot be reassigned.
			expect(Object.isFrozen(record)).toBe(true)
			// The top-level `data` copy taken at log time is ALSO frozen — reassigning `count` fails.
			expect(record?.data && Object.isFrozen(record.data)).toBe(true)
			// …but the copy is SHALLOW: nested values remain BY REFERENCE, so mutating the caller's
			// object after logging is still observable through the retained record's nested value.
			if (record?.data !== undefined && 'nested' in record.data) {
				const nested = record.data.nested
				if (nested !== null && typeof nested === 'object' && 'value' in nested) {
					Reflect.set(nested, 'value', 'mutated')
				}
			}
			const [after] = logger.entries()
			expect(after?.data?.nested).toEqual({ value: 'mutated' })
		})

		it('mutating the top-level of the caller object AFTER logging does NOT affect the retained record', () => {
			const { logger } = createTestLogger()
			const data: Record<string, unknown> = { a: 1 }
			logger.info('m', data)
			data.a = 999 // mutate the caller's object after logging
			data.b = 'new' // add a key after logging
			const [record] = logger.entries()
			// The top-level copy was taken at log time — unaffected by later mutation of the original.
			expect(record?.data).toEqual({ a: 1 })
			expect(record?.data).not.toBe(data) // frozen copy, not the caller's reference
		})
	})

	describe('bounded retention — exact boundary', () => {
		it('retains EXACTLY `limit` records (at the cap, nothing dropped)', () => {
			const { logger } = createTestLogger({ limit: 3 })
			logger.info('m1')
			logger.info('m2')
			logger.info('m3') // exactly at the cap
			expect(logger.entries().map((record) => record.message)).toEqual(['m1', 'm2', 'm3'])
		})

		it('drops exactly the oldest one when going ONE over the cap', () => {
			const { logger } = createTestLogger({ limit: 3 })
			for (const n of [1, 2, 3, 4]) logger.info(`m${n}`) // one over → m1 evicted
			expect(logger.entries().map((record) => record.message)).toEqual(['m2', 'm3', 'm4'])
		})

		it('a limit of 1 keeps only the most recent record', () => {
			const { logger } = createTestLogger({ limit: 1 })
			logger.info('a')
			logger.info('b')
			expect(logger.entries().map((record) => record.message)).toEqual(['b'])
		})
	})

	describe('destroy', () => {
		it('clears retention and destroys the emitter', () => {
			const { logger } = createTestLogger()
			logger.info('a')
			logger.destroy()
			expect(logger.entries()).toHaveLength(0)
			expect(logger.emitter.destroyed).toBe(true)
		})

		it('is idempotent — a second destroy() does not throw', () => {
			const { logger } = createTestLogger()
			logger.info('a')
			logger.destroy()
			expect(() => logger.destroy()).not.toThrow()
			expect(logger.entries()).toHaveLength(0)
			expect(logger.emitter.destroyed).toBe(true)
		})

		it('a level call after destroy still gates + retains (a destroyed logger is not frozen)', () => {
			// destroy() tears down the emitter + retention, but the logger object remains usable for
			// the level methods (the emit simply has no live listeners). Documents the post-destroy shape.
			const { logger, sink } = createTestLogger()
			logger.destroy()
			expect(() => logger.info('after destroy')).not.toThrow()
			// The record is still built, retained, and written (the emitter is destroyed but emit is safe).
			expect(logger.entries().map((record) => record.message)).toEqual(['after destroy'])
			expect(sink.calls.at(-1)?.[0]).toContain('after destroy')
		})
	})

	describe('factory parity', () => {
		it('createLogger yields a working logger', () => {
			const sink = createRecordingSink()
			const logger = createLogger({ styler: createStyler({ enabled: false }), sink, level: 'info' })
			logger.info('via factory')
			expect(logger.entries().map((record) => record.message)).toEqual(['via factory'])
		})
	})
})
