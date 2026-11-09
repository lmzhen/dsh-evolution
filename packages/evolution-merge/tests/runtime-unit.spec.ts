// @tier pre-tag
import { expect, it } from 'vitest'
import { DEFAULT_SKILL_LIMITS, SkillLibrary, nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { MergeUnitTransactions } from '../src/unit-protocol.ts'
import { skillLibraryUnitBackend } from '../src/skill-library-unit-backend.ts'
import { tempRoot } from '../../test-support/temp-home.ts'
import { unitFor } from '../src/runtime.ts'

it('constructs MergeUnitTransactions for a real SkillLibrary and skips fakes', async () => {
  const home = await tempRoot('dsh-runtime-unit-')
  const io = nodeEvolutionIo()
  const real = new SkillLibrary(home, io, DEFAULT_SKILL_LIMITS)
  expect(unitFor({ io, home, skills: real, now: () => 1 } as never)).toBeInstanceOf(MergeUnitTransactions)
  expect(unitFor({ io, home, skills: {} as never, now: () => 1 } as never)).toBeUndefined()
})
