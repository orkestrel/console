import { describe, expect, it } from 'vitest'
import { isBufferEncoding, isStreamTarget } from '@src/server'

describe('isStreamTarget', () => {
	it('accepts the real process streams', () => {
		expect(isStreamTarget(process.stdout)).toBe(true)
		expect(isStreamTarget(process.stderr)).toBe(true)
	})

	it('accepts any object with a callable write', () => {
		expect(isStreamTarget({ write: () => true })).toBe(true)
		// isTTY / columns are optional — a bare write is enough (a piped stream still writes).
		expect(isStreamTarget({ write: () => {}, isTTY: false })).toBe(true)
	})

	it('rejects off-shape values without throwing (total guard)', () => {
		expect(isStreamTarget({})).toBe(false)
		expect(isStreamTarget({ write: 'not a function' })).toBe(false)
		expect(isStreamTarget(null)).toBe(false)
		expect(isStreamTarget(undefined)).toBe(false)
		expect(isStreamTarget(42)).toBe(false)
		expect(isStreamTarget('stdout')).toBe(false)
		expect(isStreamTarget([])).toBe(false)
	})

	it('accepts a partial stream shape carrying isTTY/columns but missing write only if write is callable', () => {
		// The guard keys solely off a callable `write`; isTTY/columns presence is irrelevant.
		expect(isStreamTarget({ isTTY: true, columns: 100 })).toBe(false) // no write → off-shape
		expect(isStreamTarget({ write: () => true, isTTY: true, columns: 100 })).toBe(true)
		// A `write` of the wrong primitive kind is still off-shape (null / number / object write).
		expect(isStreamTarget({ write: null })).toBe(false)
		expect(isStreamTarget({ write: 7 })).toBe(false)
		expect(isStreamTarget({ write: {} })).toBe(false)
	})

	it('accepts a target whose write returns void (a fake stream need not signal backpressure)', () => {
		// StreamTargetInterface.write returns `boolean | void`; a void-returning write is valid.
		const target = { write: (_text: string): void => {} }
		expect(isStreamTarget(target)).toBe(true)
	})
})

describe('isBufferEncoding', () => {
	it('accepts real Node buffer encodings', () => {
		expect(isBufferEncoding('utf8')).toBe(true)
		expect(isBufferEncoding('hex')).toBe(true)
		expect(isBufferEncoding('base64')).toBe(true)
	})

	it('accepts the full Node encoding family, case-insensitively / hyphenated', () => {
		for (const encoding of [
			'utf-8',
			'UTF8',
			'ascii',
			'latin1',
			'binary',
			'ucs2',
			'utf16le',
			'base64url',
		]) {
			expect(isBufferEncoding(encoding)).toBe(true)
		}
	})

	it('rejects non-encodings / non-strings (total guard)', () => {
		expect(isBufferEncoding('not-an-encoding')).toBe(false)
		expect(isBufferEncoding('')).toBe(false)
		expect(isBufferEncoding(undefined)).toBe(false)
		expect(isBufferEncoding(null)).toBe(false)
		expect(isBufferEncoding(() => {})).toBe(false)
		expect(isBufferEncoding(42)).toBe(false)
		// A Buffer-encoding-NAMED object is not a string → rejected (no duck typing).
		expect(isBufferEncoding({ toString: () => 'utf8' })).toBe(false)
	})
})
