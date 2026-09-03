import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Logger, Reporter, strip } from '@src/core'
import { createServerSink } from '@src/server'
import { createRecorder } from '@orkestrel/test'
import { createStreamTarget, createWriteProbe } from '../../setupServer.js'

// A styled line with a real SGR run, for the TTY-verbatim vs non-TTY-strip assertions.
const STYLED = '\x1b[31mred\x1b[0m'

describe('createServerSink — level routing', () => {
	it('routes error and warn to the stderr stream, everything else to stdout', () => {
		const out = createStreamTarget({ isTTY: true })
		const err = createStreamTarget({ isTTY: true })
		const sink = createServerSink({ stdout: out.target, stderr: err.target, styled: true })

		sink.write('plain') // no level → out
		sink.write('an info', 'info')
		sink.write('a debug', 'debug')
		sink.write('an error', 'error')
		sink.write('a warning', 'warn')

		expect(out.writes.calls).toEqual([['plain\n'], ['an info\n'], ['a debug\n']])
		expect(err.writes.calls).toEqual([['an error\n'], ['a warning\n']])
	})
})

describe('createServerSink — construction-time styled facts', () => {
	it('infers styling independently for a TTY `stdout` target and a piped `stderr` target', () => {
		const out = createStreamTarget({ isTTY: true })
		const err = createStreamTarget({ isTTY: false })
		const sink = createServerSink({ stdout: out.target, stderr: err.target, environment: {} })
		sink.write(STYLED, 'info')
		sink.write(STYLED, 'error')
		expect(sink.styled).toBe(true)
		expect(out.writes.calls).toEqual([[`${STYLED}\n`]])
		expect(err.writes.calls).toEqual([['red\n']])
	})

	it('uses the injected environment for construction-time inference', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget({ isTTY: false }).target,
			environment: { FORCE_COLOR: '1' },
		})
		sink.write(STYLED)
		expect(sink.styled).toBe(true)
		expect(out.writes.calls).toEqual([[`${STYLED}\n`]])
	})

	it('writes ANSI verbatim when styled is true, with one trailing newline appended', () => {
		const out = createStreamTarget({ isTTY: true })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: true,
		})
		expect(sink.styled).toBe(true)
		sink.write(STYLED)
		expect(out.writes.calls).toEqual([[`${STYLED}\n`]])
	})

	it('preserves a leading carriage return when styled is true — no newline appended', () => {
		const out = createStreamTarget({ isTTY: true })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: true,
		})
		sink.write('\rframe')
		expect(out.writes.calls).toEqual([['\rframe']])
	})

	it('strips ANSI when styled is false, with the newline appended before stripping', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: false,
		})
		expect(sink.styled).toBe(false)
		sink.write(STYLED)
		expect(out.writes.calls).toEqual([[`${strip(STYLED)}\n`]])
		expect(out.writes.calls).toEqual([['red\n']])
	})

	it('applies styled:false to stdout and stderr even when one target is a TTY', () => {
		const out = createStreamTarget({ isTTY: true })
		const err = createStreamTarget({ isTTY: false })
		const sink = createServerSink({ stdout: out.target, stderr: err.target, styled: false })
		sink.write(STYLED, 'info')
		sink.write(STYLED, 'error')
		expect(sink.styled).toBe(false)
		expect(out.writes.calls).toEqual([['red\n']])
		expect(err.writes.calls).toEqual([['red\n']])
	})

	it('applies styled:true to stdout and stderr even when neither target is a TTY', () => {
		const out = createStreamTarget({ isTTY: false })
		const err = createStreamTarget({ isTTY: false })
		const sink = createServerSink({ stdout: out.target, stderr: err.target, styled: true })
		sink.write(STYLED, 'info')
		sink.write(STYLED, 'error')
		expect(sink.styled).toBe(true)
		expect(out.writes.calls).toEqual([[`${STYLED}\n`]])
		expect(err.writes.calls).toEqual([[`${STYLED}\n`]])
	})

	it('a \\r-prefixed redraw frame carries its own line endings — never gets a trailing newline appended', () => {
		const out = createStreamTarget({ isTTY: true })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: true,
		})
		sink.write('\r\x1b[2Kspinner frame')
		sink.write('\r\x1b[2Kanother frame')
		const first = ['\r\x1b[2Kspinner frame']
		const second = ['\r\x1b[2Kanother frame']
		expect(out.writes.calls).toEqual([first, second])
	})

	it('two consecutive line-oriented writes stay newline-separated, never concatenated', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: false,
		})
		sink.write('first')
		sink.write('second')
		expect(out.writes.calls).toEqual([['first\n'], ['second\n']])
	})
})

describe('createServerSink — C0 control stripping', () => {
	it('strips C0 control codes (bell, null) while preserving tab/newline/carriage-return content', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: false,
		})
		sink.write('bell\x07null\x00tab\ttext')
		expect(out.writes.calls).toEqual([['bellnulltab\ttext\n']])
	})

	it('does not strip C0 controls when styled is true', () => {
		const out = createStreamTarget({ isTTY: true })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: true,
		})
		sink.write('bell\x07text')
		expect(out.writes.calls).toEqual([['bell\x07text\n']])
	})
})

describe('createServerSink — through Logger / Reporter (integration, F2 newline contract)', () => {
	it('a Logger write ends with exactly one trailing newline', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: false,
		})
		const logger = new Logger({ name: 'app', sink })
		logger.info('hello')
		expect(out.writes.calls).toHaveLength(1)
		const call = out.writes.calls[0]
		if (call === undefined) throw new Error('Expected the logger to write one line')
		const [line] = call
		expect(line.endsWith('\n')).toBe(true)
		expect(line.endsWith('\n\n')).toBe(false)
	})

	it('Reporter.blank() writes a real blank line (a bare newline)', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: false,
		})
		const reporter = new Reporter({ sink })
		reporter.blank()
		expect(out.writes.calls).toEqual([['\n']])
	})

	it('two logger.info calls produce two newline-separated lines, not one concatenated write', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: false,
		})
		const logger = new Logger({ name: 'app', sink })
		logger.info('one')
		logger.info('two')
		expect(out.writes.calls).toHaveLength(2)
		const firstCall = out.writes.calls[0]
		const secondCall = out.writes.calls[1]
		if (firstCall === undefined || secondCall === undefined) {
			throw new Error('Expected the logger to write two lines')
		}
		const [first] = firstCall
		const [second] = secondCall
		expect(first.endsWith('\n')).toBe(true)
		expect(second.endsWith('\n')).toBe(true)
	})
})

describe('createServerSink — columns', () => {
	it('reports the live stdout-stream width on a TTY', () => {
		const out = createStreamTarget({ isTTY: true, columns: 120 })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: false,
		})
		expect(sink.columns).toBe(120)
	})

	it('falls back to 80 when the `stdout` stream is not a TTY', () => {
		const out = createStreamTarget({ isTTY: false })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: false,
		})
		expect(sink.columns).toBe(80)
	})

	it('honors a fixed columns override regardless of the stream', () => {
		const out = createStreamTarget({ isTTY: true, columns: 120 })
		const sink = createServerSink({
			stdout: out.target,
			stderr: createStreamTarget().target,
			styled: false,
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
		const sink = createServerSink({
			stdout: target,
			stderr: createStreamTarget().target,
			styled: false,
		})
		expect(sink.columns).toBe(100)
		width = 200
		expect(sink.columns).toBe(200)
	})
})

describe('createServerSink — stable construction facts', () => {
	it('keeps the explicit styled fact when target isTTY changes after construction', () => {
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
		const sink = createServerSink({
			stdout: target,
			stderr: createStreamTarget().target,
			styled: true,
		})
		sink.write(STYLED)
		tty = false
		sink.write(STYLED)
		expect(sink.styled).toBe(true)
		expect(writes.calls).toEqual([[`${STYLED}\n`], [`${STYLED}\n`]])
	})

	it('styled:false strips a write-only target with no isTTY fact', () => {
		const writes = createRecorder<readonly [text: string]>()
		const out = { write: (text: string): boolean => (writes.handler(text), true) } // no isTTY
		const sink = createServerSink({
			stdout: out,
			stderr: createStreamTarget().target,
			styled: false,
		})
		sink.write(STYLED)
		expect(writes.calls).toEqual([['red\n']]) // explicit styled:false strips without a TTY fact
	})
})

// These tests prove the isStreamTarget(option) guard's DEFAULT branch: an OMITTED stdout / stderr falls
// back to the real process.stdout / process.stderr. They install a recording probe as the real
// stream write (snapshotting the pristine reference in beforeEach, restoring in afterEach), so the
// fallback write is OBSERVED (proving it reached the default stream) AND the suite stays output-clean
// — no escape codes or text leak into the vitest reporter. (A *malformed* injected target — a
// write-less / wrong-typed object — cannot be passed through the typed `stdout` / `stderr` option without a
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

	it('routes a non-error write to the real process.stdout when stdout is omitted', () => {
		// stdout omitted → isStreamTarget(undefined) false → process.stdout (the probe).
		const sink = createServerSink({ stderr: createStreamTarget().target, styled: false })
		sink.write('to the default out')
		expect(outProbe.texts).toEqual(['to the default out\n'])
	})

	it('routes error / warn to the real process.stderr when stderr is omitted', () => {
		// stderr omitted → process.stderr (the probe); the injected stdout is honored separately.
		const out = createStreamTarget({ isTTY: true })
		const sink = createServerSink({ stdout: out.target, styled: false })
		sink.write('boom', 'error')
		sink.write('careful', 'warn')
		expect(errProbe.texts).toEqual(['boom\n', 'careful\n'])
		expect(out.writes.calls).toEqual([]) // nothing leaked to the out side
	})

	it('falls back on both targets when neither stream option is given', () => {
		const sink = createServerSink({ styled: false })
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
		const sink = createServerSink({
			stdout: target,
			stderr: createStreamTarget().target,
			styled: true,
		})
		sink.write('void-write target')
		expect(seen).toEqual(['void-write target\n'])
	})
})

describe('createServerSink — level routing exhaustiveness', () => {
	it('routes only error and warn to stderr; info / debug / an omitted level go to stdout', () => {
		const out = createStreamTarget({ isTTY: true })
		const err = createStreamTarget({ isTTY: true })
		const sink = createServerSink({ stdout: out.target, stderr: err.target, styled: true })
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
			stdout: createStreamTarget().target,
			stderr: createStreamTarget().target,
			styled: false,
		})
		expect(Object.isFrozen(sink)).toBe(true)
	})

	it('exposes a fixed columns override of 0-fallback semantics only when positive', () => {
		// A fixed columns override is returned verbatim — even a small/odd width — since it short-
		// circuits inferColumns entirely (the override is the consumer's explicit choice).
		const sink = createServerSink({
			stdout: createStreamTarget({ isTTY: false }).target,
			stderr: createStreamTarget().target,
			styled: false,
			columns: 1,
		})
		expect(sink.columns).toBe(1)
	})
})

describe('createServerSink — defaults', () => {
	it('defaults to the process streams when no targets are injected', () => {
		// A sink with no target options uses process.stdout / process.stderr; columns is the live
		// process width or the 80 fallback (the isStreamTarget(undefined) → default path). We only
		// assert it constructs and reads a sane width.
		const sink = createServerSink({ styled: false })
		expect(typeof sink.columns).toBe('number')
		expect(sink.columns).toBeGreaterThan(0)
	})

	it('uses the default stream for a side whose option is undefined while honoring the other', () => {
		// `stdout` omitted → process.stdout; `stderr` injected → honored. We only drive the error route
		// here (so nothing reaches the real stdout and pollutes the reporter); the default path is
		// exercised by the width-read test above and the probed default-stream-fallback block.
		const err = createStreamTarget({ isTTY: true })
		const sink = createServerSink({ stderr: err.target, styled: true })
		sink.write('to the fake err', 'error')
		expect(err.writes.calls).toEqual([['to the fake err\n']])
	})
})
