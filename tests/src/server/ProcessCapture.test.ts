import type { SinkInterface } from '@src/core'
import { createProcessCapture } from '@src/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRecorder, recordEmitterEvents } from '../../../setup.js'
import { createWriteProbe } from '../../../setupServer.js'

// The completion-callback shape a Node `process.*.write` accepts as its last argument.
type WriteCallback = (error?: Error | null) => void

// An OVERLOAD-AWARE recording stand-in for a raw `process.*.write`, beyond the chunk-only
// `createWriteProbe`: it records each chunk's decoded text AND the encoding it was handed, and it
// INVOKES the completion callback (in whichever Node overload position it arrives —
// `write(chunk, cb)` or `write(chunk, encoding, cb)`). The ProcessCapture mirror forwards the live
// stream write to this snapshot-original, so installing it as the current `process.stdout.write`
// BEFORE `start()` lets a test prove the wrapper honors the encoding, fires the callback, and
// propagates backpressure — the Node write-overload branching the chunk-only probe can't observe.
// Kept LOCAL to this file (it exercises this module's patch mechanism specifically); see the report
// note on generalizing `createWriteProbe` in setupServer if a sibling suite needs the same.
interface OverloadProbeInterface {
	readonly write: NodeJS.WriteStream['write']
	readonly texts: readonly string[]
	readonly encodings: readonly (string | undefined)[]
	readonly callbacks: number
}

function createOverloadProbe(backpressure = true): OverloadProbeInterface {
	const texts: string[] = []
	const encodings: (string | undefined)[] = []
	let callbacks = 0
	const write = (
		chunk: string | Uint8Array,
		encoding?: BufferEncoding | WriteCallback,
		callback?: WriteCallback,
	): boolean => {
		texts.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
		// The 2nd arg is the encoding only when it is a string; a function there is the callback.
		encodings.push(typeof encoding === 'string' ? encoding : undefined)
		const done = typeof encoding === 'function' ? encoding : callback
		if (done !== undefined) {
			callbacks += 1
			done()
		}
		return backpressure
	}
	return {
		write,
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

// The C-g process-stream capture (`src/server/console/ProcessCapture.ts`), exercised against the
// REAL `process.stdout` / `process.stderr`. The pristine `write` of each stream is snapshotted in
// `beforeEach` and restored in `afterEach` so NO patch leaks out of a test (a leaked stream patch
// would corrupt the whole run). Inside a test we first install a `createWriteProbe` as the CURRENT
// stream write, so the capture's snapshot-original (and any mirror replay) lands in the probe — the
// suite stays output-clean and the mirror assertion is deterministic.

const pristine = { stdout: process.stdout.write, stderr: process.stderr.write }

beforeEach(() => {
	pristine.stdout = process.stdout.write
	pristine.stderr = process.stderr.write
})

afterEach(() => {
	// Restore the EXACT pristine references — guarantees no wrapper survives a test.
	process.stdout.write = pristine.stdout
	process.stderr.write = pristine.stderr
})

describe('ProcessCapture — start / stop patch + restore', () => {
	it('swaps process.*.write on start and restores the exact reference on stop', () => {
		const probe = createWriteProbe()
		process.stdout.write = probe.write
		const before = process.stdout.write

		const capture = createProcessCapture({ levels: ['stdout'] })
		capture.start()
		expect(process.stdout.write).not.toBe(before) // a wrapper is installed
		expect(capture.active).toBe(true)

		capture.stop()
		expect(process.stdout.write).toBe(before) // the PRISTINE probe reference is back
		expect(capture.active).toBe(false)
		capture.destroy()
	})

	it('start is idempotent — a second start does not re-patch (restore stays sound)', () => {
		const probe = createWriteProbe()
		process.stdout.write = probe.write
		const original = process.stdout.write

		const capture = createProcessCapture({ levels: ['stdout'] })
		capture.start()
		const wrapper = process.stdout.write
		capture.start() // no-op — must NOT snapshot the wrapper as the new original
		expect(process.stdout.write).toBe(wrapper)

		capture.stop()
		expect(process.stdout.write).toBe(original) // still restores the pristine reference
		capture.destroy()
	})

	it('stop while inactive is a no-op', () => {
		const capture = createProcessCapture({ levels: ['stdout'] })
		expect(() => capture.stop()).not.toThrow()
		expect(capture.active).toBe(false)
		capture.destroy()
	})
})

describe('ProcessCapture — interception', () => {
	it('captures writes per stream as frozen, time-stamped chunks', () => {
		process.stdout.write = createWriteProbe().write
		process.stderr.write = createWriteProbe().write
		const capture = createProcessCapture()
		capture.start()

		process.stdout.write('out line\n')
		process.stderr.write('err line\n')
		capture.stop()

		const all = capture.messages()
		expect(all.map((message) => [message.level, message.text])).toEqual([
			['stdout', 'out line\n'],
			['stderr', 'err line\n'],
		])
		expect(typeof all[0]?.time).toBe('number')
		expect(Object.isFrozen(all[0])).toBe(true)
		capture.destroy()
	})

	it('buckets by stream via byLevel', () => {
		process.stdout.write = createWriteProbe().write
		process.stderr.write = createWriteProbe().write
		const capture = createProcessCapture()
		capture.start()
		process.stdout.write('a')
		process.stdout.write('b')
		process.stderr.write('c')
		capture.stop()

		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['a', 'b'])
		expect(capture.byLevel('stderr').map((message) => message.text)).toEqual(['c'])
		capture.destroy()
	})

	it('decodes a Buffer chunk to text', () => {
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'] })
		capture.start()
		process.stdout.write(Buffer.from('buffered', 'utf8'))
		capture.stop()
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['buffered'])
		capture.destroy()
	})

	it('only patches the configured streams', () => {
		const errProbe = createWriteProbe()
		process.stdout.write = createWriteProbe().write
		process.stderr.write = errProbe.write
		const errBefore = process.stderr.write

		const capture = createProcessCapture({ levels: ['stdout'] })
		capture.start()
		expect(process.stderr.write).toBe(errBefore) // stderr untouched
		process.stderr.write('not captured\n')
		capture.stop()

		expect(capture.byLevel('stderr')).toEqual([])
		expect(errProbe.texts).toEqual(['not captured\n']) // it went straight to the stream
		capture.destroy()
	})

	it('emits start, capture, and stop on the emitter', () => {
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'] })
		const events = recordEmitterEvents(capture.emitter, ['start', 'capture', 'stop'])

		capture.start()
		process.stdout.write('x')
		capture.stop()

		expect(events.start.count).toBe(1)
		expect(events.stop.count).toBe(1)
		expect(events.capture.count).toBe(1)
		expect(events.capture.calls[0]?.[0]?.text).toBe('x')
		capture.destroy()
	})
})

describe('ProcessCapture — mirror + backpressure', () => {
	it('capture-only swallows output (no replay) and returns true', () => {
		const probe = createWriteProbe()
		process.stdout.write = probe.write
		const capture = createProcessCapture({ levels: ['stdout'], mirror: false })
		capture.start()

		const result = process.stdout.write('swallowed')
		capture.stop()

		expect(probe.texts).toEqual([]) // nothing reached the real stream
		expect(result).toBe(true) // buffer never fills when swallowing
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['swallowed'])
		capture.destroy()
	})

	it('mirror replays to the snapshot-original stream', () => {
		const probe = createWriteProbe()
		process.stdout.write = probe.write
		const capture = createProcessCapture({ levels: ['stdout'], mirror: true })
		capture.start()
		process.stdout.write('shown')
		capture.stop()

		expect(probe.texts).toEqual(['shown']) // the output still reached the stream
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['shown'])
		capture.destroy()
	})

	it('passes through the original backpressure boolean when mirroring', () => {
		process.stdout.write = createWriteProbe(false).write // stream signals "buffer full"
		const capture = createProcessCapture({ levels: ['stdout'], mirror: true })
		capture.start()
		const result = process.stdout.write('data')
		capture.stop()
		expect(result).toBe(false) // the original's false is propagated, not masked
		capture.destroy()
	})
})

describe('ProcessCapture — Node write-overload branching (encoding / callback / backpressure)', () => {
	it('write(chunk, callback): fires the callback and mirrors, with no encoding consumed', () => {
		const probe = createOverloadProbe()
		process.stdout.write = probe.write
		const capture = createProcessCapture({ levels: ['stdout'], mirror: true })
		capture.start()
		let fired = false
		const result = process.stdout.write('payload', () => {
			fired = true
		})
		capture.stop()
		expect(fired).toBe(true) // the caller's completion callback still fired through the mirror
		expect(probe.callbacks).toBe(1)
		expect(probe.encodings).toEqual([undefined]) // 2nd arg was the callback, not an encoding
		expect(probe.texts).toEqual(['payload']) // mirrored to the real stream
		expect(result).toBe(true)
		capture.destroy()
	})

	it('write(chunk, encoding, callback): honors the encoding AND fires the callback', () => {
		const probe = createOverloadProbe()
		process.stdout.write = probe.write
		const capture = createProcessCapture({ levels: ['stdout'], mirror: true })
		capture.start()
		let fired = false
		// A latin1 buffer (0xe9 = 'é') with an explicit encoding + a completion callback.
		process.stdout.write(Buffer.from([0xe9]), 'latin1', () => {
			fired = true
		})
		capture.stop()
		// The CAPTURED text decoded with the honored latin1 encoding.
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['é'])
		// The encoding was forwarded to the mirror, and the callback fired.
		expect(probe.encodings).toEqual(['latin1'])
		expect(fired).toBe(true)
		expect(probe.callbacks).toBe(1)
		capture.destroy()
	})

	it('decodes a Buffer with the supplied encoding even when capture-only (no mirror)', () => {
		// The decode honors encoding regardless of mirroring — capture-only still records 'é'.
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'], mirror: false })
		capture.start()
		process.stdout.write(Buffer.from([0xe9]), 'latin1')
		capture.stop()
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['é'])
		capture.destroy()
	})

	it('propagates backpressure false through the encoding+callback overload', () => {
		const probe = createOverloadProbe(false) // stream signals "buffer full"
		process.stdout.write = probe.write
		const capture = createProcessCapture({ levels: ['stdout'], mirror: true })
		capture.start()
		const result = process.stdout.write(Buffer.from('x'), 'utf8', () => {})
		capture.stop()
		expect(result).toBe(false) // the original's false is propagated through the 3-arg overload
		expect(probe.callbacks).toBe(1)
		capture.destroy()
	})

	it('capture-only does NOT invoke the caller completion callback (output is swallowed)', () => {
		// In mirror:false the wrapper returns true immediately and never reaches the real write, so a
		// completion callback is intentionally dropped — the documented "swallowed into the buffer"
		// behavior. (A caller that needs flush-completion enables mirror.) Regression-pins the contract.
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'], mirror: false })
		capture.start()
		let fired = false
		const result = process.stdout.write('swallowed', () => {
			fired = true
		})
		capture.stop()
		expect(fired).toBe(false) // not called — capture-only never reaches the real write
		expect(result).toBe(true)
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['swallowed'])
		capture.destroy()
	})

	it('a callback positioned as the encoding arg is ignored for decode (utf-8 default)', () => {
		// write(chunk, cb): the 2nd arg is a function, so decodeChunk gets a function as "encoding" →
		// isBufferEncoding false → utf-8. A buffer thus decodes utf-8, not via the (absent) encoding.
		process.stdout.write = createOverloadProbe().write
		const capture = createProcessCapture({ levels: ['stdout'], mirror: true })
		capture.start()
		process.stdout.write(Buffer.from('hi'), () => {})
		capture.stop()
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['hi'])
		capture.destroy()
	})
})

describe('ProcessCapture — never throws', () => {
	it('a throwing capture listener cannot escape into the stream write', () => {
		process.stdout.write = createWriteProbe().write
		const errors = createRecorder<readonly [error: unknown, event: string]>()
		const capture = createProcessCapture({
			levels: ['stdout'],
			error: errors.handler,
			on: {
				capture: () => {
					throw new Error('listener boom')
				},
			},
		})
		capture.start()
		// The host write must not throw — the emitter isolates the listener throw.
		expect(() => process.stdout.write('safe')).not.toThrow()
		capture.stop()
		expect(errors.count).toBe(1) // the throw was routed to the emitter error handler
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['safe'])
		capture.destroy()
	})
})

describe('ProcessCapture — bounded buffers', () => {
	it('caps the total and per-stream buffers at limit, dropping the oldest', () => {
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'], limit: 3 })
		capture.start()
		for (const text of ['1', '2', '3', '4', '5']) process.stdout.write(text)
		capture.stop()

		// Only the 3 most recent survive, oldest-first.
		expect(capture.messages().map((message) => message.text)).toEqual(['3', '4', '5'])
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['3', '4', '5'])
		capture.destroy()
	})

	it('retains EXACTLY limit at the cap (nothing dropped at the boundary)', () => {
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'], limit: 3 })
		capture.start()
		for (const text of ['1', '2', '3']) process.stdout.write(text) // exactly at the cap
		capture.stop()
		expect(capture.messages().map((message) => message.text)).toEqual(['1', '2', '3'])
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['1', '2', '3'])
		capture.destroy()
	})

	it('drops exactly the oldest when ONE over the cap (total + bucket together)', () => {
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'], limit: 2 })
		capture.start()
		for (const text of ['a', 'b', 'c']) process.stdout.write(text) // one over → 'a' evicted
		capture.stop()
		expect(capture.messages().map((message) => message.text)).toEqual(['b', 'c'])
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['b', 'c'])
		capture.destroy()
	})

	it('bounds the TOTAL buffer across streams while each per-stream bucket is bounded independently', () => {
		// limit applies to the total AND each bucket. Interleave both streams under limit 2: the total
		// keeps the last 2 overall, while each bucket keeps the last 2 of ITS stream.
		process.stdout.write = createWriteProbe().write
		process.stderr.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout', 'stderr'], limit: 2 })
		capture.start()
		process.stdout.write('o1')
		process.stderr.write('e1')
		process.stdout.write('o2')
		process.stderr.write('e2')
		process.stdout.write('o3') // bucket stdout now [o2, o3]; total now [e2, o3]
		capture.stop()
		expect(capture.messages().map((message) => message.text)).toEqual(['e2', 'o3']) // last 2 overall
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['o2', 'o3'])
		expect(capture.byLevel('stderr').map((message) => message.text)).toEqual(['e1', 'e2'])
		capture.destroy()
	})
})

describe('ProcessCapture — accessor copies + byLevel edges', () => {
	it('messages() and byLevel() return fresh copies — mutating them cannot corrupt the buffers', () => {
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'] })
		capture.start()
		process.stdout.write('x')
		capture.stop()
		const all = capture.messages()
		const bucket = capture.byLevel('stdout')
		// A returned snapshot is a copy; clearing the local arrays must not touch the internal buffers.
		expect(() => {
			const a = [...all]
			a.length = 0
			const b = [...bucket]
			b.length = 0
		}).not.toThrow()
		expect(capture.messages()).toHaveLength(1)
		expect(capture.byLevel('stdout')).toHaveLength(1)
		capture.destroy()
	})

	it('byLevel for an unconfigured stream is an empty list (no bucket)', () => {
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'] }) // stderr not configured
		capture.start()
		process.stdout.write('only stdout')
		capture.stop()
		expect(capture.byLevel('stderr')).toEqual([]) // no bucket → empty copy, never undefined
		capture.destroy()
	})

	it('byLevel for a configured-but-unwritten stream is an empty list', () => {
		process.stdout.write = createWriteProbe().write
		process.stderr.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout', 'stderr'] })
		capture.start()
		process.stdout.write('a')
		capture.stop()
		expect(capture.byLevel('stderr')).toEqual([]) // configured, nothing written → empty
		capture.destroy()
	})
})

describe('ProcessCapture — sink forward', () => {
	it('forwards each chunk to a sink with the stream mapped to a log level', () => {
		process.stdout.write = createWriteProbe().write
		process.stderr.write = createWriteProbe().write
		const writes = createRecorder<readonly [text: string, level: string | undefined]>()
		const sink: SinkInterface = { write: (text, level) => writes.handler(text, level) }
		const capture = createProcessCapture({ sink })
		capture.start()
		process.stdout.write('out')
		process.stderr.write('err')
		capture.stop()

		// stdout → info, stderr → error (STREAM_LEVEL_MAP).
		expect(writes.calls).toEqual([
			['out', 'info'],
			['err', 'error'],
		])
		capture.destroy()
	})

	it('fans out to mirror AND sink together (buffered, replayed, forwarded)', () => {
		const probe = createWriteProbe()
		process.stderr.write = probe.write
		const writes = createRecorder<readonly [text: string, level: string | undefined]>()
		const sink: SinkInterface = { write: (text, level) => writes.handler(text, level) }
		const capture = createProcessCapture({ levels: ['stderr'], mirror: true, sink })
		capture.start()
		process.stderr.write('boom')
		capture.stop()
		expect(probe.texts).toEqual(['boom']) // mirrored to the real stream
		expect(writes.calls).toEqual([['boom', 'error']]) // forwarded to the sink (stderr → error)
		expect(capture.byLevel('stderr').map((message) => message.text)).toEqual(['boom']) // buffered
		capture.destroy()
	})

	it('a level subset forwards only that stream to the sink', () => {
		// With levels: ['stderr'] only, a stdout write is never intercepted, so it never reaches sink.
		const errProbe = createWriteProbe()
		process.stdout.write = createWriteProbe().write
		process.stderr.write = errProbe.write
		const writes = createRecorder<readonly [text: string, level: string | undefined]>()
		const sink: SinkInterface = { write: (text, level) => writes.handler(text, level) }
		const capture = createProcessCapture({ levels: ['stderr'], sink })
		capture.start()
		process.stdout.write('not intercepted') // stdout not configured → straight to the stream
		process.stderr.write('diagnostic')
		capture.stop()
		expect(writes.calls).toEqual([['diagnostic', 'error']]) // only the stderr chunk forwarded
		capture.destroy()
	})
})

describe('ProcessCapture — clear + destroy', () => {
	it('clear empties the buffers but leaves interception active', () => {
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'] })
		capture.start()
		process.stdout.write('one')
		capture.clear()
		expect(capture.messages()).toEqual([])
		expect(capture.active).toBe(true)
		process.stdout.write('two')
		expect(capture.byLevel('stdout').map((message) => message.text)).toEqual(['two'])
		capture.stop()
		capture.destroy()
	})

	it('clear empties BOTH the total buffer and every per-stream bucket', () => {
		process.stdout.write = createWriteProbe().write
		process.stderr.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout', 'stderr'] })
		capture.start()
		process.stdout.write('o')
		process.stderr.write('e')
		capture.clear()
		expect(capture.messages()).toEqual([])
		expect(capture.byLevel('stdout')).toEqual([])
		expect(capture.byLevel('stderr')).toEqual([])
		capture.stop()
		capture.destroy()
	})

	it('clear while inactive empties the buffers and leaves active false', () => {
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'] })
		capture.start()
		process.stdout.write('x')
		capture.stop()
		expect(capture.messages()).toHaveLength(1)
		capture.clear()
		expect(capture.messages()).toEqual([])
		expect(capture.active).toBe(false)
		capture.destroy()
	})

	it('destroy restores the stream and tears down', () => {
		const probe = createWriteProbe()
		process.stdout.write = probe.write
		const original = process.stdout.write
		const capture = createProcessCapture({ levels: ['stdout'] })
		capture.start()
		capture.destroy()
		expect(process.stdout.write).toBe(original) // restored on destroy
		expect(capture.active).toBe(false)
	})

	it('destroy also destroys the emitter', () => {
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'] })
		capture.start()
		capture.destroy()
		expect(capture.emitter.destroyed).toBe(true)
	})

	it('is idempotent — a second destroy() does not throw and the stream stays restored', () => {
		const probe = createWriteProbe()
		process.stdout.write = probe.write
		const original = process.stdout.write
		const capture = createProcessCapture({ levels: ['stdout'] })
		capture.start()
		capture.destroy()
		expect(() => capture.destroy()).not.toThrow()
		expect(process.stdout.write).toBe(original)
		expect(capture.active).toBe(false)
	})

	it('destroy on a never-started capture is a safe no-op', () => {
		const capture = createProcessCapture({ levels: ['stdout'] })
		expect(() => capture.destroy()).not.toThrow()
		expect(capture.active).toBe(false)
		expect(capture.emitter.destroyed).toBe(true)
	})
})

describe('ProcessCapture — restart cycles', () => {
	it('survives a stop → start cycle, re-snapshotting the (still pristine) write each time', () => {
		const probe = createWriteProbe()
		process.stdout.write = probe.write
		const original = process.stdout.write
		const capture = createProcessCapture({ levels: ['stdout'] })

		capture.start()
		process.stdout.write('first')
		capture.stop()
		expect(process.stdout.write).toBe(original) // pristine restored after the first cycle

		capture.start() // re-snapshots the pristine reference, installs a fresh wrapper
		expect(process.stdout.write).not.toBe(original)
		process.stdout.write('second')
		capture.stop()
		expect(process.stdout.write).toBe(original) // restored again

		// Both cycles' captures accumulated in the buffer (clear was never called).
		expect(capture.messages().map((message) => message.text)).toEqual(['first', 'second'])
		capture.destroy()
	})

	it('does not intercept after stop — a later write passes straight through to the stream', () => {
		const probe = createWriteProbe()
		process.stdout.write = probe.write
		const capture = createProcessCapture({ levels: ['stdout'] })
		capture.start()
		process.stdout.write('during')
		capture.stop()
		process.stdout.write('after') // restored original — not captured, lands on the stream
		expect(capture.messages().map((message) => message.text)).toEqual(['during'])
		expect(probe.texts).toEqual(['after']) // only the post-stop write reached the probe
		capture.destroy()
	})
})

describe('ProcessCapture — emitter hooks at construction', () => {
	it('wires initial on-hooks at construction (a capture listener fires)', () => {
		process.stdout.write = createWriteProbe().write
		const seen: string[] = []
		const capture = createProcessCapture({
			levels: ['stdout'],
			on: { capture: (chunk) => seen.push(chunk.text) },
		})
		capture.start()
		process.stdout.write('hooked')
		capture.stop()
		expect(seen).toEqual(['hooked'])
		capture.destroy()
	})

	it('start/stop are emitted once each despite idempotent repeat calls', () => {
		process.stdout.write = createWriteProbe().write
		const capture = createProcessCapture({ levels: ['stdout'] })
		const events = recordEmitterEvents(capture.emitter, ['start', 'stop'])
		capture.start()
		capture.start() // idempotent — no second start event
		capture.stop()
		capture.stop() // no-op — no second stop event
		expect(events.start.count).toBe(1)
		expect(events.stop.count).toBe(1)
		capture.destroy()
	})
})
