// Base test setup — environment-agnostic helpers loaded first by every Vitest project
// (`setupFiles[0]`). Keep this file free of `node:*` and of `document` / `window`: node-only
// helpers live in `setupServer.ts`, DOM-only helpers live in `setupBrowser.ts`.

import type {
	Color,
	LogLevel,
	LogRecord,
	LoggerInterface,
	ReporterInterface,
	SinkInterface,
	Style,
	RendererInterface,
} from '@src/core'
import { createRecorder } from '@orkestrel/test'
import {
	ANSIRenderer,
	createStyler,
	EMPTY_STYLE,
	Logger,
	LoggerManager,
	Reporter,
	strip,
} from '@src/core'
import { Styler } from '../src/core/Styler.js'

/**
 * Records each `(text, level)` a real {@link import('@src/core').SinkInterface}'s `write`
 * receives, exposed as the `calls` tuple list. The shared form of
 * the per-file copy the console tests (`Logger` / `Spinner` / `Reporter` / `LoggerManager` /
 * `Progress` / `Capture`) each drove their sink-seam through: a real sink, NOT a
 * behaviour mock, so an assertion reads the genuine writes. `SinkInterface` / `LogLevel` are pure
 * `@src/core` types (env-agnostic), so it lives in the shared setup.
 */
export interface RecordingSinkInterface extends SinkInterface {
	/** Each `write` call's `(text, level)`, in order — the sink's recorded output. */
	readonly calls: ReadonlyArray<readonly [text: string, level: LogLevel | undefined]>
}

/**
 * Creates a {@link RecordingSinkInterface} — a real `SinkInterface` built on {@link createRecorder}
 * whose `write(text, level?)` records the pair into `calls`, for asserting exactly what a console
 * entity wrote to its sink (and at which level) without a behaviour mock.
 *
 * @returns A sink whose `write` records each `(text, level)` into `calls`
 */
export function createRecordingSink(): RecordingSinkInterface {
	const recorder = createRecorder<readonly [text: string, level: LogLevel | undefined]>()
	return {
		get calls() {
			return recorder.calls
		},
		write(text: string, level?: LogLevel): void {
			recorder.handler(text, level)
		},
	}
}

/**
 * Reduces one recorded write to the text a terminal shows — ANSI stripped through
 * {@link import('@src/core').strip}, the leading `\r` of an animation frame and the trailing
 * newline of a committed line removed. The shared form of the `strip(text).replace(/^\r/, '')`
 * chain the console suites repeat, so an assertion reads the bytes a reader would see rather than
 * the framing the sink seam carries. `strip` is a pure `@src/core` helper, so this stays
 * host-independent.
 *
 * @param text - One recorded sink write, exactly as the entity wrote it
 * @returns That write's visible text
 */
export function normalizeVisible(text: string): string {
	return strip(text).replace(/^\r/, '').replace(/\n$/, '')
}

/**
 * Returns a zero-argument stand-in producing `label` — a distinct, referentially stable function
 * value for a test proving a lookup returns the identical reference it was given rather than a
 * copy.
 *
 * @param label - The string the returned function produces
 * @returns A function taking no arguments and returning `label`
 */
export function createStubWriter(label: string): () => string {
	return () => label
}

/** Returns a callback that throws the supplied error. */
export function createFailure(error: unknown): () => never {
	return () => {
		throw error
	}
}

/** Creates a renderer that writes the foreground as a text prefix. */
export function createColorRenderer(): RendererInterface {
	return {
		render(style: Style, text: string): string {
			return style.foreground === undefined ? text : `<${style.foreground}>${text}`
		},
	}
}

/** Creates a renderer that writes the attributes and foreground as a text prefix. */
export function createTokenRenderer(): RendererInterface {
	return {
		render(style: Style, text: string): string {
			const parts = [...style.attributes, style.foreground].filter((part) => part !== undefined)
			return parts.length === 0 ? text : `[${parts.join('+')}]${text}`
		},
	}
}

/** Holds a mutable foreground behind an own enumerable accessor for snapshot proofs. */
export class ColorFixture {
	#foreground: Color
	declare foreground: Color
	readonly attributes = []

	constructor(foreground: Color) {
		this.#foreground = foreground
		// An own enumerable accessor, as an object literal's getter is, so a spread reads it once.
		Object.defineProperty(this, 'foreground', {
			enumerable: true,
			get: () => this.#foreground,
			set: (value: Color) => {
				this.#foreground = value
			},
		})
	}
}

export interface Note {
	readonly level: 'warn' | 'error'
	readonly text: string
}

export function createRecordingRenderer(): RendererInterface & {
	readonly calls: readonly Style[]
} {
	const calls: Style[] = []
	return {
		get calls() {
			return calls
		},
		render(style: Style, text: string): string {
			calls.push(style)
			return text
		},
	}
}

export function base(): Styler {
	return new Styler(new ANSIRenderer(), true, EMPTY_STYLE)
}

export function frames(sink: RecordingSinkInterface): readonly string[] {
	return sink.calls.map(([text]) => text.replace(/^\r/, '').replace(/\n$/, ''))
}

export function note(level: Note['level'], text: string): Note {
	return { level, text }
}

export function createTestReporter(width = 12): {
	reporter: ReporterInterface
	sink: ReturnType<typeof createRecordingSink>
} {
	const sink = createRecordingSink()
	const reporter = new Reporter({ sink, styler: createStyler({ enabled: false }), width })
	return { reporter, sink }
}

export function firstLine(sink: ReturnType<typeof createRecordingSink>): string {
	return sink.calls[0]?.[0] ?? ''
}

export function bars(sink: ReturnType<typeof createRecordingSink>): readonly string[] {
	return sink.calls.map(([text]) => text.replace(/^\r/, '').replace(/\n$/, ''))
}

export function record(
	partial: Partial<LogRecord> & Pick<LogRecord, 'level' | 'message'>,
): LogRecord {
	return { time: 0, ...partial }
}

export function createTestManager(level: LogLevel = 'debug'): {
	manager: LoggerManager
	sink: ReturnType<typeof createRecordingSink>
} {
	const sink = createRecordingSink()
	const manager = new LoggerManager({ level, sink, styler: createStyler({ enabled: false }) })
	return { manager, sink }
}

export function createTestLogger(
	options?: Partial<{ level: LogLevel; name: string; limit: number; silent: boolean }>,
): { logger: LoggerInterface; sink: ReturnType<typeof createRecordingSink> } {
	const sink = createRecordingSink()
	const logger = new Logger({
		level: options?.level ?? 'debug',
		styler: createStyler({ enabled: false }),
		sink,
		...(options?.name === undefined ? {} : { name: options.name }),
		...(options?.limit === undefined ? {} : { limit: options.limit }),
		...(options?.silent === undefined ? {} : { silent: options.silent }),
	})
	return { logger, sink }
}
