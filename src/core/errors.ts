import type { ConsoleErrorCode } from './types.js'
import { holds, INTRINSICS, isFunction, isInstance, isObject, isString } from '@orkestrel/contract'

// An internal invariant / unreachable-guard violation `throw`s, always a
// `ConsoleError` carrying a machine-readable `code` so a `catch` branches on
// `error.code` instead of parsing the message.

/**
 * Carries a {@link ConsoleErrorCode} and an optional `context` bag — the error the console layer
 * throws for an internal invariant violated at a defensive guard.
 *
 * @remarks
 * `INVARIANT` is the code for a guard that is structurally unreachable, so a `catch` branches on
 * `error.code` rather than parsing the message.
 */
export class ConsoleError extends Error {
	readonly code: ConsoleErrorCode
	readonly context?: Readonly<Record<string, unknown>>

	constructor(
		code: ConsoleErrorCode,
		message: string,
		context?: Readonly<Record<string, unknown>>,
	) {
		super(message)
		Object.defineProperty(this, Symbol.for('@orkestrel/console.ConsoleError'), { value: this })
		this.name = 'ConsoleError'
		this.code = code
		if (context !== undefined) this.context = context
	}
}

/**
 * Narrows an unknown caught value to a {@link ConsoleError} — the guard a `catch` branches on.
 *
 * @param value - The value to test (typically a `catch` binding)
 * @returns True if `value` is a {@link ConsoleError}; false otherwise
 *
 * @example
 * ```ts
 * try {
 * 	createStyler().style
 * } catch (error) {
 * 	if (isConsoleError(error) && error.code === 'INVARIANT') report(error)
 * }
 * ```
 */
export function isConsoleError(value: unknown): value is ConsoleError {
	return holds(() => {
		if (!isInstance(value, Error) || INTRINSICS.prototype(value) === Error.prototype) return false
		if (INTRINSICS.describe(value, Symbol.for('@orkestrel/console.ConsoleError'))?.value !== value)
			return false
		const context: unknown = INTRINSICS.reflect.read(value, 'context')
		return (
			INTRINSICS.reflect.read(value, 'code') === 'INVARIANT' &&
			isString(INTRINSICS.reflect.read(value, 'message')) &&
			(context === undefined || isObject(context) || isFunction(context))
		)
	})
}
