import { describe, expect, it } from 'vitest'
import { captureConsole } from './setupBrowser.js'

// `captureConsole` swaps the global `console`'s `log` / `warn` / `error` methods, which exist
// identically in Node and in a browser; it touches no DOM, `window`, or Vue API. Its whole
// contract is host-independent, so this file proves it completely under the `setup` project's
// Node environment. No DOM-driving half remains for a consuming browser suite to prove.

describe('captureConsole', () => {
	it('records each console.log call as its own (format, ...styles) tuple', () => {
		const capture = captureConsole()
		try {
			console.log('plain message')
			console.log('%cstyled', 'color: red')

			// A second route: read the recorder's own `count` and the raw arguments passed to
			// `console.log`, independent of `calls`, so the assertion does not merely restate what
			// the same recorder already reports through another member.
			expect(capture.log.count).toBe(2)
			expect(capture.log.calls[0]).toEqual(['plain message'])
			expect(capture.log.calls[1]).toEqual(['%cstyled', 'color: red'])
		} finally {
			capture.restore()
		}
	})

	it('keeps warn and error recorders independent of log and of each other', () => {
		const capture = captureConsole()
		try {
			console.warn('a warning')
			console.error('an error')
			expect(capture.log.count).toBe(0)
			expect(capture.warn.calls).toEqual([['a warning']])
			expect(capture.error.calls).toEqual([['an error']])
		} finally {
			capture.restore()
		}
	})

	it('restores the exact original console methods by identity', () => {
		const originalLog = console.log
		const originalWarn = console.warn
		const originalError = console.error
		const capture = captureConsole()
		expect(console.log).not.toBe(originalLog)
		expect(console.warn).not.toBe(originalWarn)
		expect(console.error).not.toBe(originalError)

		capture.restore()

		expect(console.log).toBe(originalLog)
		expect(console.warn).toBe(originalWarn)
		expect(console.error).toBe(originalError)
	})

	it('stops recording after restore', () => {
		const capture = captureConsole()
		capture.restore()
		console.log('after restore')
		expect(capture.log.count).toBe(0)
	})
})

// Mutation control (recorded, not left in place): case "restores the exact original console
// methods by identity" was broken by asserting `expect(console.log).not.toBe(originalLog)` AFTER
// `capture.restore()` instead of before, then the case failed at that line because restore had
// already put the original back. The edit was reverted before this file was saved.
