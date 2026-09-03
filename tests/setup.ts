// Base test setup — environment-agnostic helpers loaded first by every Vitest project
// (`setupFiles[0]`). Keep this file free of `node:*` and of `document` / `window`: node-only
// helpers live in `setupServer.ts`, DOM-only helpers live in `setupBrowser.ts`.

import type { LogLevel, SinkInterface } from '@src/core'
import { createRecorder } from '@orkestrel/test'
import { strip } from '@src/core'

/**
 * A recording {@link import('@src/core').SinkInterface} — a real `SinkInterface` whose `write`
 * records each `(text, level)` it receives, exposed as the `calls` tuple list. The shared form of
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
 * Create a {@link RecordingSinkInterface} — a real `SinkInterface` built on {@link createRecorder}
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
