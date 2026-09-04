import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  latestActivityAt,
  nodeEvolutionIo,
  observeEvent,
  reviewPrompt,
  scanThreats,
  SkillLibrary,
  yamlPlainScalarNeedsQuotes,
  type TurnSignals,
} from '@deepseek-ai/dsh-evolution-core'

describe('0.3.16 S1.9 batch (E-42..E-50)', () => {
  it('E-45: hermes_env matches the win32 %USERPROFILE% form', () => {
    const hits = scanThreats('the path is %USERPROFILE%\\.hermes\\settings.yml')
    expect(hits.some(f => f.label === 'hermes_env')).toBe(true)
  })

  it('E-46: latestActivityAt compares instants, not ISO strings', () => {
    // Same instant: 10:00 +08:00 sorts BEFORE 02:00Z lexically, but is LATER.
    const record = {
      last_used_at: '2026-09-04T10:00:00.000+08:00',
      last_viewed_at: '2026-09-04T02:00:00.000Z',
      last_patched_at: null,
    } as never
    expect(latestActivityAt(record)).toBe('2026-09-04T10:00:00.000+08:00')
    // Unparseable values count as absent.
    const messy = { last_used_at: 'not-a-date', last_viewed_at: null, last_patched_at: null } as never
    expect(latestActivityAt(messy)).toBeNull()
  })

  it('E-47: null/bool/number plain scalars and trailing colons are flagged', () => {
    expect(yamlPlainScalarNeedsQuotes('true')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('123')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('null')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('value:')).toBe(true)
    expect(yamlPlainScalarNeedsQuotes('plain text')).toBe(false)
  })

  it('E-48: memory+plan review prompt is the combined plan prompt, not the agent one', () => {
    const plan = reviewPrompt('memory', 'plan')
    const combined = reviewPrompt('combined', 'plan')
    expect(plan).toBe(combined)
  })

  it('E-49: a malformed user/message content does not break the signal pipeline', () => {
    const signal: TurnSignals = {
      substantive: false, toolCalls: 0, userChars: 0, assistantChars: 0, memorySignal: false, skillSignal: false,
    }
    expect(() => {
      observeEvent(signal, { type: 'user/message', data: { content: 'not-an-array' } } as never)
    }).not.toThrow()
    expect(signal.userChars).toBe(0)
  })

  it('E-43: a SKILL.md directory reads as absent through the library surface while readText keeps flagging EISDIR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evo-e43-'))
    const lib = new SkillLibrary(root)
    await lib.create('normal-skill', '---\nname: normal-skill\ndescription: fine.\n---\n\n# N\n', 'foreground')
    await rm(join(root, 'normal-skill', 'SKILL.md'), { recursive: true, force: true })
    await mkdir(join(root, 'normal-skill', 'SKILL.md'), { recursive: true })
    // Library surface: absent (no reject, no bricked read).
    expect(await lib.read('normal-skill')).toBeNull()
    // Raw IO keeps throwing so rotation can still flag the malformed slot (G-2).
    await expect(nodeEvolutionIo().readText(join(root, 'normal-skill', 'SKILL.md'))).rejects.toThrow()
    await rm(root, { recursive: true, force: true })
  })
})
