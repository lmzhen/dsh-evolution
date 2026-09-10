/* WC (0.3.56): the N-5 escape reads through the single env module. */
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
  return injectCatalogDescriptionCap(`${standardComposition.replace(/\s+$/, '')}\n\n${deltaComposition.trim()}\n`)
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
 * install-layered.mjs ships the byte-identical `injectToolSkillCap`.
 */
function injectCatalogDescriptionCap(composition: string): string {
  const lines = composition.split('\n')
  let found = false
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^- id:\s*tool-skill\s*$/.test(lines[i] ?? '')) continue
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
      if (/^ {2}config:(\s|$)/.test(next)) hasConfig = true
      end = j
    }
    if (hasConfig) continue
    lines.splice(end + 1, 0,
      '  # V10-14: Hermes 60-char catalog cap — injected by the preset composer (P1-2);',
      '  # this preset-scope row is the session-visible instance and no profile',
      '  # patch can reach it. Remove only to run the platform default (500).',
      '  config:',
      '    catalogDescriptionMaxLength: 60',
    )
    i = end + 5
  }
  if (!found) {
    console.warn('evolution preset composition: warning — no `- id: tool-skill` row in the composed preset; the 60-char catalog cap was NOT injected (platform renamed the row? reconcile with the delta)')
  }
  return lines.join('\n')
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
