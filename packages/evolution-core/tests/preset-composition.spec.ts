import { describe, expect, it } from 'vitest'
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

  it('reads only `- id:` rows and ignores comments/sections', () => {
    const standard = '# comment line\n- id: a\n  name: "@deepseek-ai/dsh-a"\n\n# second section\n- id: b\n  name: "@deepseek-ai/dsh-b"\n'
    const delta = '- id: c\n  name: "@deepseek-ai/dsh-c"\n'
    expect(composePresetComposition(standard, delta)).toContain('- id: c')
  })
})
