import type { ConsoleErrorCode } from './types.js'

// AGENTS §12: an internal invariant / unreachable-guard violation `throw`s, always a
// `ConsoleError` carrying a machine-readable `code` so a `catch` branches on
// `error.code` instead of parsing the message.

/**
 * An error thrown by the console layer.
 *
 * @remarks
 * Carries a {@link ConsoleErrorCode} and an optional `context` bag. Thrown for: an
 * internal invariant violated at a defensive, structurally-unreachable guard
 * (`INVARIANT`) — the one throw site in this codebase today.
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
		this.context = context
	}
}

/**
 * Narrow an unknown caught value to a {@link ConsoleError}.
 *
 * @param value - The value to test (typically a `catch` binding)
 * @returns `true` when `value` is a {@link ConsoleError}
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
