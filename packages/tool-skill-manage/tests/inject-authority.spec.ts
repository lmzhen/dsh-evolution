// @tier fast
import { expect, it } from 'vitest'
import * as ToolSkillManage from '../src/index.ts'

it('keeps the mutation authority out of the required inject list', () => {
  // Cordis inject names are required: a missing service keeps the fiber INACTIVE, which
  // would drop `skill_manage` from every composition that mounts this row without the
  // authority (agent-plane-only installs and the specs that mount the tool alone).
  // The write lock and the home fence are resolved per write instead.
  expect(ToolSkillManage.inject).not.toContain('evolutionMutationAuthority')
})

it('still declares the services the tool cannot run without', () => {
  expect(ToolSkillManage.inject).toEqual(expect.arrayContaining(['tools', 'skillUsage', 'evolutionIo']))
})
