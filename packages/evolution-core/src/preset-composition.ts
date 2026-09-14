/* WC (0.3.56): the N-5 escape reads through the single env module. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { allowRowCollisions } from './env.ts'

/**
 * Build the user-root Evolution preset composition from the RUNTIME platform's
 * `standard` preset rows plus the evolution delta rows (P1-1 follow-up,
 * 0.3.15): the agent-preset registry mounts ONE composition file verbatim, so
 * a delta-only `agent.cordis.yml` would produce an agent carrying only the
 * delta rows.
 *
 * Same contract as `install-layered.mjs` `generateAgentPreset` (the source
 * install path) — installer.spec pins byte parity between the two, and both
 * apply the identical row-collision contract: a delta id that overlaps a
 * standard row id fails loud by default, and `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1`
 * downgrades it to a warning that keeps both (the row mounts twice).
 *
 * V10-14 / 0.3.53 (P1-2): BOTH composers now inject the Hermes 60-char catalog
 * cap onto the standard-sourced `- id: tool-skill` row of the composed preset
 * (see injectCatalogDescriptionCap) — the session-visible tool-skill instance
 * mounts in the preset's own standing scope, where no profile-root patch can
 * reach it. 0.3.53 moved the injection INTO the composer so
 * `/evolution preset install` (the npm user's only preset path) gets it too;
 * install-layered applies the byte-identical rule, pinned by installer.spec.
 *
 * Row ids are read from `- id:` lines; an id present in both fragments would
 * mount twice and could shadow the platform row, so it fails loud.
 * @param standardComposition - the runtime `standard` preset composition.
 * @param deltaComposition - the evolution delta fragment.
 * @returns the composed preset composition (standard rows first, then delta).
 */
export function composePresetComposition(standardComposition: string, deltaComposition: string): string {
  const standardIds = compositionRowIds(standardComposition)
  const deltaIds = compositionRowIds(deltaComposition)
  const collisions = [...deltaIds].filter(id => standardIds.has(id)).sort()
  if (collisions.length > 0 && !allowRowCollisions()) {
    throw new Error(`evolution preset composition: delta rows collide with runtime standard rows: ${collisions.join(', ')}`)
  }
  if (collisions.length > 0) {
    console.warn(`evolution preset composition: warning — delta rows collide with standard rows (${collisions.join(', ')}); keeping both (DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1)`)
  }
  return applyRowOverrides(`${standardComposition.replace(/\s+$/, '')}\n\n${deltaComposition.trim()}\n`)
}

/**
 * V10-14 (P1-2), 0.3.53: inject the Hermes 60-char catalog cap onto the
 * standard-sourced `- id: tool-skill` row of a composed preset.
 *
 * The session-visible `tool-skill` instance mounts in the agent preset's own
 * standing scope; a profile-root patch (evolution-host/cordis.patch.yml)
 * cannot reach it, so without this injection the catalog's read side runs the
 * platform default (500). Text-level rewrite in the same line-scan style as
 * compositionRowIds (no YAML library):
 *   - idempotent: a tool-skill item that already carries a `config:` key is
 *     left byte-identical, so re-running the installer never doubles the key;
 *   - the injected block carries a marker comment so a diff of the generated
 *     preset can tell composer-owned text from platform text;
 *   - a composition WITHOUT a tool-skill row is returned unchanged with a
 *     one-time warning (a renamed platform row must not brick the install,
 *     but the missed cap must be observable).
 * The source installer reads the SAME table (`row-overrides.json`) through its
 * own `injectToolSkillCap`, so the two paths cannot diverge (0.3.77).
 */
/** One entry of the shared override table (see {@link loadRowOverrides}). */
interface RowOverride {
  /** Top-level row id this override targets (`- id: <row>`). */
  row: string
  /** The child key whose presence makes the override inert (idempotence). */
  key: string
  /** Rendered, already-indented YAML lines to ensure inside the row. */
  lines: string[]
  /** Warning tail shared by both consumers; each prefixes its own logger tag. */
  missingReason: string
}

/**
 * One table, two generation paths: `row-overrides.json` at the PACKAGE ROOT
 * states what a generated preset must carry beyond the platform composition,
 * and the source installer (`scripts/install-layered.mjs`) reads the same file.
 * The path resolves from both `src/` and the built `lib/`, which is why the
 * file sits at the root and ships in `files`.
 *
 * Before 0.3.77 each side carried its own hand-kept copy of this table; they
 * happened to stay byte-identical, which is exactly the kind of agreement no
 * test can keep — the entries are now data, and a divergence is impossible.
 */
const ROW_OVERRIDES_URL = new URL('../row-overrides.json', import.meta.url)
let cachedOverrides: RowOverride[] | undefined

/**
 * Read and validate the shared override table.
 * @returns the entries, in file order. A malformed table fails LOUD: a composer
 * that silently skipped an entry would ship a preset running the platform
 * default while nothing downstream reported it.
 */
export function loadRowOverrides(): RowOverride[] {
  if (cachedOverrides !== undefined) return cachedOverrides
  const parsed: unknown = JSON.parse(readFileSync(fileURLToPath(ROW_OVERRIDES_URL), 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error('evolution-core: row-overrides.json must be an array of override entries')
  }
  const entries: RowOverride[] = []
  for (const [index, entry] of parsed.entries()) {
    const candidate = entry as Partial<RowOverride> | null
    if (candidate === null || typeof candidate !== 'object'
      || typeof candidate.row !== 'string' || candidate.row === ''
      || typeof candidate.key !== 'string' || candidate.key === ''
      || !Array.isArray(candidate.lines) || candidate.lines.some(line => typeof line !== 'string')
      || typeof candidate.missingReason !== 'string') {
      throw new Error(`evolution-core: row-overrides.json entry ${index} is malformed (row/key/lines/missingReason are required)`)
    }
    entries.push({ row: candidate.row, key: candidate.key, lines: candidate.lines, missingReason: candidate.missingReason })
  }
  cachedOverrides = entries
  return entries
}

/**
 * Ensure every {@link RowOverride} inside its target row.
 *
 * Key-level by construction: we INSERT the override's own lines and leave a row
 * that already carries the key byte-identical, so a re-run never doubles a key.
 * This is the deliberate opposite of the platform's patch layers, where an
 * override REPLACES `config` wholesale — the difference is why the composer can
 * add a key without erasing the platform's own config defaults.
 */
function applyRowOverrides(composition: string, overrides: RowOverride[] = loadRowOverrides()): string {
  let lines = composition.split('\n')
  for (const override of overrides) {
    lines = applyOneOverride(lines, override)
  }
  return lines.join('\n')
}

function applyOneOverride(lines: string[], override: RowOverride): string[] {
  const rowRe = new RegExp('^- id:\\s*' + override.row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$')
  let found = false
  for (let i = 0; i < lines.length; i += 1) {
    if (!rowRe.test(lines[i] ?? '')) continue
    found = true
    // Walk the item's continuation lines (indented) up to the next item or
    // top-level line; a blank line terminates the item block.
    let end = i
    let hasConfig = false
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? ''
      if (next.trim() === '') break
      if (!/^\s/.test(next)) break
      // v22 (PRE-3): anchor `config:` to the ITEM's own child indent (exactly
      // two spaces — the `- id:` row sits at column 0). The old `\s+` form
      // matched a `config:` at ANY depth inside the item's sub-maps, so a
      // platform preset that grew a nested config map silently skipped the
      // cap injection with no diagnostic (the missed-cap warn fires only when
      // the ROW itself is absent).
      if (new RegExp('^ {2}' + override.key + ':(\\s|$)').test(next)) hasConfig = true
      end = j
    }
    if (hasConfig) continue
    lines.splice(end + 1, 0, ...override.lines)
    i = end + override.lines.length
  }
  if (!found) console.warn('evolution preset composition: warning — ' + override.missingReason)
  return lines
}

function compositionRowIds(composition: string): Set<string> {
  const ids = new Set<string>()
  for (const line of composition.split('\n')) {
    const match = /^- id:\s*(\S+)/.exec(line)
    // C-25 (v10 audit): the old `match[1] ?? ''` was a dead expression (the
    // regex guarantees group 1 exists), and an empty id would have poisoned
    // the collision set anyway. Delta-INTERNAL duplicate ids remain
    // undetected by design (deferred — see the v10 ledger).
    const id = match?.[1]
    if (id) ids.add(id)
  }
  return ids
}
