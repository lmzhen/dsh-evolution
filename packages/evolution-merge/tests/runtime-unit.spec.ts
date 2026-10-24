// @tier pre-tag
import { expect, it } from 'vitest'
import { DEFAULT_SKILL_LIMITS, SkillLibrary, UnitTransactions, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { unitFor } from '../src/runtime.ts'

it('constructs UnitTransactions for a real SkillLibrary and skips fakes', async () => {
  const home = await tempRoot('dsh-runtime-unit-')
  const io = nodeEvolutionIo()
  const real = new SkillLibrary(home, io, DEFAULT_SKILL_LIMITS)
  expect(unitFor({ io, home, skills: real, now: () => 1 } as never)).toBeInstanceOf(UnitTransactions)
  expect(unitFor({ io, home, skills: {} as never, now: () => 1 } as never)).toBeUndefined()
})
