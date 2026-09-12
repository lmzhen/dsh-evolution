/**
 * Per-test temporary roots for the family suites.
 *
 * `tempRoot` allocates a directory under the OS temp directory and registers it
 * for removal after the test. `tempHome` additionally points DSH_HOME at it.
 * The module-level hook restores DSH_HOME after every test — including a failing
 * one — so a leaked temp home cannot cascade into later tests of the same worker
 * (v21 T-8), and it deletes each registered root with the family's Windows retry
 * budget (an AV/indexer handle on a just-written directory surfaces as EBUSY).
 */
import { afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const roots: string[] = []
let baselineHome: string | undefined
let baselineCaptured = false

/**
 * Allocate a temporary root removed after the current test.
 * @param prefix - directory-name prefix identifying the suite.
 * @returns the created absolute path.
 */
export async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/**
 * Allocate a temporary root and point DSH_HOME at it until the test ends.
 * @param prefix - directory-name prefix identifying the suite.
 * @returns the created absolute path.
 */
export async function tempHome(prefix: string): Promise<string> {
  const root = await tempRoot(prefix)
  if (!baselineCaptured) {
    baselineHome = process.env.DSH_HOME
    baselineCaptured = true
  }
  process.env.DSH_HOME = root
  return root
}

afterEach(async () => {
  if (baselineCaptured) {
    if (baselineHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = baselineHome
    baselineCaptured = false
  }
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
