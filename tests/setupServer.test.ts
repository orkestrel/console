import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	createStreamTarget,
	createWriteProbe,
	fileExists,
	readText,
	WORKSPACE_ROOT,
} from './setupServer.js'

describe('WORKSPACE_ROOT', () => {
	it('names the real repository root, independent of readText and fileExists', () => {
		// A second route: read the manifest directly with node:fs rather than through readText or
		// fileExists, so the assertion cannot pass merely because those two helpers agree with
		// each other.
		const manifestText = readFileSync(join(WORKSPACE_ROOT, 'package.json'), 'utf8')
		const manifest: unknown = JSON.parse(manifestText)
		expect(manifest).toMatchObject({ name: '@orkestrel/console' })
	})
})

describe('readText', () => {
	it('reads a real repo-relative file, matching a direct node:fs read', () => {
		const expected = readFileSync(join(WORKSPACE_ROOT, 'package.json'), 'utf8')
		expect(readText('package.json')).toBe(expected)
	})

	it('throws for a path that does not exist, as node:fs itself would', () => {
		expect(() => readText('tests/does-not-exist-anywhere.txt')).toThrow(/ENOENT|no such file/)
	})
})

describe('fileExists', () => {
	it('reports true for a real file the repository ships', () => {
		expect(fileExists('package.json')).toBe(true)
	})

	it('reports false for a path that does not exist', () => {
		expect(fileExists('tests/does-not-exist-anywhere.txt')).toBe(false)
	})
})

describe('createStreamTarget', () => {
	it('defaults to a non-TTY target with no columns, and records every write', () => {
		const { target, writes } = createStreamTarget()
		expect(target.isTTY).toBe(false)
		expect('columns' in target).toBe(false)

		const accepted = target.write('first chunk')
		target.write('second chunk')

		expect(accepted).toBe(true)
		expect(writes.calls).toEqual([['first chunk'], ['second chunk']])
	})

	it('carries the requested isTTY and columns', () => {
		const { target } = createStreamTarget({ isTTY: true, columns: 80 })
		expect(target.isTTY).toBe(true)
		expect(target.columns).toBe(80)
	})
})

describe('createWriteProbe', () => {
	it('defaults to backpressure true and records each written string chunk', () => {
		const probe = createWriteProbe()
		const accepted = probe.write('plain chunk')
		expect(accepted).toBe(true)
		expect(probe.texts).toEqual(['plain chunk'])
	})

	it('decodes a Uint8Array chunk to its utf-8 text', () => {
		const probe = createWriteProbe()
		const bytes = new TextEncoder().encode('encoded chunk')
		probe.write(bytes)
		expect(probe.texts).toEqual(['encoded chunk'])
	})

	it('returns the configured backpressure value', () => {
		const probe = createWriteProbe(false)
		expect(probe.write('chunk')).toBe(false)
	})
})

// Mutation control (recorded, not left in place): case "reads a real repo-relative file, matching
// a direct node:fs read" was broken by appending an extra character to `expected` after the
// node:fs read, then the case failed at the `expect(readText('package.json')).toBe(expected)`
// line with a string mismatch. The edit was reverted before this file was saved.
