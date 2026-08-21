// Base test setup — environment-agnostic helpers loaded first by every Vitest project
// (`setupFiles[0]`). Keep this file free of `node:*` and of `document` / `window`: node-only
// helpers live in `setupServer.ts`, DOM-only helpers live in `setupBrowser.ts`.

import type { LogLevel, SinkInterface } from '@src/core'
import { createRecorder } from '@orkestrel/test'

/**
 * A recording {@link import('@src/core').SinkInterface} — a real `SinkInterface` whose `write`
 * records each `(text, level)` it receives, exposed as the `calls` tuple list. The shared form of
 * the per-file copy the console tests (`Logger` / `Spinner` / `Reporter` / `LoggerManager` /
 * `Progress` / `Capture`) each drove their sink-seam through (AGENTS §16.1): a real sink, NOT a
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
 * entity wrote to its sink (and at which level) without a behaviour mock (AGENTS §16.1).
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
