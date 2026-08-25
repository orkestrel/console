import { describe, expect, it } from 'vitest'
import { createRecordingSink } from './setup.js'

describe('createRecordingSink', () => {
	it('records each write as a (text, level) pair, in call order', () => {
		const sink = createRecordingSink()
		const written: ReadonlyArray<readonly [string, 'info' | 'warn' | undefined]> = [
			['first line', 'info'],
			['second line', 'warn'],
			['third line', undefined],
		]
		for (const [text, level] of written) sink.write(text, level)

		// A second route: rebuild the expected tuple list from the input array directly, rather
		// than reading it back through the sink under test, so the assertion cannot pass by
		// echoing whatever the sink happened to store.
		const expected = written.map(([text, level]) => [text, level])
		expect(sink.calls).toEqual(expected)
	})

	it('starts with no recorded calls', () => {
		const sink = createRecordingSink()
		expect(sink.calls).toEqual([])
	})

	it('gives every sink instance its own independent call list', () => {
		const first = createRecordingSink()
		const second = createRecordingSink()
		first.write('only on first', 'info')
		expect(first.calls).toEqual([['only on first', 'info']])
		expect(second.calls).toEqual([])
	})
})

// Mutation control (recorded, not left in place): case "records each write as a (text, level)
// pair, in call order" was broken by changing `expected` to reorder the first two tuples, then
// the case failed at the `expect(sink.calls).toEqual(expected)` line with an array-order
// mismatch. The edit was reverted before this file was saved.
