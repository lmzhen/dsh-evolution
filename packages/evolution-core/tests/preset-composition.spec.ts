import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  basePresetPlugins,
  composePresetComposition,
  composePresetEntry,
  composePresetInsert,
  composePresetRow,
  mergePresetRow,
  presetPatchText,
  presetRowBlock,
  removePresetRow,
  resolveBasePresetPatch,
} from '@deepseek-ai/dsh-evolution-core'

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

  it('PLAN S5.9 (2026-09-16): collision detection sees an INDENTED `- id:` row (nested group)', () => {
    // Audit P2-27: the id extraction used to anchor at column 0 (`^- id:`), so
    // an upstream that nests model rows inside a group hid the duplicate from
    // this guard while every other check stayed green. The extractor is
    // indent-agnostic now (twin of `rowIds` in scripts/install-layered.mjs;
    // installer.spec pins the cross-side parity).
    const standard = 'groups:\n  - id: tool-session-query\n    name: "@deepseek-ai/dsh-tool-session-query"\n'
    const delta = '- id: tool-session-query\n'
    expect(() => composePresetComposition(standard, delta)).toThrow(/collide with runtime standard rows: tool-session-query/)
  })

  it('PLAN S5.9 (2026-09-16): boundary pin — detection covers nested rows, injection anchoring is still top-level only', () => {
    // Current, documented boundary: a NESTED `- id: tool-skill` row is seen by
    // the collision detector, but the V10-14 cap injection does NOT land on it
    // (applyOneOverride anchors the row at column 0 and its child keys at two
    // spaces). This pins the boundary so lifting it later is a decision, not
    // an accident; the missed cap stays observable through the warn.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const standard = 'groups:\n  - id: tool-skill\n    name: "@deepseek-ai/dsh-tool-skill"\n'
    const delta = '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n'
    try {
      const composed = composePresetComposition(standard, delta)
      expect(composed).toContain('  - id: tool-skill')
      expect(composed).not.toContain('catalogDescriptionMaxLength: 60')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('tool-skill'))
    } finally {
      warn.mockRestore()
    }
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

describe('composePresetRow / mergePresetRow (G6: declarative presets)', () => {
  const identity = {
    rowId: 'evolution-preset',
    id: 'evolution',
    name: 'Evolution',
    description: 'The dsh-evolution family preset.',
    order: 40,
  }
  const base = '- id: agent-loop\n  name: "@deepseek-ai/dsh-agent-loop"\n'
  const delta = '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n'

  it('embeds the composed base then delta rows under plugins, with the platform package and identity', () => {
    const row = composePresetRow(base, delta, identity)
    expect(row).toContain("- id: evolution-preset\n  name: '@deepseek-ai/dsh-agent-preset'\n")
    expect(row).toContain('    id: evolution\n')
    expect(row).toContain('    plugins:\n')
    // Base rows first, delta after — and every composed row sits INSIDE the plugins block.
    expect(row).toContain('      - id: agent-loop\n        name: "@deepseek-ai/dsh-agent-loop"')
    expect(row).toContain('      - id: tool-memory\n        name: "@deepseek-ai/dsh-tool-memory"')
    expect(row.endsWith('\n')).toBe(true)
  })

  it('emits YAML, not JSON: no line the row carries may end with a comma', () => {
    // Regression (round 15): the identity lines were written JSON-style
    // (`name: "Evolution",`) and every text-level assertion above still passed — what
    // rejects the block is the platform's own patch parser ("bad indentation of a
    // mapping entry", found by probing the composer against the REAL
    // packages/bundle/web-app/presets/standard.patch.yml). The parse itself is pinned in
    // evolution-host/tests/installer-preset-base.spec.ts; this case keeps the class out.
    for (const text of [composePresetRow(base, delta, identity), composePresetInsert(composePresetRow(base, delta, identity))]) {
      for (const line of text.split('\n')) expect(line.trimEnd().endsWith(','), line).toBe(false)
    }
  })

  it('keeps the collision contract and injects the shared row overrides before embedding', () => {
    // Same table as composePresetComposition: an override anchors a COLUMN-0 row, so it must run
    // before the indentation that puts the rows under `plugins:`.
    const row = composePresetRow('- id: tool-skill\n  name: "@deepseek-ai/dsh-tool-skill"\n', delta, identity)
    expect(row).toContain('catalogDescriptionMaxLength: 60')
    expect(row).toContain('      - id: tool-skill')
    expect(() => composePresetRow(delta, delta, identity)).toThrow(/collide with runtime standard rows: tool-memory/)
  })

  it('merges by row id: appends when absent, replaces the whole block, leaves other rows byte-identical', () => {
    const patch = '- id: other-row\n  name: "@deepseek-ai/dsh-other"\n  config:\n    keep: true\n'
    const appended = mergePresetRow(patch, composePresetRow(base, delta, identity), identity.rowId)
    expect(appended.startsWith(patch.trimEnd())).toBe(true)
    expect(appended).toContain('- id: evolution-preset')
    // A re-run with a different delta REPLACES the row and never doubles it.
    const replaced = mergePresetRow(appended, composePresetRow(base, '- id: tool-memory\n  name: "moved"\n', identity), identity.rowId)
    expect(replaced).toContain('      - id: tool-memory\n        name: "moved"')
    expect(replaced).not.toContain('@deepseek-ai/dsh-tool-memory')
    expect(replaced.match(/- id: evolution-preset/g)).toHaveLength(1)
    expect(replaced).toContain('- id: other-row\n  name: "@deepseek-ai/dsh-other"\n  config:\n    keep: true')
    // Idempotent: merging the same row again is a no-op byte for byte.
    expect(mergePresetRow(replaced, composePresetRow(base, '- id: tool-memory\n  name: "moved"\n', identity), identity.rowId)).toBe(replaced)
  })
})

describe('the profile-patch form (G6: insert entry, base extraction, removal)', () => {
  const identity = {
    rowId: 'preset-evolution',
    id: 'evolution',
    name: 'Evolution',
    description: 'Standard coding agent plus durable memory and skill evolution tools.',
    order: 10,
  }
  const base = '- id: agent-loop\n  name: "@deepseek-ai/dsh-agent-loop"\n'
  const delta = '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n'
  const moved = composePresetInsert(composePresetRow(base, '- id: tool-memory\n  name: "moved"\n', identity))

  it('wraps the composed row in an insert entry, four spaces deeper', () => {
    // A plain patch entry overrides the row with the same id and adds nothing, so a preset the
    // platform does not ship has to arrive inside `insert`
    // (packages/boot/app-boot/tests/user-patches.spec.ts:47-64).
    const entry = composePresetInsert(composePresetRow(base, delta, identity))
    expect(entry.startsWith('- insert:\n    - id: preset-evolution\n')).toBe(true)
    expect(entry).toContain("      name: '@deepseek-ai/dsh-agent-preset'\n")
    expect(entry).toContain('        plugins:\n')
    expect(entry).toContain('          - id: agent-loop\n            name: "@deepseek-ai/dsh-agent-loop"')
    expect(entry.endsWith('\n')).toBe(true)
    // Nothing may survive at column 0: that form would be read as an override, not a new row.
    expect(entry.split('\n').some(line => /^- id:/.test(line))).toBe(false)
  })

  it('extracts the preset rows from a shipped base patch (shallowest plugins list, dedented)', () => {
    const patch = [
      '# Agent preset standard: one `@deepseek-ai/dsh-agent-preset` declaration inserted',
      '- insert:',
      '    - id: preset-standard',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: standard',
      '        order: 1',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              suffix: Your working directory is {{cwd}}.',
      '              plugins: a child key by that name is NOT the preset list',
      '          - id: tool-bash',
      "            name: '@deepseek-ai/dsh-tool-bash'",
      "            disabled: !!js process.platform === 'win32'",
      '',
    ].join('\n')
    const rows = basePresetPlugins(patch)
    expect(rows.startsWith('- id: persona\n')).toBe(true)
    expect(rows).toContain("  name: '@deepseek-ai/dsh-persona'")
    // The child's own `plugins:` key keeps its place relative to its own row (dedent by 10).
    expect(rows).toContain('    plugins: a child key by that name is NOT the preset list')
    expect(rows).toContain("  disabled: !!js process.platform === 'win32'")
    expect(rows.endsWith('\n')).toBe(true)
    // The preset's own metadata is not part of its row list.
    expect(rows).not.toContain('preset-standard')
    expect(rows).not.toContain('id: standard')
    expect(() => basePresetPlugins('- id: x\n  name: y\n')).toThrow(/plugins/)
  })

  it('replaces the whole insert entry it wrote before, and nothing else', () => {
    const patch = '- id: keep-me\n  name: "@deepseek-ai/dsh-other"\n\n' + composePresetInsert(composePresetRow(base, delta, identity))
    const replaced = mergePresetRow(patch, moved, identity.rowId)
    expect(replaced).toContain('- id: keep-me\n  name: "@deepseek-ai/dsh-other"')
    expect(replaced).toContain('- insert:\n    - id: preset-evolution\n')
    expect(replaced).toContain('name: "moved"')
    expect(replaced.match(/- id: preset-evolution/g)).toHaveLength(1)
    expect(replaced.match(/- insert:/g)).toHaveLength(1)
    expect(mergePresetRow(replaced, moved, identity.rowId)).toBe(replaced)
  })

  it('replaces a Web-editor-saved row that sits at column 0', () => {
    const saved = [
      '- id: preset-evolution',
      "  name: '@deepseek-ai/dsh-agent-preset'",
      '  config:',
      '    id: evolution',
      '    plugins:',
      '      - id: edited-in-the-editor',
      '',
    ].join('\n')
    const merged = mergePresetRow(saved, moved, identity.rowId)
    expect(merged.startsWith('- insert:\n')).toBe(true)
    expect(merged).not.toContain('edited-in-the-editor')
    expect(merged).toContain('name: "moved"')
  })

  it('adds the entry to a patch that has none', () => {
    const appended = mergePresetRow('- id: other-row\n  name: "@deepseek-ai/dsh-other"\n', moved, identity.rowId)
    expect(appended).toBe('- id: other-row\n  name: "@deepseek-ai/dsh-other"\n' + moved.replace(/\s+$/, '') + '\n')
    expect(mergePresetRow('', moved, identity.rowId)).toBe(moved)
  })

  it('removes the row alone while its entry holds others — before it or after it', () => {
    const other = ['    - id: preset-other', "      name: '@deepseek-ai/dsh-agent-preset'", '      config:', '        id: other']
    const first = ['- insert:', '    - id: preset-evolution', "      name: '@deepseek-ai/dsh-agent-preset'", ...other, '- id: keep-me', '  name: x', ''].join('\n')
    const keptFirst = removePresetRow(first, identity.rowId)
    expect(keptFirst).not.toContain('preset-evolution')
    expect(keptFirst).toContain('- insert:\n    - id: preset-other')
    expect(keptFirst).toContain('- id: keep-me')
    const last = ['- insert:', ...other, '    - id: preset-evolution', "      name: '@deepseek-ai/dsh-agent-preset'", '- id: keep-me', '  name: x', ''].join('\n')
    const keptLast = removePresetRow(last, identity.rowId)
    expect(keptLast).not.toContain('preset-evolution')
    expect(keptLast).toContain('- insert:\n    - id: preset-other')
    expect(keptLast).toContain('- id: keep-me')
  })

  it('takes the entry with it when the row was its only member, and is a no-op when absent', () => {
    expect(removePresetRow(moved, identity.rowId)).toBe('')
    expect(removePresetRow('- id: keep-me\n  name: x\n', identity.rowId)).toBe('- id: keep-me\n  name: x\n')
    const saved = '- id: preset-evolution\n  name: "@deepseek-ai/dsh-agent-preset"\n'
    expect(removePresetRow(saved + '- id: keep-me\n  name: x\n', identity.rowId)).toBe('- id: keep-me\n  name: x\n')
  })
})

describe('the source installer emits the same bytes (install-layered.mjs parity)', () => {
  const identity = {
    rowId: 'preset-evolution',
    id: 'evolution',
    name: 'Evolution',
    description: 'Standard coding agent plus durable memory and skill evolution tools.',
    order: 10,
  }
  const delta = '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n'
  // A platform base patch in the shipped form: one `- insert:` entry whose row carries the preset
  // list under `config.plugins` (`packages/bundle/web-app/presets/standard.patch.yml`).
  const basePatch = [
    '# Agent preset standard: one declaration inserted',
    '- insert:',
    '    - id: preset-standard',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: standard',
    '        order: 1',
    '        plugins:',
    '          - id: persona',
    "            name: '@deepseek-ai/dsh-persona'",
    '          - id: tool-skill',
    "            name: '@deepseek-ai/dsh-tool-skill'",
    '',
  ].join('\n')
  const otherRow = '- id: keep-me\n  name: "@deepseek-ai/dsh-other"\n'
  const patched = mergePresetRow(otherRow, composePresetEntry(basePatch, delta, identity), identity.rowId)

  it('composes, extracts, merges and removes to the same bytes as the installer', async () => {
    // The installer is a source-tree tool with no type declarations and no build step, so its
    // twins are evaluated in a subprocess; a drift in ANY of the five functions fails here.
    const installer = fileURLToPath(new URL('../../scripts/install-layered.mjs', import.meta.url))
    const entry = composePresetEntry(basePatch, delta, identity)
    const script = [
      `import * as installer from ${JSON.stringify(pathToFileURL(installer).href)}`,
      'const out = {',
      `  plugins: installer.basePresetPlugins(${JSON.stringify(basePatch)}),`,
      `  entry: installer.composePresetEntry(${JSON.stringify(basePatch)}, ${JSON.stringify(delta)}, ${JSON.stringify(identity)}),`,
      `  seeded: installer.mergePresetRow('[]\\n', ${JSON.stringify(entry)}, ${JSON.stringify(identity.rowId)}),`,
      `  removed: installer.removePresetRow(${JSON.stringify(patched)}, ${JSON.stringify(identity.rowId)}),`,
      `  composed: installer.generateAgentPreset(${JSON.stringify(basePatch)}, ${JSON.stringify(delta)}),`,
      '}',
      'process.stdout.write(Buffer.from(JSON.stringify(out), "utf8").toString("base64"))',
    ].join('\n')
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script])
    const installerBytes = JSON.parse(Buffer.from(stdout, 'base64').toString('utf8')) as Record<string, string>
    const core = {
      plugins: basePresetPlugins(basePatch),
      entry,
      seeded: mergePresetRow('[]\n', entry, identity.rowId),
      removed: removePresetRow(patched, identity.rowId),
      composed: composePresetComposition(basePatch, delta),
    }
    for (const key of Object.keys(core) as Array<keyof typeof core>) expect(installerBytes[key], key).toBe(core[key])
    // ...and the parity is not vacuous: the entry really carries the base rows and the delta.
    expect(core.entry.startsWith('- insert:\n    - id: preset-evolution\n')).toBe(true)
    expect(core.entry).toContain('          - id: persona')
    expect(core.entry).toContain('          - id: tool-memory')
    expect(core.entry).toContain('catalogDescriptionMaxLength: 60')
  })

  it('replaces the platform empty-list seed instead of extending it', () => {
    // The platform seeds a fresh profile patch with `[]` (`packages/boot/app-boot/src/profile.ts`,
    // `PROFILE_PATCH_FILENAME`), which is a COMPLETE YAML document: a block sequence appended
    // after it is not parsable.
    const entry = composePresetInsert(composePresetRow('- id: a\n  name: "x"\n', delta, identity))
    const merged = mergePresetRow('[]\n', entry, identity.rowId)
    expect(merged.startsWith('- insert:\n')).toBe(true)
    expect(merged).not.toContain('[]')
    expect(mergePresetRow('', entry, identity.rowId)).toBe(merged)
    // ...and emptying the patch restores the platform's seed rather than writing zero bytes.
    expect(presetPatchText(removePresetRow(merged, identity.rowId))).toBe('[]\n')
  })

  it('round-trips a CRLF patch byte-exactly and never rewrites the author line endings', () => {
    // Windows authors — and the platform's own editor — write CRLF, while the appended entry is
    // LF, so an installed file is legitimately MIXED. Removal must still restore the original
    // bytes: trimming the kept line's trailing `\r` (or collapsing interior blank lines) made
    // install → uninstall lossy on every CRLF patch.
    const entry = composePresetEntry(basePatch, delta, identity)
    const crlf = ['- id: keep-me', '  name: "@deepseek-ai/dsh-other"', '', '- id: also-keep', '  name: "x"', '']
      .join('\n').replace(/\n/g, '\r\n')
    const merged = mergePresetRow(crlf, entry, identity.rowId)
    expect(presetRowBlock(merged, identity.rowId)).not.toBeNull()
    expect(mergePresetRow(merged, entry, identity.rowId)).toBe(merged)
    expect(removePresetRow(merged, identity.rowId)).toBe(crlf)
    // The blank line the author wrote survives the round trip (no interior collapsing).
    expect(removePresetRow(merged, identity.rowId)).toContain('\r\n\r\n')
    // Same promise on an LF patch carrying consecutive blank lines.
    const lf = '- id: keep-me\n  name: "@deepseek-ai/dsh-other"\n\n\n- id: also-keep\n  name: "x"\n'
    const mergedLf = mergePresetRow(lf, entry, identity.rowId)
    expect(removePresetRow(mergedLf, identity.rowId)).toBe(lf)
  })

  it('replaces every spelling of the platform empty-list seed, not just the literal []', () => {
    // The platform seeds a fresh profile patch with `[]`; a user or an editor can leave `[ ]` or
    // `[] # empty`. Appending a block sequence after a COMPLETE flow sequence is unparsable YAML,
    // so each spelling must be replaced — matching the literal string let two of them through and
    // the profile patch then failed to parse at boot (G6 review, P2).
    const entry = composePresetEntry(basePatch, delta, identity)
    for (const seed of ['[]', '[ ]', '[] # empty']) {
      const merged = mergePresetRow(seed + '\n', entry, identity.rowId)
      expect(merged.startsWith('- insert:\n'), seed).toBe(true)
      expect(merged, seed).not.toContain('[')
    }
  })

  it('keeps the blank lines inside a block scalar when composing the row', () => {
    // A blank line inside `section: |` is part of the VALUE. Dropping blank lines wholesale
    // flattened a platform base preset's multi-paragraph prompt into one paragraph, and the row is
    // written into the profile patch permanently (G6 review, P1).
    const rows = ['- id: persona', "  name: '@deepseek-ai/dsh-persona'", '  config:', '    section: |', '      first paragraph', '', '      second paragraph', ''].join('\n')
    const row = composePresetRow(rows, '- id: tool-memory\n  name: "@deepseek-ai/dsh-tool-memory"\n', identity)
    expect(row).toContain('first paragraph\n\n')
    expect(row).toContain('second paragraph')
  })
})

describe('resolveBasePresetPatch (G6: the platform base patch)', () => {
  it('probes the module graph before the file candidates, and the profile before the walk-up', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-base-patch-'))
    try {
      const profileDir = join(dir, 'profiles', 'web')
      const fromNodeModules = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', 'ptc.patch.yml')
      const fromGraph = join(dir, 'asar', 'presets', 'ptc.patch.yml')
      await mkdir(dirname(fromNodeModules), { recursive: true })
      await mkdir(dirname(fromGraph), { recursive: true })
      await writeFile(fromNodeModules, '# profile copy\n')
      await writeFile(fromGraph, '# module-graph copy\n')
      // Order: explicit root, then the module graph (the only candidate that reaches inside an
      // Electron app.asar), then the profile's own node_modules, then the walk-up.
      const graph = (specifier: string): string => {
        expect(specifier).toBe('@deepseek-ai/dsh-web-app/presets/ptc.patch.yml')
        return fromGraph
      }
      expect(resolveBasePresetPatch('ptc', { resolve: graph, profileDir, fromDir: dir })).toBe(fromGraph)
      expect(resolveBasePresetPatch('ptc', { profileDir, fromDir: dir })).toBe(fromNodeModules)
      // A module probe that throws is a candidate MISS, not a failure: the file chain still answers.
      const missing = (): string => { throw new Error('ERR_MODULE_NOT_FOUND') }
      expect(resolveBasePresetPatch('ptc', { resolve: missing, profileDir, fromDir: dir })).toBe(fromNodeModules)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('fails loud with every probed candidate and the DSH_AGENT_PRESET_ROOT escape', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-base-patch-miss-'))
    try {
      const profileDir = join(dir, 'profiles', 'web')
      await mkdir(profileDir, { recursive: true })
      const missing = (): string => { throw new Error('ERR_MODULE_NOT_FOUND') }
      let message = ''
      try {
        resolveBasePresetPatch('nope', { resolve: missing, profileDir, bundles: ['@deepseek-ai/dsh-base'], fromDir: dir })
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toContain("cannot find the runtime platform 'nope' preset patch")
      expect(message).toContain(join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', 'nope.patch.yml'))
      expect(message).toContain(join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-base', 'presets', 'nope.patch.yml'))
      expect(message).toContain('node module graph: @deepseek-ai/dsh-web-app/presets/nope.patch.yml')
      expect(message).toContain('DSH_AGENT_PRESET_ROOT')
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('treats an explicit root as an answer: a miss there fails instead of falling back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-base-patch-root-'))
    try {
      const root = join(dir, 'presets')
      const profileDir = join(dir, 'profiles', 'web')
      const profileCopy = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets')
      await mkdir(profileCopy, { recursive: true })
      await mkdir(root, { recursive: true })
      await writeFile(join(profileCopy, 'ptc.patch.yml'), '# profile copy\n')
      await writeFile(join(root, 'ptc.patch.yml'), '# explicit copy\n')
      expect(resolveBasePresetPatch('ptc', { root, profileDir, fromDir: dir })).toBe(join(root, 'ptc.patch.yml'))
      // A root that does not carry the base is a loud failure, never the profile's copy.
      expect(() => resolveBasePresetPatch('standard', { root, profileDir, fromDir: dir }))
        .toThrow(/DSH_AGENT_PRESET_ROOT is set but .*standard\.patch\.yml does not exist/)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})
