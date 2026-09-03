// Pure helpers for the server-console branch; every function here is exported and unit-tested.
// Total utilities: the TTY column probe, the total chunk→text decoder the process-capture wrapper
// reuses so intercepting `process.*.write` can never throw, and pure color-environment inference
// for the server sink. The boundary guards live in `validators.ts`.

import type { StreamTargetInterface } from './types.js'
import { DEFAULT_COLUMNS } from './constants.js'
import { isBufferEncoding } from './validators.js'

/**
 * Infers the width in character cells of a stream target — its live `columns` when it is a TTY, else
 * the non-interactive {@link DEFAULT_COLUMNS} fallback. The basis a {@link import('./types.js').ServerSinkInterface}
 * reports through `columns` so a `Reporter` / `Progress` can size its layout to the terminal.
 *
 * @remarks
 * Reads `target.columns` on each call (so a getter-backed real stream reflects a live resize) and
 * accepts it only when it is a positive finite number; a missing / `0` / non-finite `columns` (a
 * piped, non-TTY stream) falls back to {@link DEFAULT_COLUMNS}. Total — never throws.
 *
 * @param target - The stream whose width to probe
 * @returns The terminal column count, or {@link DEFAULT_COLUMNS} when not a TTY
 */
export function inferColumns(target: StreamTargetInterface): number {
	const columns = target.columns
	if (typeof columns === 'number' && Number.isFinite(columns) && columns > 0) return columns
	return DEFAULT_COLUMNS
}

/**
 * Infers whether one stream target receives styled output. The result is a construction-time
 * target fact for {@link import('./factories.js').createServerSink}; this helper is pure and never
 * reads process globals itself.
 *
 * @remarks
 * A present `FORCE_COLOR` key has first precedence: only the exact value `'0'` disables styling.
 * Next, a non-empty `NO_COLOR` disables styling. Otherwise styling follows
 * `target.isTTY === true`.
 *
 * @param target - The stream target whose terminal capability is the fallback
 * @param environment - The environment record supplying `FORCE_COLOR` and `NO_COLOR`
 * @returns True if output for the target retains styling and control sequences; false otherwise
 *
 * @example
 * ```ts
 * inferStyled({ write: () => true, isTTY: false }, { FORCE_COLOR: '1' }) // true
 * inferStyled({ write: () => true, isTTY: true }, { NO_COLOR: '1' }) // false
 * ```
 */
export function inferStyled(
	target: StreamTargetInterface,
	environment: Readonly<Record<string, string | undefined>>,
): boolean {
	if (Object.hasOwn(environment, 'FORCE_COLOR')) return environment.FORCE_COLOR !== '0'
	const disabled = environment.NO_COLOR
	if (disabled !== undefined && disabled !== '') return false
	return target.isTTY === true
}

/**
 * Decodes one `process.stdout.write` / `process.stderr.write` chunk to a string — total, never
 * throws. The process write signature accepts `string | Uint8Array` plus an optional
 * encoding; the capture wrapper reuses this so intercepting a raw stream write can never crash the
 * host (a throw inside `process.stdout.write` would take the program down).
 *
 * @remarks
 * - A `string` chunk is returned verbatim — the common case (`console.log`, most library output,
 *   and `process.stdout.write('text')` all pass a string).
 * - A `Buffer` chunk is decoded with the supplied `encoding` when it is a recognized
 *   {@link BufferEncoding} (`process` write supports `'utf8'` / `'hex'` / `'base64'` / …), defaulting
 *   to `'utf8'`; a bare `Uint8Array` is decoded through `TextDecoder` (always utf-8 — the `encoding`
 *   argument applies only to a `Buffer`, never a plain `Uint8Array`).
 * - Anything else is coerced with `String(chunk)` (a number / object / bigint / symbol a misbehaving
 *   writer hands the stream). The coercion is itself guarded: a value whose `toString` /
 *   `Symbol.toPrimitive` throws yields the stable `'[unprintable]'` placeholder. So the helper is
 *   total on every input — it always yields some string, never an exception (a throw here would
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
		// `Symbol.toPrimitive` would otherwise throw here and escape into `process.*.write`, crashing
		// the host — the exact failure this total decoder exists to prevent. Guard it.
		return String(chunk)
	} catch {
		// Any decode / coercion failure yields a stable placeholder — the helper is total on every
		// input (the kind a misbehaving writer could hand the patched stream), never an exception.
		return '[unprintable]'
	}
}
