#!/usr/bin/env node
/**
 * lib-health-corpus.mjs (G4/S2): the ONE corpus reader for the health calibration.
 *
 * Why it exists: the evolution-core health-baseline SPEC used to read the two skill corpora AND
 * write the gate's input artifact (guarded by the spec write flag). A test producing a gate's
 * input is the layering defect this group removes: the producer (gen-health-baseline.mjs) now
 * owns the write, the spec keeps the assertions, and both read the corpora through THIS file so
 * the numbers cannot come from two implementations.
 *
 * The reader is deliberately forgiving and LOUD about absence: a missing corpus root yields an
 * empty list (recorded as 0 in the artifact), never a fabricated skill.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The two corpus roots, overridable by env (a machine without them yields empty corpora). */
export function corpusRoots(env = process.env) {
  const home = homedir().replace(/\\/g, '/')
  return [
    { corpus: 'user', root: env.DSH_USER_SKILLS ?? home + '/.dsh/skills' },
    { corpus: 'platform', root: env.DSH_PLATFORM_SKILLS ?? home + '/.dsh/platform-skills' },
  ]
}

/** The facts the calibration consumes for one corpus root, in the engine's CorpusSkill shape. */
export function readCorpusSkills(corpus, root) {
  if (!existsSync(root)) return []
  const out = []
  for (const name of readdirSync(root)) {
    const skillFile = join(root, name, 'SKILL.md')
    if (!existsSync(skillFile) || !statSync(skillFile).isFile()) continue
    const bodyText = readFileSync(skillFile, 'utf8')
    const refs = join(root, name, 'references')
    const supportFiles = existsSync(refs) ? readdirSync(refs).filter((file) => file.endsWith('.md') && !file.startsWith('_')).length : 0
    out.push({
      name,
      corpus,
      facts: {
        skillName: name,
        dims: {
          bodyChars: bodyText.length,
          bodyTokens: Math.round(bodyText.length / 4),
          stampDensityPerKb: null,
          supportGroups: supportFiles > 0 ? 1 : 0,
          supportFiles,
          churnPatches: null,
          churnReads: null,
        },
        softLineChars: 24_000,
        overSoftLine: bodyText.length >= 24_000,
        overTwiceSoftLine: bodyText.length >= 48_000,
        stampLimitPerKb: 1,
        churnMinPatches: 20,
        readable: true,
      },
    })
  }
  return out
}

/** Both corpora, in one call (the producer and the spec both start here). */
export function collectCorpusSkills(env = process.env) {
  const roots = corpusRoots(env)
  const skills = roots.flatMap((entry) => readCorpusSkills(entry.corpus, entry.root))
  return { roots, skills }
}
