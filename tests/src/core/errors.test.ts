import { ConsoleError, isConsoleError } from '@src/core'
import { describe, expect, it } from 'vitest'

describe('isConsoleError', () => {
	it('accepts a class-instance context', () => {
		class Context {
			readonly [key: string]: unknown
			readonly offset = 8
		}

		const context: Readonly<Record<string, unknown>> = new Context()
		const error = new ConsoleError('INVARIANT', 'failure', context)
		expect(isConsoleError(error)).toBe(true)
	})

	it('accepts a callable context', () => {
		const members: Readonly<Record<string, unknown>> = { offset: 8 }
		const context = Object.assign(() => undefined, members)
		const error = new ConsoleError('INVARIANT', 'failure', context)
		expect(isConsoleError(error)).toBe(true)
	})
})
