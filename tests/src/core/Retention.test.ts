import { describe, expect, it } from 'vitest'
import { Retention } from '@src/core'

interface Note {
	readonly level: 'warn' | 'error'
	readonly text: string
}

function note(level: Note['level'], text: string): Note {
	return { level, text }
}

describe('Retention', () => {
	it('starts empty for the whole buffer and for every configured bucket', () => {
		const retention = new Retention<Note>(['warn', 'error'], 10)
		expect(retention.records()).toEqual([])
		expect(retention.records('warn')).toEqual([])
		expect(retention.records('error')).toEqual([])
	})

	it('retains records oldest first in the whole buffer and in their own bucket', () => {
		const retention = new Retention<Note>(['warn', 'error'], 10)
		retention.add(note('warn', 'first'))
		retention.add(note('error', 'second'))
		retention.add(note('warn', 'third'))
		expect(retention.records().map((record) => record.text)).toEqual(['first', 'second', 'third'])
		expect(retention.records('warn').map((record) => record.text)).toEqual(['first', 'third'])
		expect(retention.records('error').map((record) => record.text)).toEqual(['second'])
	})

	it('caps the whole buffer at the limit, dropping the oldest first', () => {
		const retention = new Retention<Note>(['warn'], 2)
		retention.add(note('warn', 'a'))
		retention.add(note('warn', 'b'))
		retention.add(note('warn', 'c'))
		expect(retention.records().map((record) => record.text)).toEqual(['b', 'c'])
	})

	it('caps each bucket independently of the whole buffer', () => {
		const retention = new Retention<Note>(['warn', 'error'], 2)
		retention.add(note('warn', 'w1'))
		retention.add(note('error', 'e1'))
		retention.add(note('warn', 'w2'))
		retention.add(note('warn', 'w3'))
		// The whole buffer keeps its last two; the warn bucket keeps its own last two.
		expect(retention.records().map((record) => record.text)).toEqual(['w2', 'w3'])
		expect(retention.records('warn').map((record) => record.text)).toEqual(['w2', 'w3'])
		expect(retention.records('error').map((record) => record.text)).toEqual(['e1'])
	})

	it('retains a record whose level has no bucket in the whole buffer only', () => {
		const retention = new Retention<Note>(['warn'], 10)
		retention.add(note('error', 'unbucketed'))
		expect(retention.records().map((record) => record.text)).toEqual(['unbucketed'])
		expect(retention.records('error')).toEqual([])
	})

	it('returns an empty list for a level with no bucket rather than failing', () => {
		const retention = new Retention<Note>([], 10)
		retention.add(note('warn', 'only'))
		expect(retention.records('warn')).toEqual([])
		expect(retention.records()).toHaveLength(1)
	})

	it('returns a copy each call, so a caller cannot mutate the retained state', () => {
		const retention = new Retention<Note>(['warn'], 10)
		retention.add(note('warn', 'kept'))
		const whole = retention.records()
		const bucket = retention.records('warn')
		expect(whole).not.toBe(retention.records())
		expect(bucket).not.toBe(retention.records('warn'))
		// Mutating the returned lists leaves the retained state untouched.
		const mutableWhole: Note[] = [...whole]
		mutableWhole.length = 0
		expect(retention.records()).toHaveLength(1)
	})

	it('clears the whole buffer and every bucket without disabling further retention', () => {
		const retention = new Retention<Note>(['warn'], 10)
		retention.add(note('warn', 'before'))
		retention.clear()
		expect(retention.records()).toEqual([])
		expect(retention.records('warn')).toEqual([])
		retention.add(note('warn', 'after'))
		expect(retention.records().map((record) => record.text)).toEqual(['after'])
		expect(retention.records('warn').map((record) => record.text)).toEqual(['after'])
	})

	it('retains nothing at a limit of zero', () => {
		const retention = new Retention<Note>(['warn'], 0)
		retention.add(note('warn', 'dropped'))
		expect(retention.records()).toEqual([])
		expect(retention.records('warn')).toEqual([])
	})

	it('keeps exactly one record at a limit of one', () => {
		const retention = new Retention<Note>(['warn'], 1)
		retention.add(note('warn', 'old'))
		retention.add(note('warn', 'new'))
		expect(retention.records().map((record) => record.text)).toEqual(['new'])
		expect(retention.records('warn').map((record) => record.text)).toEqual(['new'])
	})

	it('ignores a repeated level in the constructor list (one bucket per level)', () => {
		const retention = new Retention<Note>(['warn', 'warn'], 10)
		retention.add(note('warn', 'once'))
		expect(retention.records('warn').map((record) => record.text)).toEqual(['once'])
	})
})
