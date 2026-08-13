// Base test setup — environment-agnostic helpers loaded first by every Vitest project
// (`setupFiles[0]`). Keep this file free of `node:*` and of `document` / `window`: node-only
// helpers live in `setupServer.ts`, DOM-only helpers live in `setupBrowser.ts`.

import type { LogLevel, SinkInterface } from '@src/core'
import type { EmitterInterface, EventMap } from '@orkestrel/emitter'
import type { RecorderInterface } from '@orkestrel/test'
import { createRecorder } from '@orkestrel/test'

/** A manually-settled promise — the `resolve` / `reject` lifted out of its executor. */
export interface TestGateInterface<T> {
	readonly promise: Promise<T>
	readonly resolve: (value: T) => void
	readonly reject: (error: unknown) => void
}

/**
 * Create a {@link TestGateInterface} — a deferred whose `promise` settles only when
 * the test calls `resolve` / `reject`. Lets a test gate a real handler on a signal it
 * controls, to prove ordering / concurrency / pause behaviour without racing wall-clock
 * timers (AGENTS §16.1).
 *
 * @typeParam T - The value the gate's `promise` resolves with
 * @returns A gate exposing its `promise` and its `resolve` / `reject`
 */
export function createGate<T = void>(): TestGateInterface<T> {
	let resolve: (value: T) => void = () => {}
	let reject: (error: unknown) => void = () => {}
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

/**
 * Create a recorder for an {@link import('@src/core').EmitterErrorHandler} — the emitter's
 * own listener-error channel (AGENTS §13): a `RecorderInterface<[error, event]>` whose
 * `handler` is wired as the `error` option, so an emit-safety test asserts a buggy listener's
 * throw was routed here (with the offending event name) instead of corrupting the entity.
 * Argument order is `(error, event)`, matching `EmitterErrorHandler`. A thin alias over
 * {@link createRecorder} (AGENTS §16.1 — extract-once over the per-entity emit-safety blocks).
 *
 * @returns A recorder of `[error: unknown, event: string]` calls
 */
export function createErrorRecorder(): RecorderInterface<readonly [error: unknown, event: string]> {
	return createRecorder<readonly [error: unknown, event: string]>()
}

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

/** A {@link createRecorder} per listed event of an `EmitterInterface`, keyed by event name. */
export type EmitterRecorders<TMap extends EventMap, TName extends keyof TMap> = {
	readonly [K in TName]: RecorderInterface<TMap[K]>
}

/**
 * Wire one {@link createRecorder} onto `emitter` for each of the named events — the
 * one generic form of the per-entity `recordXEvents` bundles (AGENTS §16.1). Each
 * recorder subscribes via `emitter.on(name, recorder.handler)` and is returned keyed
 * by its event name, typed with that event's argument tuple — so a test asserts what
 * fired (`events.write.calls`) and with which payload, exactly as the local bundles did.
 *
 * @typeParam TMap - The emitter's {@link EventMap}
 * @typeParam TName - The subset of event names to record (inferred from `events`)
 * @param emitter - The emitter to subscribe the recorders to
 * @param events - The event names to record (each becomes a key of the result)
 * @returns A recorder per name, each subscribed and keyed by event name
 */
export function recordEmitterEvents<TMap extends EventMap, TName extends keyof TMap>(
	emitter: EmitterInterface<TMap>,
	events: readonly TName[],
): EmitterRecorders<TMap, TName> {
	// Accumulate into a `Partial` of the exact mapped shape — every value keeps its
	// precise per-event tuple type (a recorder is invariant in its argument tuple, so a
	// widened record won't hold it), all keys optional until assigned. Each recorder is
	// created against its event's tuple, so `on(name, handler)` is precisely typed as it
	// is wired. The dynamic key list is the untyped edge: once every listed name is
	// present we narrow `Partial` → total through a guard, never an assertion (§14).
	const recorders: Partial<EmitterRecorders<TMap, TName>> = {}
	for (const name of events) {
		const recorder = createRecorder<TMap[typeof name]>()
		emitter.on(name, recorder.handler)
		recorders[name] = recorder
	}
	if (!isTotal(recorders, events)) {
		throw new Error('recordEmitterEvents: a recorder was not wired for every event')
	}
	return recorders
}

/**
 * Narrow an accumulated `Partial<EmitterRecorders>` to its total mapped form once every
 * listed event has a recorder present — the §14 guard standing in for an assertion in
 * {@link recordEmitterEvents} (whose loop assigns one recorder per name, so this holds;
 * the explicit per-name presence check keeps the narrowing a sound guard, not a cast).
 *
 * @typeParam TMap - The emitter's {@link EventMap}
 * @typeParam TName - The subset of event names that must each have a recorder
 * @param recorders - The partially-accumulated recorder map to narrow
 * @param events - The event names that must all be present for the map to be total
 * @returns Whether every listed event has a recorder (narrowing `recorders` to total)
 */
export function isTotal<TMap extends EventMap, TName extends keyof TMap>(
	recorders: Partial<EmitterRecorders<TMap, TName>>,
	events: readonly TName[],
): recorders is EmitterRecorders<TMap, TName> {
	return events.every((name) => recorders[name] !== undefined)
}

/** Whether a repository-relative Vue SFC path belongs to the private browser application. */
export function isBrowserVuePath(path: string): boolean {
	const normalized = path.replaceAll('\\', '/')
	return normalized.startsWith('app/browser/')
}
