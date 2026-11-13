// @tier pre-tag
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  EVOLUTION_SCOPE,
  PACKAGES_DIR,
  familyVersion,
  packageSourceRoot,
  prepareDistSourceRoot,
  validateTreeIdentity,
} from '../../scripts/install/source-tree.mjs'

async function tempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'dsh-source-tree-'))
}

it('reads the family version from source and packed directory names', async () => {
  const root = await tempDir()
  await mkdir(join(root, 'dsh-evolution-host'), { recursive: true })
  await writeFile(join(root, 'dsh-evolution-host', 'package.json'), JSON.stringify({ version: '9.9.9' }))
  expect(familyVersion(root)).toBe('9.9.9')
  // The source tree (PACKAGES_DIR) has the bare dir name and its own real version.
  expect(familyVersion(PACKAGES_DIR)).toMatch(/^\d+\.\d+\.\d+/)
})

it('validates version+scope for every tree kind with one check', () => {
  expect(() => validateTreeIdentity({ version: '0.47.0', scope: '@lmzhen' }, '0.47.0', '@lmzhen')).not.toThrow()
  expect(() => validateTreeIdentity({ version: '0.46.0', scope: '@lmzhen' }, '0.47.0', '@lmzhen')).toThrow(/built for 0\.46\.0/)
  expect(() => validateTreeIdentity({ scope: '@lmzhen' }, '0.47.0', '@lmzhen')).toThrow(/built for \(unknown\)/)
  expect(() => validateTreeIdentity({ version: '0.47.0' }, '0.47.0', '@lmzhen')).toThrow(/has no "scope" field/)
  expect(() => validateTreeIdentity({ version: '0.47.0', scope: '@deepseek-ai' }, '0.47.0', '@lmzhen')).toThrow(/built under scope/)
})

it('refuses a dist with no manifest or with a foreign scope before unpacking', async () => {
  const missing = await tempDir()
  expect(() => prepareDistSourceRoot(missing)).toThrow(/has no manifest\.json/)

  const foreign = await tempDir()
  await writeFile(join(foreign, 'manifest.json'), JSON.stringify({ '@other/dsh-evolution-all': 'all.tgz' }))
  expect(() => prepareDistSourceRoot(foreign)).toThrow(/rebuild the dist with the same scope/)
})

it('resolves the source tree and family version for this checkout', () => {
  expect(typeof packageSourceRoot()).toBe('string')
  if (EVOLUTION_SCOPE === '@deepseek-ai') expect(packageSourceRoot()).toBe(PACKAGES_DIR)
  expect(familyVersion()).toMatch(/^\d+\.\d+\.\d+/)
})
