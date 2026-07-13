// Pure helpers for the C-g server-console branch (AGENTS §5 — every function here is exported and
// unit-tested). Total utilities: the stream-target boundary guard (narrow `process.stdout` / any
// injected target without `as`, §14), the TTY column probe, and the total chunk→text decoder (with
// its encoding guard) the process-capture wrapper reuses so intercepting `process.*.write` can never
// throw (§14).

import type { StreamTargetInterface } from './types.js'
import { DEFAULT_COLUMNS } from './constants.js'

/**
 * Whether `value` is a usable {@link StreamTargetInterface} — a record with a callable `write`. A
 * total type guard (AGENTS §14): it NEVER throws and returns `false` for anything off-shape, so it
 * narrows the one unavoidable boundary (the real `process.stdout` / `process.stderr`, or a fake
 * stream a test injects) to the exact slice the sink + capture touch — no `as`.
 *
 * @remarks
 * Only `write` is required (the irreducible output method); `isTTY` and `columns` are optional on
 * {@link StreamTargetInterface}, so their absence does not disqualify a target — a piped stream
 * (no `isTTY`) is still a valid write target, just a non-terminal one.
 *
 * @param value - Any value crossing the boundary (a process stream, an injected fake, `unknown`)
 * @returns `true` when `value` has a callable `write`
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
 * The width in character cells of a stream target — its live `columns` when it is a TTY, else the
 * non-interactive {@link DEFAULT_COLUMNS} fallback. The basis a {@link import('./types.js').ServerSinkInterface}
 * reports through `columns` so a `Reporter` / `Progress` can size its layout to the terminal.
 *
 * @remarks
 * Reads `target.columns` ON EACH CALL (so a getter-backed real stream reflects a live resize) and
 * accepts it only when it is a positive finite number; a missing / `0` / non-finite `columns` (a
 * piped, non-TTY stream) falls back to {@link DEFAULT_COLUMNS}. Total — never throws.
 *
 * @param target - The stream whose width to probe
 * @returns The terminal column count, or {@link DEFAULT_COLUMNS} when not a TTY
 */
export function columnsOf(target: StreamTargetInterface): number {
	const columns = target.columns
	if (typeof columns === 'number' && Number.isFinite(columns) && columns > 0) return columns
	return DEFAULT_COLUMNS
}

/**
 * Decode one `process.stdout.write` / `process.stderr.write` chunk to a string — TOTAL, never
 * throws (AGENTS §14). The process write signature accepts `string | Uint8Array` plus an optional
 * encoding; the capture wrapper reuses this so intercepting a raw stream write can never crash the
 * host (a throw inside `process.stdout.write` would take the program down).
 *
 * @remarks
 * - A `string` chunk is returned verbatim — the common case (`console.log`, most library output,
 *   and `process.stdout.write('text')` all pass a string).
 * - A `Buffer` chunk is decoded with the supplied `encoding` when it is a recognized
 *   {@link BufferEncoding} (`process` write supports `'utf8'` / `'hex'` / `'base64'` / …), defaulting
 *   to `'utf8'`; a bare `Uint8Array` is decoded via `TextDecoder` (always utf-8 — the `encoding`
 *   argument applies ONLY to a `Buffer`, never a plain `Uint8Array`).
 * - Anything else is coerced with `String(chunk)` (a number / object / bigint / symbol a misbehaving
 *   writer hands the stream). The coercion is itself guarded: a value whose `toString` /
 *   `Symbol.toPrimitive` throws yields the stable `'[unprintable]'` placeholder. So the helper is
 *   TOTAL on every input — it always yields SOME string, never an exception (a throw here would
 *   escape into `process.*.write` and crash the host).
 *
 * @param chunk - The chunk passed to the stream's `write`
 * @param encoding - The optional encoding argument passed alongside the chunk
 * @returns The chunk as text
 *
 * @example
 * ```ts
 * decodeChunk('hi') // 'hi'
 * decodeChunk(Buffer.from('hi')) // 'hi'
 * decodeChunk(new Uint8Array([104, 105])) // 'hi'
 * ```
 */
export function decodeChunk(chunk: unknown, encoding?: unknown): string {
	if (typeof chunk === 'string') return chunk
	try {
		if (Buffer.isBuffer(chunk)) {
			return chunk.toString(isBufferEncoding(encoding) ? encoding : 'utf8')
		}
		if (chunk instanceof Uint8Array) return new TextDecoder().decode(chunk)
		// The String() coercion is inside the try too: a value with a hostile `toString` /
		// `Symbol.toPrimitive` would otherwise throw HERE and escape into `process.*.write`, crashing
		// the host — the exact failure this total decoder exists to prevent (§14). Guard it.
		return String(chunk)
	} catch {
		// Any decode / coercion failure yields a stable placeholder — the helper is total on EVERY
		// input (the kind a misbehaving writer could hand the patched stream), never an exception.
		return '[unprintable]'
	}
}

/**
 * Whether `encoding` is a {@link BufferEncoding} accepted by `Buffer.prototype.toString` — a total
 * guard used by {@link decodeChunk} to honor a process-write `encoding` argument only when it is a
 * real Node encoding (otherwise utf-8 is assumed).
 *
 * @param encoding - The candidate encoding (the second `write` argument, possibly a callback)
 * @returns `true` when `encoding` names a supported buffer encoding
 */
export function isBufferEncoding(encoding: unknown): encoding is BufferEncoding {
	return typeof encoding === 'string' && Buffer.isEncoding(encoding)
}
