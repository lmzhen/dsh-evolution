import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EvolutionIoRegistry from '@deepseek-ai/dsh-evolution-io'
import * as NodeIo from '@deepseek-ai/dsh-evolution-io-node'
import EvolutionCurator from '../src/index.ts'

// minIdleHours 0 = "no idle gate" (the gate guard is `> 0`); bootGraceSeconds 0
// = "no boot grace" (setTimeout(0)). Every other numeric field is a threshold /
// interval where 0 is never a legitimate meaning, so it clamps to at least 1.
const MIN0 = ['minIdleHours', 'bootGraceSeconds']
const MIN1 = ['intervalHours', 'staleAfterDays', 'archiveAfterDays', 'qualityWarnStaleAfterDays', 'curatorReviewMaxTokens', 'healthSoftBodyChars', 'healthStampDensityPerKb', 'healthChurnMinPatches']
const ALL = [...MIN0, ...MIN1]

describe('evolution-curator G3.1 numeric clamping', () => {
  const parse = (input: unknown): unknown => (EvolutionCurator.Config as unknown as (i: unknown) => unknown)(input)

  it('schema: 0 is retained for min-0 fields, rejected for min-1 fields (.min matrix)', () => {
    for (const field of MIN0) {
      expect((parse({ [field]: 0 }) as Record<string, number>)[field], `${field} 0`).toBe(0)
      expect(() => parse({ [field]: -1 }), `${field} -1`).toThrow()
    }
    for (const field of MIN1) {
      expect(() => parse({ [field]: 0 }), `${field} 0`).toThrow()
      expect(() => parse({ [field]: -1 }), `${field} -1`).toThrow()
    }
  })

  it('schema: NaN and +Infinity pass through every numeric field (assembly clamps them)', () => {
    for (const field of ALL) {
      const nan = (parse({ [field]: NaN }) as Record<string, number>)[field]
      expect(Number.isNaN(nan), `${field} NaN`).toBe(true)
      const inf = (parse({ [field]: Infinity }) as Record<string, number>)[field]
      expect(inf, `${field} Inf`).toBe(Infinity)
    }
  })

  it('schema: -Infinity is rejected by the .min bound (it is below every field minimum)', () => {
    for (const field of ALL) {
      expect(() => parse({ [field]: -Infinity }), `${field} -Inf`).toThrow()
    }
  })

  it('assembly clamps an out-of-range health limit to the default (health view)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-curator-clamp-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const ctx = new Context()
      await ctx.plugin(EvolutionIoRegistry)
      await ctx.plugin(NodeIo)
      // Direct construction bypasses the schema, so healthSoftBodyChars: 0 is
      // exactly the value the assembly clamp must correct (-> default 40_000).
      const curator = new EvolutionCurator(ctx, { healthSoftBodyChars: 0, autoStart: false })
      const skills = curator.skills
      await skills.create('fat-skill', `---\nname: fat-skill\ndescription: f\n---\n\n${'x'.repeat(2_400)}\n`, 'foreground')
      const rows = await curator.healthView()
      // 2_400 chars < the 40_000 default: healthy, so NOT flagged. If the clamp
      // had left 0 in place, every body would be flagged "above soft limit".
      expect(rows.find(row => row.name === 'fat-skill')).toBeUndefined()
      curator.stop()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  })
})
