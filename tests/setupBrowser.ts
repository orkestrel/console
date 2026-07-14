import type { TestRecorderInterface } from './setup.js'
import { createRecorder } from './setup.js'

// ── Console capture (swap + restore the three console methods) ────────────────

/** The three captured console methods plus the restore — a real call-recording
 *  swap (AGENTS §16.1), not a framework spy. */
export interface ConsoleCaptureInterface {
	/** `console.log`'s recorded `(format, ...styles)` calls. */
	readonly log: TestRecorderInterface<readonly [format: string, ...styles: string[]]>
	/** `console.warn`'s recorded calls. */
	readonly warn: TestRecorderInterface<readonly [format: string, ...styles: string[]]>
	/** `console.error`'s recorded calls. */
	readonly error: TestRecorderInterface<readonly [format: string, ...styles: string[]]>
	/** Restore the original `console.log` / `warn` / `error`. */
	restore(): void
}

/**
 * Swap `console.log` / `warn` / `error` for recording callbacks and return them plus
 * a `restore` — a real call-recording capture (AGENTS §16.1), not a framework mock,
 * so a console sink test can assert the exact `(format, ...styles)` tuples each
 * method received. Call `restore()` in an `afterEach` so no swap leaks.
 *
 * @returns The three method recorders and a `restore` to put the originals back
 */
export function captureConsole(): ConsoleCaptureInterface {
	const original = {
		log: console.log,
		warn: console.warn,
		error: console.error,
	}
	const log = createRecorder<readonly [string, ...string[]]>()
	const warn = createRecorder<readonly [string, ...string[]]>()
	const error = createRecorder<readonly [string, ...string[]]>()
	console.log = log.handler
	console.warn = warn.handler
	console.error = error.handler
	const restore = (): void => {
		console.log = original.log
		console.warn = original.warn
		console.error = original.error
	}
	return { log, warn, error, restore }
}
