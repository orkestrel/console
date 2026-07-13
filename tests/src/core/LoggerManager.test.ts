import type { LogLevel } from '@src/core'
import { createLoggerManager, createStyler, LoggerManager } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createRecordingSink } from '../../../setup.js'

// LoggerManager — the event-free §9 registry of named loggers + a convenience fan-out. It
// mints + stores loggers keyed by name (its defaults flowing in unless overridden), looks
// them up, removes them (the 3-overload §9.2), and broadcasts a one-off log to every logger.
// It carries NO emitter — observability is per-logger. Tests use a recording sink + a plain
// styler so every logger's output is captured deterministically.

// A manager whose loggers share one recording sink + a disabled styler — so a fan-out's
// writes are all visible in one place and lines are plain text.
function createTestManager(level: LogLevel = 'debug'): {
	manager: LoggerManager
	sink: ReturnType<typeof createRecordingSink>
} {
	const sink = createRecordingSink()
	const manager = new LoggerManager({ level, sink, styler: createStyler({ enabled: false }) })
	return { manager, sink }
}

describe('LoggerManager', () => {
	describe('registry (§9)', () => {
		it('register mints + stores a named logger, returns it, and counts it', () => {
			const { manager } = createTestManager()
			const logger = manager.register('http')
			expect(logger.name).toBe('http')
			expect(manager.count).toBe(1)
			expect(manager.logger('http')).toBe(logger)
		})

		it('logger(name) is undefined for an unknown name (lenient lookup)', () => {
			const { manager } = createTestManager()
			expect(manager.logger('missing')).toBeUndefined()
		})

		it('loggers() lists them in insertion order', () => {
			const { manager } = createTestManager()
			manager.register('a')
			manager.register('b')
			manager.register('c')
			expect(manager.loggers().map((logger) => logger.name)).toEqual(['a', 'b', 'c'])
		})

		it('a re-register of the same name overwrites (last write wins)', () => {
			const { manager } = createTestManager()
			const first = manager.register('dup')
			const second = manager.register('dup')
			expect(manager.count).toBe(1)
			expect(manager.logger('dup')).toBe(second)
			expect(manager.logger('dup')).not.toBe(first)
		})

		it('the manager defaults flow into each logger unless overridden', () => {
			const { manager } = createTestManager('warn')
			const inherited = manager.register('inherits')
			const overridden = manager.register('overrides', { level: 'debug' })
			expect(inherited.level).toBe('warn')
			expect(overridden.level).toBe('debug')
		})

		it('the registry key always wins over an options.name (no key desync)', () => {
			const { manager } = createTestManager()
			const logger = manager.register('canonical', { name: 'other' })
			expect(logger.name).toBe('canonical')
			expect(manager.logger('canonical')).toBe(logger)
			expect(manager.logger('other')).toBeUndefined()
		})
	})

	describe('fan-out', () => {
		it('forwards a log to every registered logger', () => {
			const { manager } = createTestManager()
			const a = manager.register('a')
			const b = manager.register('b')
			manager.info('shared', { n: 1 })
			expect(a.entries().map((record) => record.message)).toEqual(['shared'])
			expect(b.entries().map((record) => record.message)).toEqual(['shared'])
			expect(a.entries()[0]?.data).toEqual({ n: 1 })
		})

		it('each logger still gates by its own level during a fan-out', () => {
			const { manager } = createTestManager('warn')
			const quiet = manager.register('quiet') // inherits warn
			const loud = manager.register('loud', { level: 'debug' })
			manager.info('mid')
			// `info` < warn ⇒ dropped by quiet, kept by loud.
			expect(quiet.entries()).toHaveLength(0)
			expect(loud.entries().map((record) => record.message)).toEqual(['mid'])
		})

		it('all four fan-out verbs reach the loggers', () => {
			const { manager } = createTestManager()
			const logger = manager.register('a')
			manager.debug('d')
			manager.info('i')
			manager.warn('w')
			manager.error('e')
			expect(logger.entries().map((record) => record.level)).toEqual([
				'debug',
				'info',
				'warn',
				'error',
			])
		})

		it('a fan-out over an empty registry is a no-op', () => {
			const { manager } = createTestManager()
			expect(() => manager.info('nobody')).not.toThrow()
			expect(manager.count).toBe(0)
		})
	})

	describe('removal (§9.2)', () => {
		it('remove(name) drops one and returns whether it was present', () => {
			const { manager } = createTestManager()
			manager.register('a')
			manager.register('b')
			expect(manager.remove('a')).toBe(true)
			expect(manager.remove('a')).toBe(false)
			expect(manager.count).toBe(1)
			expect(manager.logger('a')).toBeUndefined()
		})

		it('remove(names[]) drops a batch — true when any was removed', () => {
			const { manager } = createTestManager()
			manager.register('a')
			manager.register('b')
			manager.register('c')
			expect(manager.remove(['a', 'b'])).toBe(true)
			expect(manager.count).toBe(1)
			expect(manager.loggers().map((logger) => logger.name)).toEqual(['c'])
			expect(manager.remove(['x', 'y'])).toBe(false)
		})

		it('remove() clears ALL (returns void)', () => {
			const { manager } = createTestManager()
			manager.register('a')
			manager.register('b')
			expect(manager.remove()).toBeUndefined()
			expect(manager.count).toBe(0)
		})

		it('clear() empties the registry', () => {
			const { manager } = createTestManager()
			manager.register('a')
			manager.clear()
			expect(manager.count).toBe(0)
			expect(manager.loggers()).toHaveLength(0)
		})
	})

	describe('overwrite + removal interplay', () => {
		it('a re-register overwrites so fan-out reaches ONLY the new logger, not the old', () => {
			const { manager } = createTestManager()
			const first = manager.register('dup')
			const second = manager.register('dup') // overwrites
			manager.info('broadcast')
			// Only the surviving (second) logger received the fan-out; the replaced one did not.
			expect(second.entries().map((record) => record.message)).toEqual(['broadcast'])
			expect(first.entries()).toHaveLength(0)
		})

		it('removing one name leaves the others registered and reachable by fan-out', () => {
			const { manager } = createTestManager()
			const a = manager.register('a')
			const b = manager.register('b')
			manager.remove('a')
			manager.warn('after removal')
			// 'a' was dropped from the registry — fan-out skips it; 'b' still receives.
			expect(a.entries()).toHaveLength(0)
			expect(b.entries().map((record) => record.message)).toEqual(['after removal'])
		})

		it('remove(name) does not destroy the returned logger — a held reference keeps working', () => {
			const { manager } = createTestManager()
			const logger = manager.register('a')
			manager.remove('a')
			// The manager stops tracking it, but the logger object itself is untouched.
			expect(() => logger.info('still alive')).not.toThrow()
			expect(logger.entries().map((record) => record.message)).toEqual(['still alive'])
			expect(logger.emitter.destroyed).toBe(false)
		})

		it('remove([]) of an empty list is a no-op returning false', () => {
			const { manager } = createTestManager()
			manager.register('a')
			expect(manager.remove([])).toBe(false)
			expect(manager.count).toBe(1)
		})

		it('remove([names]) returns true even when only SOME names were present', () => {
			const { manager } = createTestManager()
			manager.register('a')
			expect(manager.remove(['a', 'absent'])).toBe(true) // any removed ⇒ true
			expect(manager.count).toBe(0)
		})
	})

	describe('event-free', () => {
		it('exposes no emitter — observability is per-logger', () => {
			const { manager } = createTestManager()
			expect('emitter' in manager).toBe(false)
		})
	})

	describe('factory parity', () => {
		it('createLoggerManager yields a working registry + fan-out', () => {
			const sink = createRecordingSink()
			const manager = createLoggerManager({
				level: 'info',
				sink,
				styler: createStyler({ enabled: false }),
			})
			const logger = manager.register('svc')
			manager.info('up')
			expect(logger.entries().map((record) => record.message)).toEqual(['up'])
			expect(sink.calls).toHaveLength(1)
		})
	})
})
