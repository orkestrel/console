import type { EmitterInterface } from '../emitters/types.js'
import type {
	LoggerEventMap,
	LoggerInterface,
	LoggerOptions,
	LogLevel,
	LogRecord,
	SinkInterface,
	StylerInterface,
} from './types.js'
import { Emitter } from '../emitters/Emitter.js'
import { DEFAULT_LOG_LEVEL, DEFAULT_LOG_LIMIT } from './constants.js'
import { createConsoleSink, createStyler } from './factories.js'
import { formatRecord, meetsLevel } from './helpers.js'

/**
 * An observable, leveled logger (AGENTS §13) — the entry point into the structured-logging
 * pipeline. Each `debug` / `info` / `warn` / `error` call builds a frozen {@link LogRecord},
 * gates it by severity, retains a bounded tail of accepted records, ALWAYS emits it on
 * `entry` (the transport seam), and — unless `silent` — formats it into a styled line and
 * writes it to its {@link SinkInterface}.
 *
 * @remarks
 * - **Record + event = transport (§13).** An accepted record is frozen and emitted on
 *   `entry` BEFORE anything else observable — every file / JSON / remote transport rides
 *   `emitter.on('entry')`. The event fires even when `silent`: silence suppresses only the
 *   SINK WRITE, never the record or the event, so transports keep flowing.
 * - **Leveled gate.** A record whose {@link LogLevel} is below the logger's `level` threshold
 *   is dropped ENTIRELY — no record built past the level check, no event, no retention, no
 *   write (see {@link meetsLevel}).
 * - **Bounded retention.** Accepted records accrue in a ring capped at `limit` (default
 *   {@link DEFAULT_LOG_LIMIT}); the oldest is dropped when full. `entries()` returns a copy,
 *   oldest first; `clear()` empties it. NEVER unbounded (scsr's leak).
 * - **Styled write, orthogonal to level.** The line ({@link formatRecord}) is colored through
 *   the injected `styler` (the ANSI default, or a browser `%c` styler at C-f) — a level only
 *   chooses a label color; styling is not a level. A disabled styler yields a plain line.
 * - **Snapshotted sink.** The default {@link createConsoleSink} writes to the `console`
 *   methods captured at creation, so a later `Capture` patching `console` can't loop the
 *   sink's output back into itself.
 *
 * @example
 * ```ts
 * const logger = new Logger({ name: 'http', level: 'info' })
 * logger.emitter.on('entry', (record) => archive(record)) // transport hook
 * logger.info('request', { method: 'GET', path: '/' }) // styled line to the console sink
 * logger.debug('verbose') // dropped — below the `info` threshold
 * logger.entries() // [the info record]
 * ```
 */
export class Logger implements LoggerInterface {
	// The PUSH observation surface (§13) — owned, never inherited. The emitter isolates a
	// listener throw (routing it to the `error` handler), so a buggy transport can never
	// escape into a log call.
	readonly #emitter: Emitter<LoggerEventMap>
	readonly #level: LogLevel
	readonly #name: string | undefined
	readonly #sink: SinkInterface
	readonly #styler: StylerInterface
	readonly #limit: number
	readonly #silent: boolean
	// The bounded retention ring — accepted records, oldest first, capped at #limit.
	readonly #entries: LogRecord[] = []

	constructor(options?: LoggerOptions) {
		this.#emitter = new Emitter<LoggerEventMap>({ on: options?.on, error: options?.error })
		this.#level = options?.level ?? DEFAULT_LOG_LEVEL
		this.#name = options?.name
		this.#sink = options?.sink ?? createConsoleSink()
		this.#styler = options?.styler ?? createStyler()
		this.#limit = options?.limit ?? DEFAULT_LOG_LIMIT
		this.#silent = options?.silent ?? false
	}

	get emitter(): EmitterInterface<LoggerEventMap> {
		return this.#emitter
	}

	get level(): LogLevel {
		return this.#level
	}

	get name(): string | undefined {
		return this.#name
	}

	debug(message: string, data?: Record<string, unknown>): void {
		this.#log('debug', message, data)
	}

	info(message: string, data?: Record<string, unknown>): void {
		this.#log('info', message, data)
	}

	warn(message: string, data?: Record<string, unknown>): void {
		this.#log('warn', message, data)
	}

	error(message: string, data?: Record<string, unknown>): void {
		this.#log('error', message, data)
	}

	entries(): readonly LogRecord[] {
		return [...this.#entries]
	}

	clear(): void {
		this.#entries.length = 0
	}

	destroy(): void {
		this.#entries.length = 0
		this.#emitter.destroy()
	}

	// The single log path behind every level method: gate by severity, then for an accepted
	// record build it frozen, retain it (bounded), emit `entry` ALWAYS, and write the styled
	// line unless silent. A dropped (below-threshold) record does nothing observable.
	#log(level: LogLevel, message: string, data: Record<string, unknown> | undefined): void {
		if (!meetsLevel(this.#level, level)) return
		const record = this.#record(level, message, data)
		this.#retain(record)
		// The transport seam — fires even when silent (silence suppresses only the write).
		this.#emitter.emit('entry', record)
		if (this.#silent) return
		// Pass the level so a stream-aware sink (the default console sink, the C-g TTY sink)
		// can route error/warn to the right stream; a plain sink ignores it.
		this.#sink.write(formatRecord(record, this.#styler), level)
	}

	// Build the immutable, serializable record — `name` / `data` omitted when absent so the
	// frozen value carries only what was supplied. Frozen so a consumer (or transport) can
	// never mutate it after the fact.
	#record(level: LogLevel, message: string, data: Record<string, unknown> | undefined): LogRecord {
		return Object.freeze({
			level,
			message,
			time: Date.now(),
			...(this.#name === undefined ? {} : { name: this.#name }),
			...(data === undefined ? {} : { data }),
		})
	}

	// Push onto the bounded ring, evicting the oldest when at capacity — the retention stays
	// capped at #limit, never growing without bound.
	#retain(record: LogRecord): void {
		this.#entries.push(record)
		if (this.#entries.length > this.#limit) this.#entries.shift()
	}
}
