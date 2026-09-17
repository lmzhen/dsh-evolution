import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { buildEnrichment } from '../src/index.ts'
import type { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'

/**
 * Minimal library fake covering the surface buildEnrichment consumes. `read`
 * resolves per-entry so both empty-read shapes (null from the concrete
 * SkillLibrary, undefined from a looser injected reader) are exercisable.
 */
function fakeLibrary(read: (name: string) => Promise<string | null | undefined>) {
  return {
    async list() {
      return [{ name: 'ghost-skill' }, { name: 'real-skill' }]
    },
    read,
    async listSupportFiles() {
      return { kind: 'absent' } as const
    },
    // V4: the enrichment also measures oversize support files through the store.
    // No listing means "cannot answer", which is what this fake reports.
    async supportFileChars() {
      return null
    },
  } as unknown as SkillLibrary
}

describe('buildEnrichment', () => {
  // F-01: the empty-read guard must treat null AND undefined as
  // "no body" — drift-scan.ts already did; enrichment used to check null only,
  // so an injected reader resolving undefined crashed in parseFrontmatter.
  it('F-01: a read() resolving undefined skips the entry instead of TypeError', async () => {
    const ctx = new Context()
    const enrichment = await buildEnrichment(ctx, fakeLibrary(async name => name === 'ghost-skill' ? undefined : '---\nname: real-skill\ndescription: Real skill.\n---\n\n# Real\n'))
    expect(enrichment.descriptions.has('ghost-skill')).toBe(false)
    expect(enrichment.supportFiles.has('ghost-skill')).toBe(false)
    // The readable sibling is still enriched — the skip is per-entry, not a
    // loop break.
    expect(enrichment.descriptions.get('real-skill')).toBe('Real skill.')
  })

  it('F-01: a read() resolving null skips the entry (pre-existing contract, pinned)', async () => {
    const ctx = new Context()
    const enrichment = await buildEnrichment(ctx, fakeLibrary(async name => name === 'ghost-skill' ? null : '---\nname: real-skill\ndescription: Real skill.\n---\n\n# Real\n'))
    expect(enrichment.descriptions.has('ghost-skill')).toBe(false)
    expect(enrichment.quality.has('ghost-skill')).toBe(false)
    expect(enrichment.descriptions.get('real-skill')).toBe('Real skill.')
  })

  it('P2-21: one entry whose read throws degrades to unknown instead of failing the whole scan', async () => {
    // The deployed maintain path runs enrichment BEFORE the drift scan, so a
    // transient EACCES/EIO on one entry used to reject the entire run and made
    // drift-scan's own E-9 guard unreachable.
    const ctx = new Context()
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    const enrichment = await buildEnrichment(ctx, fakeLibrary(async (name) => {
      if (name === 'ghost-skill') throw new Error('EACCES: permission denied, open SKILL.md')
      return '---\nname: real-skill\ndescription: Real skill.\n---\n\n# Real\n'
    }))
    expect(enrichment.descriptions.has('ghost-skill')).toBe(false)
    // The readable sibling is still enriched — the guard is per entry.
    expect(enrichment.descriptions.get('real-skill')).toBe('Real skill.')
    // The degradation is visible, not silent.
    expect(warnSpy.mock.calls.some(call => typeof call[0] === 'string' && call[0].includes('ghost-skill'))).toBe(true)
    warnSpy.mockRestore()
  })

  it('F-01: protection markers are collected even when the body read is empty', async () => {
    const ctx = new Context()
    // list() entries carry protectedBy independent of the body read; the
    // guard `continue`s AFTER the marker is recorded (same order as drift-scan).
    const library = {
      async list() {
        return [{ name: 'ghost-skill', protectedBy: '.pinned', protectionUnknown: false }]
      },
      async read() {
        return undefined
      },
      async listSupportFiles() {
        return { kind: 'absent' } as const
      },
    } as unknown as SkillLibrary
    const enrichment = await buildEnrichment(ctx, library)
    expect(enrichment.protected.get('ghost-skill')).toBe('.pinned')
  })
})
