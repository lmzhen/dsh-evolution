import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { evolutionHome, evolutionRoot, memoryRoot, skillsRoot } from '../src/index.ts'

describe('evolutionRoot / evolutionHome (0.3.22 G3.2, F-207)', () => {
  it('falls back to ~/.dsh when DSH_HOME is empty — never a CWD-relative path', () => {
    const env = { DSH_HOME: '' }
    expect(evolutionRoot(env)).toBe(join(homedir(), '.dsh'))
    expect(evolutionHome(env)).toBe(join(homedir(), '.dsh', 'evolution'))
  })

  it('uses DSH_HOME verbatim when set (no evolution suffix on the root)', () => {
    const env = { DSH_HOME: 'dsh-home-x' }
    expect(evolutionRoot(env)).toBe('dsh-home-x')
    expect(evolutionHome(env)).toBe(join('dsh-home-x', 'evolution'))
  })

  it('keeps a DSH_HOME that itself ends with "evolution" (the dirname() trap)', () => {
    // Regression guard: deriving the root via `dirname(evolutionHome())` would
    // strip a REAL trailing "evolution" segment; evolutionRoot never does that.
    const env = { DSH_HOME: 'dsh-home-x/evolution' }
    expect(evolutionRoot(env)).toBe('dsh-home-x/evolution')
    expect(evolutionHome(env)).toBe(join('dsh-home-x', 'evolution', 'evolution'))
  })

  it('V8-06: a WHITESPACE-ONLY DSH_HOME falls back too (upstream trim() adoption test)', () => {
    const env = { DSH_HOME: '   ' }
    expect(evolutionRoot(env)).toBe(join(homedir(), '.dsh'))
    expect(evolutionHome(env)).toBe(join(homedir(), '.dsh', 'evolution'))
  })

  it('C-11: the accepted value and the RETURNED value are the SAME trimmed source', () => {
    // The old form tested `DSH_HOME?.trim()` but returned the RAW value, so a
    // padded-but-real home was accepted AND persisted with literal spaces
    // (" /x " became a path with spaces on every sidecar).
    expect(evolutionRoot({ DSH_HOME: '  /d/x  ' })).toBe('/d/x')
    expect(evolutionHome({ DSH_HOME: '  /d/x  ' })).toBe(join('/d/x', 'evolution'))
    // An untrimmed real value is returned unchanged (trim only fixes padding).
    expect(evolutionRoot({ DSH_HOME: '/d/plain' })).toBe('/d/plain')
  })

  it('C-11: no `~` expansion — the documented upstream resolveDshHome divergence', () => {
    // Known deliberate tradeoff (audit v10 C-11): a literal `~` is passed
    // through verbatim rather than expanded; this test pins the behavior so
    // any future change is a conscious decision, not a drift.
    expect(evolutionRoot({ DSH_HOME: '~/dsh-alt' })).toBe('~/dsh-alt')
  })

  it('V9-05: memoryRoot/skillsRoot share the SAME root resolver — empty/whitespace DSH_HOME never yields a relative path', () => {
    // The old bare `||` in memoryRoot/skillsRoot resolved `DSH_HOME=" "`
    // (truthy) to a CWD-relative " /memories" sidecar; the adoption test
    // must now prove all three roots agree with evolutionRoot.
    expect(memoryRoot({ DSH_HOME: '' })).toBe(join(homedir(), '.dsh', 'memories'))
    expect(skillsRoot({ DSH_HOME: '' })).toBe(join(homedir(), '.dsh', 'skills'))
    expect(memoryRoot({ DSH_HOME: '   ' })).toBe(join(homedir(), '.dsh', 'memories'))
    expect(skillsRoot({ DSH_HOME: '   ' })).toBe(join(homedir(), '.dsh', 'skills'))
    // A real DSH_HOME still flows to every root verbatim.
    expect(memoryRoot({ DSH_HOME: 'custom-home' })).toBe(join('custom-home', 'memories'))
    expect(skillsRoot({ DSH_HOME: 'custom-home' })).toBe(join('custom-home', 'skills'))
  })
})
