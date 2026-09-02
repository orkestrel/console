import type { RetentionInterface } from './types.js'

/**
 * Implements the bounded, level-keyed retention engine both captures buffer through — one capped total buffer
 * plus one capped bucket per level, generic over the record type each capture carries.
 *
 * @remarks
 * - **One engine, two captures.** The core `Capture` retains
 *   {@link import('./types.js').CapturedMessage}s keyed by
 *   {@link import('./types.js').CaptureLevel}, and the server `ProcessCapture` retains chunks keyed
 *   by its stream level; both compose this, so their retention semantics cannot drift apart.
 * - **Bounded on both axes.** `add` appends to the total buffer and to the record's bucket, then
 *   drops the oldest of whichever exceeded `limit`, so neither grows without bound.
 * - **Buckets are fixed at construction.** Only the levels passed to the constructor get a bucket.
 *   A record at any other level still joins the total buffer, and `records(level)` for a level with
 *   no bucket returns an empty list.
 * - **Copies out.** `records` returns a fresh list each call, so retained state is never reachable
 *   for mutation through a returned value.
 *
 * @example
 * ```ts
 * const retention = new Retention<{ level: 'warn' | 'error'; text: string }>(['warn'], 2)
 * retention.add({ level: 'warn', text: 'first' })
 * retention.add({ level: 'error', text: 'second' }) // no bucket, still in the total buffer
 * retention.records().length // 2
 * retention.records('warn').map((record) => record.text) // ['first']
 * retention.clear()
 * retention.records() // []
 * ```
 */
export class Retention<T extends { readonly level: string }> implements RetentionInterface<T> {
	readonly #limit: number
	// The bounded total buffer — every retained record, oldest first, capped at #limit.
	readonly #records: T[] = []
	// The bounded per-level buckets — one capped buffer per level supplied at construction.
	readonly #buckets = new Map<T['level'], T[]>()

	constructor(levels: ReadonlyArray<T['level']>, limit: number) {
		this.#limit = limit
		for (const level of levels) this.#buckets.set(level, [])
	}

	add(record: T): void {
		this.#push(this.#records, record)
		const bucket = this.#buckets.get(record.level)
		if (bucket !== undefined) this.#push(bucket, record)
	}

	records(): readonly T[]
	records(level: T['level']): readonly T[]
	records(level?: T['level']): readonly T[] {
		if (level === undefined) return [...this.#records]
		return [...(this.#buckets.get(level) ?? [])]
	}

	clear(): void {
		this.#records.length = 0
		for (const bucket of this.#buckets.values()) bucket.length = 0
	}

	// Bounded push — append, then drop the oldest while over the cap.
	#push(buffer: T[], record: T): void {
		buffer.push(record)
		if (buffer.length > this.#limit) buffer.shift()
	}
}
