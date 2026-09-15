/**
 * S3-2 (J-5): the conformance suite is PUBLISHED, so it must stay loadable from
 * the package entry without dragging a test runner into every consumer.
 */
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../src/conformance.ts', import.meta.url)), 'utf8')

it('S3-2: the conformance module imports no test runner', () => {
  // The assert surface is a parameter (ConformanceAssert); a `vitest` import here
  // would make every consumer of the published package load the runner.
  expect(source).not.toMatch(/from 'vitest'/)
  expect(source).not.toMatch(/from "vitest"/)
  expect(source).toContain('ConformanceAssert')
})

it('S3-2: the suite is reachable from the package entry (what a third party imports)', async () => {
  const entry = await import('@deepseek-ai/dsh-evolution-state-storage')
  expect(typeof (entry as { runStateProviderConsistency?: unknown }).runStateProviderConsistency).toBe('function')
})
