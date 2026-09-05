import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { evolutionHome, evolutionRoot } from '../src/index.ts'

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
})
