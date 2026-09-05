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
  if (collisions.length > 0 && process.env.DSH_EVOLUTION_ALLOW_ROW_COLLISIONS !== '1') {
    throw new Error(`evolution preset composition: delta rows collide with runtime standard rows: ${collisions.join(', ')}`)
  }
  if (collisions.length > 0) {
    console.warn(`evolution preset composition: warning — delta rows collide with standard rows (${collisions.join(', ')}); keeping both (DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1)`)
  }
  return `${standardComposition.replace(/\s+$/, '')}\n\n${deltaComposition.trim()}\n`
}

function compositionRowIds(composition: string): Set<string> {
  const ids = new Set<string>()
  for (const line of composition.split('\n')) {
    const match = /^- id:\s*(\S+)/.exec(line)
    if (match) ids.add(match[1] ?? '')
  }
  return ids
}
