import type {
	LoggerInterface,
	LoggerManagerInterface,
	LoggerManagerOptions,
	LoggerOptions,
} from './types.js'
import { isArray } from '@orkestrel/contract'
import { Logger } from './Logger.js'

/**
 * An event-free registry of named {@link Logger}s plus a convenience fan-out — the §9
 * manager over the logging layer (a registry, never observable itself; each {@link Logger}
 * owns its own `emitter`).
 *
 * @remarks
 * - **Registry (§9).** Loggers live in an insertion-ordered `Map` keyed by `name`.
 *   `register(name, options?)` mints a {@link Logger} named `name` — the manager's default
 *   `level` / `sink` / `styler` / `limit` / `silent` flow in unless `options` OVERRIDES them
 *   (`name` is always the registry key, so any `options.name` is ignored) — stores it (a
 *   re-`register` of the same name OVERWRITES, last write wins), and returns it. `count` is
 *   the map size, `logger(name)` looks one up, `loggers()` lists them in insertion order.
 * - **Removal (§9.2).** `remove()` clears ALL, `remove(name)` drops ONE (`true` if present),
 *   `remove(names)` drops a batch (`true` if any was removed). `clear()` empties the registry.
 *   (Removal does NOT `destroy` the returned loggers — a caller still holding one keeps using
 *   it; the manager simply stops tracking it.)
 * - **Fan-out.** `debug` / `info` / `warn` / `error(message, data?)` forward the one call to
 *   EVERY registered logger; each gates / emits / writes per its own `level` and `sink`. A
 *   fan-out over an empty registry is a no-op.
 * - **Event-free.** No emitter, no events — the manager is a pure registry; observability is
 *   per-{@link Logger}.
 *
 * @example
 * ```ts
 * const manager = new LoggerManager({ level: 'warn' })
 * manager.register('http') // inherits the `warn` default
 * manager.register('db', { level: 'debug' }) // overrides to `debug`
 * manager.warn('slow', { ms: 900 }) // fans out to both loggers
 * manager.count // 2
 * ```
 */
export class LoggerManager implements LoggerManagerInterface {
	readonly #loggers = new Map<string, LoggerInterface>()
	// The defaults flowed into every logger `register` mints (a per-register override wins).
	readonly #level: LoggerManagerOptions['level']
	readonly #sink: LoggerManagerOptions['sink']
	readonly #styler: LoggerManagerOptions['styler']
	readonly #limit: LoggerManagerOptions['limit']
	readonly #silent: LoggerManagerOptions['silent']

	constructor(options?: LoggerManagerOptions) {
		this.#level = options?.level
		this.#sink = options?.sink
		this.#styler = options?.styler
		this.#limit = options?.limit
		this.#silent = options?.silent
	}

	get count(): number {
		return this.#loggers.size
	}

	register(name: string, options?: LoggerOptions): LoggerInterface {
		// The manager's defaults flow in first; the per-register `options` override them; `name`
		// is forced last so it always keys the registry (an `options.name` can't desync the key).
		const logger = new Logger({
			level: this.#level,
			sink: this.#sink,
			styler: this.#styler,
			limit: this.#limit,
			silent: this.#silent,
			...options,
			name,
		})
		this.#loggers.set(name, logger)
		return logger
	}

	logger(name: string): LoggerInterface | undefined {
		return this.#loggers.get(name)
	}

	loggers(): readonly LoggerInterface[] {
		return [...this.#loggers.values()]
	}

	debug(message: string, data?: Record<string, unknown>): void {
		for (const logger of this.#loggers.values()) logger.debug(message, data)
	}

	info(message: string, data?: Record<string, unknown>): void {
		for (const logger of this.#loggers.values()) logger.info(message, data)
	}

	warn(message: string, data?: Record<string, unknown>): void {
		for (const logger of this.#loggers.values()) logger.warn(message, data)
	}

	error(message: string, data?: Record<string, unknown>): void {
		for (const logger of this.#loggers.values()) logger.error(message, data)
	}

	// §9.2: ALL / one / batch under one verb — the array overload declared FIRST by the project
	// convention (a `name` is a string, never an array, so the two never overlap).
	remove(names: readonly string[]): boolean
	remove(name: string): boolean
	remove(): void
	remove(names?: string | readonly string[]): void | boolean {
		if (names === undefined) {
			this.#loggers.clear()
			return
		}
		if (isArray(names)) {
			let removed = false
			for (const name of names) {
				if (this.#loggers.delete(name)) removed = true
			}
			return removed
		}
		return this.#loggers.delete(names)
	}

	clear(): void {
		this.#loggers.clear()
	}
}
