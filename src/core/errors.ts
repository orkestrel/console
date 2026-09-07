import type { ConsoleErrorCode } from './types.js'

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
	return value instanceof ConsoleError
}
