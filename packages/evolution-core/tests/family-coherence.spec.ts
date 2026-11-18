// @tier pre-tag
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkFamilyCoherence } from '../src/runtime/coherence.ts'

async function profileWith(versions: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-family-coherence-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, dependencies: {} }))
  const installed = {
    '@lmzhen/dsh-evolution-core': '0.53.0',
    '@lmzhen/dsh-evolution-ui': '0.53.0',
    '@lmzhen/dsh-evolution-client-kit': '0.53.0',
    ...versions,
  }
  for (const [name, version] of Object.entries(installed)) {
    const dir = join(root, 'node_modules', name)
    await mkdir(dir, { recursive: true })
    const manifest = name === '@lmzhen/dsh-evolution-ui'
      ? { name, version, dependencies: { '@lmzhen/dsh-evolution-client-kit': '0.53.0' } }
      : { name, version }
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
  }
  const allDir = join(root, 'node_modules', '@lmzhen/dsh-evolution-all')
  await mkdir(allDir, { recursive: true })
  await writeFile(join(allDir, 'package.json'), JSON.stringify({
    name: '@lmzhen/dsh-evolution-all',
    version: '0.53.0',
    dependencies: {
      '@lmzhen/dsh-evolution-core': '0.53.0',
      '@lmzhen/dsh-evolution-ui': '0.53.0',
    },
  }))
  return root
}

describe('family coherence', () => {
  it('accepts a profile whose implementation packages match the all bundle', async () => {
    const root = await profileWith({})
    const coherence = checkFamilyCoherence(root)
    expect(coherence?.allVersion).toBe('0.53.0')
    expect(coherence?.mismatched).toEqual([])
  })

  it('names every old or missing implementation package', async () => {
    const root = await profileWith({
      '@lmzhen/dsh-evolution-core': '0.51.1',
    })
    const coherence = checkFamilyCoherence(root)
    expect(coherence?.mismatched).toEqual([
      { name: '@lmzhen/dsh-evolution-core', version: '0.51.1' },
    ])
  })

  it('names a missing implementation package', async () => {
    const root = await profileWith({})
    await rm(join(root, 'node_modules/@lmzhen/dsh-evolution-ui'), { recursive: true, force: true })
    const coherence = checkFamilyCoherence(root)
    expect(coherence?.mismatched).toEqual([
      { name: '@lmzhen/dsh-evolution-ui' },
    ])
  })

  it('names an old implementation package reached through another dependency', async () => {
    const root = await profileWith({ '@lmzhen/dsh-evolution-client-kit': '0.51.1' })
    const coherence = checkFamilyCoherence(root)
    expect(coherence?.mismatched).toEqual([
      { name: '@lmzhen/dsh-evolution-client-kit', version: '0.51.1' },
    ])
  })

  it('returns undefined when the profile has no all bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-family-coherence-empty-'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }))
    expect(checkFamilyCoherence(root)).toBeUndefined()
  })
})
