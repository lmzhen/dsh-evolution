// @tier pre-tag
/** G1/1.8 E-08: `entryName` must be INJECTIVE. Today it is not - maintain/skill subcommands derive their
 * parent name and `flagsOf` finds an entry with `.find(...)`, the FIRST match, so every flag lookup for
 * those names silently sees only the first entry (nine collisions).
 *
 * Was `it.fails` while the criterion was today-red; flipped when the hierarchical key landed. The earlier
 * attempt was reverted because the key rename also moved what `flagsOf(preset)` resolves to, and the preset
 * dispatch branch reads exactly that - the one-line call fix is why this landed the second time. */
import { expect, it } from 'vitest'
import { COMMAND_ENTRIES, entryName } from '../src/registry.ts'

// Flipped from `it.fails` when the hierarchical key landed: the criterion is now satisfied, and the flip
// is itself the evidence (family idiom).
it('G1/1.8 E-08: the command table identity key is injective', () => {
  const seen = new Map<string, string>()
  const collisions: string[] = []
  for (const entry of COMMAND_ENTRIES) {
    const key = entryName(entry)
    const first = seen.get(key)
    if (first !== undefined) collisions.push(key + ': ' + first + ' vs ' + entry.usage)
    else seen.set(key, entry.usage)
  }
  expect(collisions).toEqual([])
})
