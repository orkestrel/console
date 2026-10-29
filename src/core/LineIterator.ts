/**
 * Yields a position for each requested blank line without allocating the whole sequence.
 * @example
 * ```ts
 * [...new LineIterator(2)] // [0, 1]
 * ```
 */
export class LineIterator implements IterableIterator<number> {
	readonly #count: number
	#index = 0

	constructor(count: number) {
		this.#count = count
	}

	next(): IteratorResult<number> {
		if (!(this.#index < this.#count)) return { done: true, value: undefined }
		const value = this.#index
		this.#index += 1
		return { done: false, value }
	}

	[Symbol.iterator](): IterableIterator<number> {
		return this
	}
}
