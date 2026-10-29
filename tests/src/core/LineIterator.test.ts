import { LineIterator } from '@src/core'
import { describe, expect, it } from 'vitest'

describe('LineIterator', () => {
	it('preserves the numeric comparison for finite, fractional, and absent ranges', () => {
		expect([...new LineIterator(2)]).toEqual([0, 1])
		expect([...new LineIterator(1.5)]).toEqual([0, 1])
		expect([...new LineIterator(0)]).toEqual([])
		expect([...new LineIterator(-1)]).toEqual([])
		expect([...new LineIterator(Number.NaN)]).toEqual([])
	})

	it('advances an infinite range lazily through the same iterator', () => {
		const iterator = new LineIterator(Number.POSITIVE_INFINITY)
		expect(iterator[Symbol.iterator]()).toBe(iterator)
		expect(iterator.next()).toEqual({ done: false, value: 0 })
		expect(iterator.next()).toEqual({ done: false, value: 1 })
	})
})
