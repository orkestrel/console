import { describe, expect, it } from 'vitest'
import { columnsOf, decodeChunk, isBufferEncoding, isStreamTarget } from '@src/server'

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

describe('columnsOf', () => {
	it('returns a TTY stream live columns', () => {
		expect(columnsOf({ write: () => true, isTTY: true, columns: 120 })).toBe(120)
	})

	it('falls back to 80 for a non-TTY / absent / invalid columns', () => {
		expect(columnsOf({ write: () => true })).toBe(80)
		expect(columnsOf({ write: () => true, isTTY: false, columns: undefined })).toBe(80)
		expect(columnsOf({ write: () => true, columns: 0 })).toBe(80)
		expect(columnsOf({ write: () => true, columns: -5 })).toBe(80)
		expect(columnsOf({ write: () => true, columns: Number.NaN })).toBe(80)
		expect(columnsOf({ write: () => true, columns: Number.POSITIVE_INFINITY })).toBe(80)
	})

	it('re-reads columns on each call (a getter-backed resize is observed)', () => {
		let width = 100
		const target = {
			write: () => true,
			isTTY: true,
			get columns() {
				return width
			},
		}
		expect(columnsOf(target)).toBe(100)
		width = 160
		expect(columnsOf(target)).toBe(160)
	})

	it('accepts a positive columns regardless of isTTY (columns alone drives the width)', () => {
		// columnsOf does not consult isTTY — a positive finite columns is taken even when isTTY is
		// false/absent (the sink's TTY decision is separate from the width probe).
		expect(columnsOf({ write: () => true, columns: 132 })).toBe(132)
		expect(columnsOf({ write: () => true, isTTY: false, columns: 132 })).toBe(132)
	})

	it('treats a fractional positive columns as-is (it is finite and > 0)', () => {
		// Only NaN / non-finite / <= 0 fall back; a fractional positive is finite and > 0, so kept.
		expect(columnsOf({ write: () => true, columns: 100.5 })).toBe(100.5)
	})

	it('falls back for negative infinity (non-finite) columns', () => {
		expect(columnsOf({ write: () => true, columns: Number.NEGATIVE_INFINITY })).toBe(80)
	})
})

describe('decodeChunk', () => {
	it('returns a string chunk verbatim', () => {
		expect(decodeChunk('hello')).toBe('hello')
		expect(decodeChunk('')).toBe('')
		// No newline trimming — the captured text is exactly what was written.
		expect(decodeChunk('line\n')).toBe('line\n')
	})

	it('decodes a Buffer to utf-8 by default', () => {
		expect(decodeChunk(Buffer.from('héllo', 'utf8'))).toBe('héllo')
	})

	it('honors a recognized encoding argument on a Buffer', () => {
		const hex = Buffer.from('hi').toString('hex')
		expect(decodeChunk(Buffer.from(hex, 'utf8'), 'utf8')).toBe(hex)
		// A buffer of raw bytes decoded as hex yields the hex text of those bytes.
		expect(decodeChunk(Buffer.from([0x68, 0x69]), 'hex')).toBe('6869')
	})

	it('decodes a bare Uint8Array via TextDecoder (utf-8)', () => {
		expect(decodeChunk(new Uint8Array([104, 105]))).toBe('hi')
	})

	it('ignores a callback in the encoding slot, defaulting to utf-8', () => {
		expect(decodeChunk(Buffer.from('hi'), () => {})).toBe('hi')
	})

	it('honors latin1 / ascii / base64 encodings on a Buffer (each a recognized BufferEncoding)', () => {
		// 0xe9 is 'é' in latin1 — proves the encoding argument is threaded into Buffer.toString.
		expect(decodeChunk(Buffer.from([0xe9]), 'latin1')).toBe('é')
		expect(decodeChunk(Buffer.from('AB', 'ascii'), 'ascii')).toBe('AB')
		// A base64-text buffer read back as base64 yields the base64 of those bytes.
		expect(decodeChunk(Buffer.from('hi'), 'base64')).toBe(Buffer.from('hi').toString('base64'))
	})

	it('accepts case-insensitive / hyphenated encoding spellings (utf-8, UTF8)', () => {
		// Buffer.isEncoding is lenient on case/hyphen; decodeChunk should honor those spellings too.
		expect(decodeChunk(Buffer.from('hi', 'utf8'), 'utf-8')).toBe('hi')
		expect(decodeChunk(Buffer.from('hi', 'utf8'), 'UTF8')).toBe('hi')
	})

	it('IGNORES the encoding argument for a bare Uint8Array (always utf-8 via TextDecoder)', () => {
		// Only a Buffer routes encoding through toString; a plain Uint8Array decodes utf-8 regardless,
		// so an unrecognized / non-utf8 encoding cannot change a Uint8Array decode.
		expect(decodeChunk(new Uint8Array([104, 105]), 'hex')).toBe('hi')
		expect(decodeChunk(new Uint8Array([104, 105]), 'latin1')).toBe('hi')
	})

	it('falls back to utf-8 when the encoding argument is not a recognized BufferEncoding', () => {
		// A bogus encoding string is rejected by isBufferEncoding → utf-8 default, never a throw.
		expect(decodeChunk(Buffer.from('hi', 'utf8'), 'not-an-encoding')).toBe('hi')
		expect(decodeChunk(Buffer.from('hi', 'utf8'), 42)).toBe('hi')
	})

	it('is total — falls back to String() for an unrecognized chunk, never throws', () => {
		expect(decodeChunk(42)).toBe('42')
		expect(decodeChunk(undefined)).toBe('undefined')
		expect(decodeChunk(null)).toBe('null')
	})

	it('is total for exotic non-buffer args (object / bigint / symbol / boolean) via String()', () => {
		// The runtime can hand the patched stream write anything; decodeChunk must coerce, never throw.
		expect(decodeChunk({})).toBe('[object Object]')
		expect(decodeChunk(10n)).toBe('10')
		expect(decodeChunk(Symbol('s'))).toBe('Symbol(s)')
		expect(decodeChunk(true)).toBe('true')
		expect(decodeChunk([1, 2, 3])).toBe('1,2,3')
	})

	it('never throws on a value whose toString / Symbol.toPrimitive throws — yields a placeholder', () => {
		// A throw inside decodeChunk would escape into the patched process.*.write and crash the host;
		// the total-decode contract (§14) must hold for EVERY value, including a hostile coercion.
		const hostileToString = {
			toString(): never {
				throw new Error('hostile toString')
			},
		}
		const hostilePrimitive = {
			[Symbol.toPrimitive](): never {
				throw new Error('hostile toPrimitive')
			},
		}
		expect(decodeChunk(hostileToString)).toBe('[unprintable]')
		expect(decodeChunk(hostilePrimitive)).toBe('[unprintable]')
		expect(() => decodeChunk(hostileToString)).not.toThrow()
		expect(() => decodeChunk(hostilePrimitive)).not.toThrow()
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
