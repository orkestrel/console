import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger, createReporter, strip } from '@src/core'
import { createProcessCapture, createServerSink } from '@src/server'
import { createRecorder } from '../../setup.js'
import { createStreamTarget, createWriteProbe } from '../../setupServer.js'

// A styled line with a real SGR run, for the TTY-verbatim vs non-TTY-strip assertions.
const STYLED = '\x1b[31mred\x1b[0m'

describe('createServerSink — level routing', () => {
	it('routes error and warn to the err stream, everything else to out', () => {
		const out = createStreamTarget({ isTTY: true })
		const err = createStreamTarget({ isTTY: true })
		const sink = createServerSink({ out: out.target, err: err.target })

		sink.write('plain') // no level → out
		sink.write('an info', 'info')
		sink.write('a debug', 'debug')
		sink.write('an error', 'error')
		sink.write('a warning', 'warn')

		expect(out.writes.calls).toEqual([['plain\n'], ['an info\n'], ['a debug\n']])
		expect(err.writes.calls).toEqual([['an error\n'], ['a warning\n']])
	})
})

describe('createServerSink — isTTY-aware ANSI', () => {
	it('writes ANSI verbatim to a TTY (animations render natively), with one trailing newline appended', () => {
		const out = createStreamTarget({ isTTY: true })
		const sink = createServerSink({ out: out.target, err: createStreamTarget().target })
		sink.write(STYLED)
		expect(out.writes.calls).toEqual([[`${STYLED}\n`]])
	})

	it('preserves a leading carriage return on a TTY (live redraw) — no newline appended (framed)', () => {
		const out = createStreamTarget({ isTTY: true })
		const sink = createServerSink({ out: out.target, err: createStreamTarget().target })
		sink.write('\rframe')
		expect(out.writes.calls).toEqual([['\rframe']])
	})

	it('strips ANSI when the target is not a TTY (clean log file), newline appended before stripping', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({ out: out.target, err: createStreamTarget().target })
		sink.write(STYLED)
		expect(out.writes.calls).toEqual([[`${strip(STYLED)}\n`]])
		expect(out.writes.calls).toEqual([['red\n']])
	})

	it('decides per stream — err can strip while out renders (both newline-terminated)', () => {
		const out = createStreamTarget({ isTTY: true })
		const err = createStreamTarget({ isTTY: false })
		const sink = createServerSink({ out: out.target, err: err.target })
		sink.write(STYLED, 'info')
		sink.write(STYLED, 'error')
		expect(out.writes.calls).toEqual([[`${STYLED}\n`]]) // TTY → verbatim + newline
		expect(err.writes.calls).toEqual([['red\n']]) // non-TTY → stripped + newline
	})

	it('a \\r-prefixed redraw frame carries its own line endings — never gets a trailing newline appended', () => {
		const out = createStreamTarget({ isTTY: true })
		const sink = createServerSink({ out: out.target, err: createStreamTarget().target })
		sink.write('\r\x1b[2Kspinner frame')
		sink.write('\r\x1b[2Kanother frame')
		const first = ['\r\x1b[2Kspinner frame']
		const second = ['\r\x1b[2Kanother frame']
		expect(out.writes.calls).toEqual([first, second])
	})

	it('two consecutive line-oriented writes stay newline-separated, never concatenated', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({ out: out.target, err: createStreamTarget().target })
		sink.write('first')
		sink.write('second')
		expect(out.writes.calls).toEqual([['first\n'], ['second\n']])
	})
})

describe('createServerSink — C0 control stripping (non-TTY)', () => {
	it('strips C0 control codes (bell, null) while preserving tab/newline/carriage-return content', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({ out: out.target, err: createStreamTarget().target })
		sink.write('bell\x07null\x00tab\ttext')
		expect(out.writes.calls).toEqual([['bellnulltab\ttext\n']])
	})

	it('does NOT strip C0 controls on a TTY (verbatim + trailing newline)', () => {
		const out = createStreamTarget({ isTTY: true })
		const sink = createServerSink({ out: out.target, err: createStreamTarget().target })
		sink.write('bell\x07text')
		expect(out.writes.calls).toEqual([['bell\x07text\n']])
	})
})

describe('createServerSink — through Logger / Reporter (integration, F2 newline contract)', () => {
	it('a Logger write ends with exactly one trailing newline', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({ out: out.target, err: createStreamTarget().target })
		const logger = createLogger({ name: 'app', sink })
		logger.info('hello')
		expect(out.writes.calls).toHaveLength(1)
		const [[line]] = out.writes.calls
		expect(line?.endsWith('\n')).toBe(true)
		expect(line?.endsWith('\n\n')).toBe(false)
	})

	it('Reporter.blank() writes a real blank line (a bare newline)', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({ out: out.target, err: createStreamTarget().target })
		const reporter = createReporter({ sink })
		reporter.blank()
		expect(out.writes.calls).toEqual([['\n']])
	})

	it('two logger.info calls produce two newline-separated lines, not one concatenated write', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({ out: out.target, err: createStreamTarget().target })
		const logger = createLogger({ name: 'app', sink })
		logger.info('one')
		logger.info('two')
		expect(out.writes.calls).toHaveLength(2)
		const [[first], [second]] = out.writes.calls
		expect(first?.endsWith('\n')).toBe(true)
		expect(second?.endsWith('\n')).toBe(true)
	})
})

describe('createServerSink — columns', () => {
	it('reports the live out-stream width on a TTY', () => {
		const out = createStreamTarget({ isTTY: true, columns: 120 })
		const sink = createServerSink({ out: out.target, err: createStreamTarget().target })
		expect(sink.columns).toBe(120)
	})

	it('falls back to 80 when the out stream is not a TTY', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({ out: out.target, err: createStreamTarget().target })
		expect(sink.columns).toBe(80)
	})

	it('honors a fixed columns override regardless of the stream', () => {
		const out = createStreamTarget({ isTTY: true, columns: 120 })
		const sink = createServerSink({
			out: out.target,
			err: createStreamTarget().target,
			columns: 40,
		})
		expect(sink.columns).toBe(40)
	})

	it('tracks a terminal resize through the live getter', () => {
		let width = 100
		const target = {
			write: () => true,
			isTTY: true,
			get columns() {
				return width
			},
		}
		const sink = createServerSink({ out: target, err: createStreamTarget().target })
		expect(sink.columns).toBe(100)
		width = 200
		expect(sink.columns).toBe(200)
	})
})

describe('createServerSink — isTTY re-read per write (live)', () => {
	it('re-reads isTTY on every write — a stream flipping TTY-ness changes the strip decision mid-stream', () => {
		// The sink reads target.isTTY per write, so a stream that becomes non-TTY between writes (a
		// pipe attached mid-run) starts stripping — proven with a getter-backed live isTTY flag.
		const writes = createRecorder<readonly [text: string]>()
		let tty = true
		const target = {
			write: (text: string): boolean => {
				writes.handler(text)
				return true
			},
			get isTTY() {
				return tty
			},
		}
		const sink = createServerSink({ out: target, err: createStreamTarget().target })
		sink.write(STYLED) // TTY now → verbatim
		tty = false
		sink.write(STYLED) // non-TTY now → stripped
		expect(writes.calls).toEqual([[`${STYLED}\n`], ['red\n']])
	})

	it('strips when isTTY is absent on the target (a piped, non-terminal stream)', () => {
		// The source gates on `target.isTTY === true`; an absent isTTY (a bare write-only target) is
		// not strict-true, so ANSI is stripped — the non-terminal default.
		const writes = createRecorder<readonly [text: string]>()
		const out = { write: (text: string): boolean => (writes.handler(text), true) } // no isTTY
		const sink = createServerSink({ out, err: createStreamTarget().target })
		sink.write(STYLED)
		expect(writes.calls).toEqual([['red\n']]) // stripped (isTTY absent ⇒ not a TTY)
	})
})

// These tests prove the isStreamTarget(option) guard's DEFAULT branch: an OMITTED out / err falls
// back to the real process.stdout / process.stderr. They install a recording probe as the real
// stream write (snapshotting the pristine reference in beforeEach, restoring in afterEach), so the
// fallback write is OBSERVED (proving it reached the default stream) AND the suite stays output-clean
// — no escape codes or text leak into the vitest reporter. (A *malformed* injected target — a
// write-less / wrong-typed object — cannot be passed through the typed `out` / `err` option without a
// banned `as`; that guard branch is covered at the isStreamTarget unit level in helpers.test.ts.)
describe('createServerSink — default-stream fallback (the isStreamTarget(undefined) branch)', () => {
	const pristine = { stdout: process.stdout.write, stderr: process.stderr.write }
	let outProbe = createWriteProbe()
	let errProbe = createWriteProbe()
	beforeEach(() => {
		pristine.stdout = process.stdout.write
		pristine.stderr = process.stderr.write
		outProbe = createWriteProbe()
		errProbe = createWriteProbe()
		process.stdout.write = outProbe.write
		process.stderr.write = errProbe.write
	})
	afterEach(() => {
		process.stdout.write = pristine.stdout
		process.stderr.write = pristine.stderr
	})

	it('routes a non-error write to the real process.stdout when out is omitted', () => {
		// out omitted → isStreamTarget(undefined) false → process.stdout (the probe).
		const sink = createServerSink({ err: createStreamTarget().target })
		sink.write('to the default out')
		expect(outProbe.texts).toEqual(['to the default out\n'])
	})

	it('routes error / warn to the real process.stderr when err is omitted', () => {
		// err omitted → process.stderr (the probe); the injected out is honored separately.
		const out = createStreamTarget({ isTTY: true })
		const sink = createServerSink({ out: out.target })
		sink.write('boom', 'error')
		sink.write('careful', 'warn')
		expect(errProbe.texts).toEqual(['boom\n', 'careful\n'])
		expect(out.writes.calls).toEqual([]) // nothing leaked to the out side
	})

	it('falls back on BOTH sides when neither option is given (a bare createServerSink)', () => {
		const sink = createServerSink()
		sink.write('plain out')
		sink.write('an error', 'error')
		expect(outProbe.texts).toEqual(['plain out\n'])
		expect(errProbe.texts).toEqual(['an error\n'])
	})
})

describe('createServerSink — injected void-write target', () => {
	it('honors an injected target whose write returns void (no backpressure signal)', () => {
		// StreamTargetInterface.write may return void; the sink ignores the return on the write path,
		// so a void-returning fake is a fully valid, honored target.
		const seen: string[] = []
		const target = {
			write: (text: string): void => {
				seen.push(text)
			},
			isTTY: true,
		}
		const sink = createServerSink({ out: target, err: createStreamTarget().target })
		sink.write('void-write target')
		expect(seen).toEqual(['void-write target\n'])
	})
})

describe('createServerSink — level routing exhaustiveness', () => {
	it('routes only error and warn to err; info / debug / an omitted level go to out', () => {
		const out = createStreamTarget({ isTTY: true })
		const err = createStreamTarget({ isTTY: true })
		const sink = createServerSink({ out: out.target, err: err.target })
		sink.write('a', 'info')
		sink.write('b', 'debug')
		sink.write('c') // omitted level → out
		sink.write('e', 'error')
		sink.write('f', 'warn')
		expect(out.writes.calls).toEqual([['a\n'], ['b\n'], ['c\n']])
		expect(err.writes.calls).toEqual([['e\n'], ['f\n']])
	})
})

describe('createServerSink — frozen, stable surface', () => {
	it('returns a frozen sink (its write / columns surface cannot be swapped out)', () => {
		const sink = createServerSink({
			out: createStreamTarget().target,
			err: createStreamTarget().target,
		})
		expect(Object.isFrozen(sink)).toBe(true)
	})

	it('exposes a fixed columns override of 0-fallback semantics only when positive', () => {
		// A fixed columns override is returned verbatim — even a small/odd width — since it short-
		// circuits columnsOf entirely (the override is the consumer's explicit choice).
		const sink = createServerSink({
			out: createStreamTarget({ isTTY: false }).target,
			err: createStreamTarget().target,
			columns: 1,
		})
		expect(sink.columns).toBe(1)
	})
})

describe('createServerSink — defaults', () => {
	it('defaults to the process streams when no targets are injected', () => {
		// A bare sink targets process.stdout / process.stderr without throwing; columns is the live
		// process width or the 80 fallback (the isStreamTarget(undefined) → default path). We only
		// assert it constructs and reads a sane width.
		const sink = createServerSink()
		expect(typeof sink.columns).toBe('number')
		expect(sink.columns).toBeGreaterThan(0)
	})

	it('uses the default stream for a side whose option is undefined while honoring the other', () => {
		// `out` omitted → process.stdout; `err` injected → honored. We only drive the ERR route here
		// (so nothing reaches the real stdout and pollutes the reporter); the out-default path is
		// exercised by the width-read test above and the probed default-stream-fallback block.
		const err = createStreamTarget({ isTTY: true })
		const sink = createServerSink({ err: err.target })
		sink.write('to the fake err', 'error')
		expect(err.writes.calls).toEqual([['to the fake err\n']])
	})
})

describe('createProcessCapture — factory', () => {
	it('constructs an inactive, observable capture', () => {
		const capture = createProcessCapture()
		expect(capture.active).toBe(false)
		expect(capture.messages()).toEqual([])
		expect(typeof capture.emitter.on).toBe('function')
		capture.destroy()
	})
})
