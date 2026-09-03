// Server-test setup — node-only helpers, loaded after `setup.ts` for the node
// `src:server` / `app:server` test projects. `node:fs` / `node:path` imports belong
// here, never in `setup.ts`, which browser projects also load. Anchor every path to
// `WORKSPACE_ROOT` so the runner's cwd never matters.

import type { StreamTargetInterface } from '@src/server'
import type { RecorderInterface } from '@orkestrel/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRecorder, resolveRoot } from '@orkestrel/test'

// Absolute path to the repository root. `resolveRoot` resolves this file's own URL to the
// directory one above `tests/`; the readers below take a path string, so it is converted once here.
export const WORKSPACE_ROOT = fileURLToPath(resolveRoot(import.meta))

// Read one repo-relative text file, anchored to the workspace root.
export function readText(relativePath: string): string {
	return readFileSync(join(WORKSPACE_ROOT, relativePath), 'utf8')
}

// Whether a repo-relative path exists.
export function fileExists(relativePath: string): boolean {
	return existsSync(join(WORKSPACE_ROOT, relativePath))
}

/**
 * A fake {@link StreamTargetInterface} for the server console — a stand-in `process.stdout` /
 * `process.stderr` with a recorded `write`, so a `createServerSink` test drives the isTTY /
 * strip / routing paths WITHOUT touching the real process streams — a reusable server fixture
 * lives in setup. The recorder captures every written string; `isTTY` and
 * `columns` are fixed at construction so a test can exercise the TTY (ANSI verbatim) and
 * non-TTY (ANSI stripped) branches deterministically.
 *
 * @param options - `isTTY` (default `false` — a piped stream) and `columns` (a TTY width, omitted
 *   when not a TTY). `write` always returns `true` (no simulated backpressure unless overridden by
 *   a caller building its own target).
 * @returns The `target` (pass as `stdout` / `stderr` / a process-stream stand-in) plus its `writes`
 *   recorder (`writes.calls` is the list of `[text]` tuples written, `writes.count` the tally).
 */
export function createStreamTarget(options?: { isTTY?: boolean; columns?: number }): {
	readonly target: StreamTargetInterface
	readonly writes: RecorderInterface<readonly [text: string]>
} {
	const writes = createRecorder<readonly [text: string]>()
	const target: StreamTargetInterface = {
		write(text: string): boolean {
			writes.handler(text)
			return true
		},
		isTTY: options?.isTTY ?? false,
		...(options?.columns !== undefined ? { columns: options.columns } : {}),
	}
	return { target, writes }
}

/**
 * A recording stand-in for a raw `process.stdout.write` / `process.stderr.write` — a function
 * assignable to the Node stream `write` slot (so a test can `process.stdout.write = probe.write`
 * with no `as`) that records each chunk as text and returns a configurable backpressure boolean.
 * The `ProcessCapture` test installs one as the "current" write BEFORE starting the capture, so
 * the capture's snapshot-original (and any mirror replay) lands HERE instead of the real terminal —
 * keeping the suite output-clean and the mirror assertion deterministic.
 *
 * @param backpressure - The boolean each `write` returns (default `true` — buffer not full); set
 *   `false` to drive the capture's backpressure-passthrough assertion.
 * @returns The `write` (assign it to a process stream) plus `texts` — the list of chunks written,
 *   each coerced to a string (a Buffer / Uint8Array decoded utf-8), in order.
 */
export function createWriteProbe(backpressure = true): {
	readonly write: NodeJS.WriteStream['write']
	readonly texts: readonly string[]
} {
	const texts: string[] = []
	return {
		write(chunk: string | Uint8Array): boolean {
			texts.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
			return backpressure
		},
		texts,
	}
}

// The completion-callback shape a Node `process.*.write` accepts as its last argument.
export type WriteCallback = (error?: Error | null) => void

/**
 * An OVERLOAD-AWARE recording stand-in for a raw `process.*.write`, beyond the chunk-only
 * `createWriteProbe`: it records each chunk's decoded text AND the encoding it was handed, and it
 * INVOKES the completion callback (in whichever Node overload position it arrives —
 * `write(chunk, cb)` or `write(chunk, encoding, cb)`). A `ProcessCapture` test installs it as the
 * current `process.stdout.write` / `process.stderr.write` BEFORE `start()` so the capture's
 * snapshot-original (and any mirror replay) lands here — proving the wrapper honors the encoding,
 * fires the callback, and propagates backpressure, the Node write-overload branching the
 * chunk-only probe cannot observe.
 *
 * @param backpressure - The boolean each `write` returns (default `true` — buffer not full).
 * @returns The `write` (assign it to a process stream), `texts` (each chunk decoded to a string, in
 *   order), `encodings` (the encoding argument recorded per call, `undefined` where the 2nd
 *   argument was the callback instead), and `callbacks` (the tally of completion callbacks
 *   invoked).
 */
export function createOverloadProbe(backpressure = true): {
	readonly write: NodeJS.WriteStream['write']
	readonly texts: readonly string[]
	readonly encodings: ReadonlyArray<string | undefined>
	readonly callbacks: number
} {
	const texts: string[] = []
	const encodings: Array<string | undefined> = []
	let callbacks = 0
	return {
		write(
			chunk: string | Uint8Array,
			encoding?: BufferEncoding | WriteCallback,
			callback?: WriteCallback,
		): boolean {
			texts.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
			// The 2nd arg is the encoding only when it is a string; a function there is the callback.
			encodings.push(typeof encoding === 'string' ? encoding : undefined)
			const done = typeof encoding === 'function' ? encoding : callback
			if (done !== undefined) {
				callbacks += 1
				done()
			}
			return backpressure
		},
		get texts() {
			return texts
		},
		get encodings() {
			return encodings
		},
		get callbacks() {
			return callbacks
		},
	}
}
