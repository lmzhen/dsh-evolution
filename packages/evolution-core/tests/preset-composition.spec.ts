import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { composePresetComposition } from '@deepseek-ai/dsh-evolution-core'

const run = promisify(execFile)

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

  it('V10-14/0.3.53: a standard-sourced tool-skill row receives the 60-char catalog cap', () => {
    const standard = '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n\n- id: tool-skill\n  name: "@deepseek-ai/dsh-tool-skill"\n'
    const delta = '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n'
    const composed = composePresetComposition(standard, delta)
    expect(composed).toContain('- id: tool-skill\n  name: "@deepseek-ai/dsh-tool-skill"\n  # V10-14')
    expect(composed).toContain('catalogDescriptionMaxLength: 60')
    expect(composed).toContain('- id: tool-memory')
  })

  it('V10-14/0.3.53: an already-configured tool-skill row is left byte-identical (idempotent)', () => {
    const standard = '- id: tool-skill\n  name: "@deepseek-ai/dsh-tool-skill"\n  config:\n    custom: 1\n'
    const delta = '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n'
    const composed = composePresetComposition(standard, delta)
    expect(composed).toContain('  config:\n    custom: 1')
    expect(composed).not.toContain('catalogDescriptionMaxLength: 60')
  })
})

describe('the shared row-override table (0.3.77, G1 single-source)', () => {
  it('is DATA both generation paths read — the composer and the source installer agree byte-for-byte', async () => {
    // Before 0.3.77 each path carried its own hand-kept copy of this table and
    // they stayed byte-identical by hand. The pin below fails the moment either
    // side grows a copy again: the entries live in row-overrides.json only, and
    // both implementations are required to produce the same bytes from it.
    const standard = '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n\n- id: tool-skill\n  name: "@deepseek-ai/dsh-tool-skill"\n'
    const delta = '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n'
    const composed = composePresetComposition(standard, delta)
    const { loadRowOverrides } = await import('@deepseek-ai/dsh-evolution-core')
    const table = loadRowOverrides()
    expect(table.length).toBeGreaterThan(0)
    for (const override of table) {
      for (const line of override.lines) expect(composed).toContain(line)
      expect(override.missingReason.length).toBeGreaterThan(0)
    }
    // The source installer's helper, evaluated in a subprocess the way
    // installer-preset-base.spec does (the script ships no type declarations),
    // must return the SAME bytes for the SAME input.
    const installer = fileURLToPath(new URL('../../scripts/install-layered.mjs', import.meta.url))
    const script = [
      `import * as installer from ${JSON.stringify(pathToFileURL(installer).href)}`,
      `process.stdout.write(Buffer.from(installer.generateAgentPreset(${JSON.stringify(standard)}, ${JSON.stringify(delta)}), 'utf8').toString('base64'))`,
    ].join('\n')
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script])
    expect(Buffer.from(stdout, 'base64').toString('utf8')).toBe(composed)

    // Neither implementation may inline the table again: the distinctive config
    // line exists in the JSON and nowhere else.
    for (const file of ['../src/preset-composition.ts', '../../scripts/install-layered.mjs']) {
      expect(readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'), file).not.toContain('catalogDescriptionMaxLength')
    }
    // ...and the JSON is the table the package SHIPS (files + exports), or an
    // installed copy would throw at compose time.
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as
      { files?: unknown; exports?: Record<string, unknown> }
    expect(Array.isArray(manifest.files) ? manifest.files : []).toContain('row-overrides.json')
    expect((manifest.exports ?? {})['./row-overrides.json']).toBe('./row-overrides.json')
  })
})

