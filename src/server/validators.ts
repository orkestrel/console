// Total boundary guards for the server-console branch; every guard here is exported and unit-tested.
// They narrow the two unavoidable boundaries the sink and the process capture cross — an injected or
// real stream target, and the encoding argument a `process.*.write` carries — so neither surface
// needs a type assertion and neither can throw on adversarial input.

import type { StreamTargetInterface } from './types.js'

/**
 * Checks whether `value` is a usable {@link StreamTargetInterface} — a record with a callable `write`. A
 * total type guard: it never throws and returns `false` for anything off-shape, so it
 * narrows the one unavoidable boundary (the real `process.stdout` / `process.stderr`, or a fake
 * stream a test injects) to the exact slice the sink + capture touch — no `as`.
 *
 * @remarks
 * Only `write` is required (the irreducible output method); `isTTY` and `columns` are optional on
 * {@link StreamTargetInterface}, so their absence does not disqualify a target — a piped stream
 * (no `isTTY`) is still a valid write target, only a non-terminal one.
 *
 * @param value - Any value crossing the boundary (a process stream, an injected fake, `unknown`)
 * @returns True if `value` has a callable `write`; false otherwise
 *
 * @example
 * ```ts
 * isStreamTarget(process.stdout) // true
 * isStreamTarget({ write: () => true }) // true
 * isStreamTarget({}) // false (no write)
 * ```
 */
export function isStreamTarget(value: unknown): value is StreamTargetInterface {
	return (
		typeof value === 'object' &&
		value !== null &&
		'write' in value &&
		typeof value.write === 'function'
	)
}

/**
 * Checks whether `encoding` is a {@link BufferEncoding} accepted by `Buffer.prototype.toString` — a total
 * guard used by {@link import('./helpers.js').decodeChunk} to honor a process-write `encoding`
 * argument only when it is a real Node encoding (otherwise utf-8 is assumed).
 *
 * @param encoding - The candidate encoding (the second `write` argument, possibly a callback)
 * @returns True if `encoding` names a supported buffer encoding; false otherwise
 */
export function isBufferEncoding(encoding: unknown): encoding is BufferEncoding {
	return typeof encoding === 'string' && Buffer.isEncoding(encoding)
}
