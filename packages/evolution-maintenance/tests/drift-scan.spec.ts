import { describe, expect, it } from 'vitest'
import { computeDriftSignals } from '@deepseek-ai/dsh-evolution-core'
import { snapshotFromLibrary, type SkillLibraryLike } from '../src/index.ts'

describe('snapshotFromLibrary', () => {
  const library: SkillLibraryLike = {
    async list() {
      return [{ name: 'align-test-ops' }, { name: 'solo' }]
    },
    async read(name) {
      if (name === 'align-test-ops') return '# A\n\n## When to Use\n'
      return undefined
    },
  }

  it('assembles snapshots from a library reader, skipping unnamed reads', async () => {
    const snapshots = await snapshotFromLibrary(library)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.name).toBe('align-test-ops')
    expect(snapshots[0]?.body).toContain('## When to Use')
    expect(snapshots[0]?.quality).toBeUndefined()
  })

  it('passes enrichment through (quality/descriptions/supportFiles)', async () => {
    const snapshots = await snapshotFromLibrary(library, {
      quality: new Map([['align-test-ops', 0.4]]),
      descriptions: new Map([['align-test-ops', 'Short.']]),
      supportFiles: new Map([['align-test-ops', ['references/x.md']]]),
    })
    expect(snapshots[0]?.quality).toBe(0.4)
    expect(snapshots[0]?.supportFiles).toEqual(['references/x.md'])
  })

  it('missing enrichment flows into unknown verdicts via the signal layer', async () => {
    const snapshots = await snapshotFromLibrary(library)
    const report = computeDriftSignals(snapshots)
    const signals = report.skills[0]?.signals ?? []
    expect(signals.find(signal => signal.id === 'quality_low')?.verdict).toBe('unknown')
  })
})
