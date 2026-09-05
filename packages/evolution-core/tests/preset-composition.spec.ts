import { describe, expect, it, vi } from 'vitest'
import { composePresetComposition } from '@deepseek-ai/dsh-evolution-core'

describe('composePresetComposition (0.3.15)', () => {
  it('composes standard rows then the delta with one trailing newline', () => {
    const standard = '- id: agent-loop\n  name: "@deepseek-ai/dsh-agent-loop"\n'
    const delta = '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n'
    expect(composePresetComposition(standard, delta)).toBe(`${standard.trim()}\n\n${delta.trim()}\n`)
  })

  it('trims trailing whitespace on both fragments', () => {
    const standard = '- id: a\n  name: "@deepseek-ai/dsh-a"\n  \n'
    const delta = '- id: b\n  name: "@deepseek-ai/dsh-b"\n\n\n'
    expect(composePresetComposition(standard, delta)).toBe('- id: a\n  name: "@deepseek-ai/dsh-a"\n\n- id: b\n  name: "@deepseek-ai/dsh-b"\n')
  })

  it('throws (sorted names) when a delta row collides with a standard row', () => {
    const standard = '- id: zzz\n  name: "@deepseek-ai/dsh-zzz"\n\n- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n'
    const delta = '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n'
    expect(() => composePresetComposition(standard, delta)).toThrow(/collide with runtime standard rows: tool-memory/)
  })

  it('warns and keeps both rows under DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1 (0.3.25)', () => {
    const previous = process.env.DSH_EVOLUTION_ALLOW_ROW_COLLISIONS
    process.env.DSH_EVOLUTION_ALLOW_ROW_COLLISIONS = '1'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const standard = '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n'
    const delta = '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n'
    try {
      // Keeps both rows (mounts twice) instead of failing loud.
      expect(composePresetComposition(standard, delta)).toBe(
        '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n\n- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n',
      )
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('collide with standard rows'))
    } finally {
      warn.mockRestore()
      if (previous === undefined) delete process.env.DSH_EVOLUTION_ALLOW_ROW_COLLISIONS
      else process.env.DSH_EVOLUTION_ALLOW_ROW_COLLISIONS = previous
    }
  })

  it('reads only `- id:` rows and ignores comments/sections', () => {
    const standard = '# comment line\n- id: a\n  name: "@deepseek-ai/dsh-a"\n\n# second section\n- id: b\n  name: "@deepseek-ai/dsh-b"\n'
    const delta = '- id: c\n  name: "@deepseek-ai/dsh-c"\n'
    expect(composePresetComposition(standard, delta)).toContain('- id: c')
  })
})
