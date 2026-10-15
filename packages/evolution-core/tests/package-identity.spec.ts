// @tier pre-tag
/** G1/1.8 G-04: the family scope is DERIVED from a manifest, so a published install under a different
 * scope follows without any release-time text rewrite. The criterion the plan named for this item is
 * exactly that: "a release-time rewrite could be bypassed" - here there is nothing to rewrite. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { scopeOfNearestManifest, scopedPackageName } from '../src/package-identity.ts'

it('G-04: the scope follows the nearest manifest, so no release-time rewrite is needed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-identity-'))
  try {
    await mkdir(join(root, 'packages', 'thing', 'src'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'root-unscoped' }))
    await writeFile(join(root, 'packages', 'thing', 'package.json'), JSON.stringify({ name: '@other-scope/dsh-evolution-thing' }))
    const moduleUrl = pathToFileURL(join(root, 'packages', 'thing', 'src', 'index.ts')).href
    expect(scopeOfNearestManifest(moduleUrl)).toBe('@other-scope')
    expect(scopedPackageName('dsh-agent-preset', moduleUrl)).toBe('@other-scope/dsh-agent-preset')
    // The RUNNING package answers with its own scope: the constant is not a literal anyone has to patch.
    expect(scopedPackageName('dsh-agent-preset', import.meta.url)).toBe(scopeOfNearestManifest(import.meta.url) + '/dsh-agent-preset')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
