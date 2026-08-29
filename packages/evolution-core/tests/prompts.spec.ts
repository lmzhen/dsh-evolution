import { expect, it } from 'vitest'
import { COMBINED_REVIEW_PROMPT, COMBINED_REVIEW_PLAN_PROMPT, CURATOR_PROMPT, DSH_AUTHORING_STANDARDS, MEMORY_REVIEW_PROMPT, PROMPT_BUNDLE, PROMPT_BUNDLE_VERSION, SKILL_REVIEW_PLAN_PROMPT, SKILL_REVIEW_PROMPT, SKILLS_GUIDANCE, reviewPrompt, verifyPromptBundle } from '@deepseek-ai/dsh-evolution-core'

it('verifyPromptBundle accepts the canonical bundle', () => {
  expect(verifyPromptBundle(PROMPT_BUNDLE)).toBe(true)
})

it('verifyPromptBundle rejects a bundle that drifted off the pinned id/version', () => {
  const drifted = { ...PROMPT_BUNDLE, id: 'dsh-evolution@999' }
  expect(verifyPromptBundle(drifted)).toBe(false)
  const driftedVersion = { ...PROMPT_BUNDLE, version: PROMPT_BUNDLE_VERSION + 1 }
  expect(verifyPromptBundle(driftedVersion)).toBe(false)
})

it('verifyPromptBundle rejects tampered prompt content', () => {
  const tampered = {
    ...PROMPT_BUNDLE,
    prompts: { ...PROMPT_BUNDLE.prompts, skill: (PROMPT_BUNDLE.prompts['skill'] ?? '') + '\n# injected' },
  }
  expect(verifyPromptBundle(tampered)).toBe(false)
})

// Hermes-alignment contract (2026-08-29): the operational guidance the model
// follows must keep the original's structure — these substrings are the
// load-bearing instruction points, not prose. A future simplification that
// drops any of them fails here first.
it('skill review prompt keeps the Hermes guiding structure (alignment contract)', () => {
  expect(SKILL_REVIEW_PROMPT).toContain('A pass that does nothing is a missed learning opportunity')
  expect(SKILL_REVIEW_PROMPT).toContain('FIRST-CLASS skill signals')
  expect(SKILL_REVIEW_PROMPT).toContain('UPDATE A CURRENTLY-LOADED SKILL')
  expect(SKILL_REVIEW_PROMPT).toContain('session artifact')
  expect(SKILL_REVIEW_PROMPT).toContain('how to do this class of task for this user')
  // Pinned semantics must match the DSH guard (read-only within review) — not
  // the Hermes "pin only blocks the curator" wording.
  expect(SKILL_REVIEW_PROMPT).toContain('read-only to THIS background review pass')
  expect(SKILL_REVIEW_PROMPT).toContain('Two-tier deposition discipline')
  expect(MEMORY_REVIEW_PROMPT).toContain('Has the user revealed things about themselves')
})

it('combined review prompt mirrors the same guidance and two-tier rule', () => {
  expect(COMBINED_REVIEW_PROMPT).toContain('Frustration is a FIRST-CLASS skill signal')
  expect(COMBINED_REVIEW_PROMPT).toContain('Body density IS reuse rate')
})

it('curator prompt keeps package integrity and the consolidated/pruned block contract', () => {
  expect(CURATOR_PROMPT).toContain('UMBRELLA-BUILDING')
  expect(CURATOR_PROMPT).toContain('Package integrity')
  expect(CURATOR_PROMPT).toContain('consolidations with into:')
  expect(CURATOR_PROMPT).toContain('consolidations:')
  expect(CURATOR_PROMPT).toContain('prunings:')
  expect(CURATOR_PROMPT).toContain('scheduled-task-referenced')
  // The cluster expectation must stay library-scale adaptive, not a hard count
  // that overfits a large original-library collection (P1a).
  expect(CURATOR_PROMPT).toContain('scales with the library')
  // M-1 (v3 audit): the curation channel is a NOMINATOR with no tools — the
  // operative toolset section must be gone and a hard output constraint must
  // replace it.
  expect(CURATOR_PROMPT).toContain('NOMINATOR, not an executor')
  expect(CURATOR_PROMPT).toContain('Return ONLY the YAML block')
  expect(CURATOR_PROMPT).not.toContain('Your toolset:')
  expect(PROMPT_BUNDLE.prompts['curator']).toBe(CURATOR_PROMPT)
  expect(PROMPT_BUNDLE_VERSION).toBe(6)
})

it('channel variants carry the subagent deliverable limit (M-2)', () => {
  expect(SKILL_REVIEW_PLAN_PROMPT).toContain('CHANNEL (subagent)')
  expect(SKILL_REVIEW_PLAN_PROMPT).toContain('never narrate actions you took')
  expect(COMBINED_REVIEW_PLAN_PROMPT).toContain('CHANNEL (subagent)')
  // The whole policy survives in the plan variant (it is a superset).
  expect(SKILL_REVIEW_PLAN_PROMPT).toContain('FIRST-CLASS skill signals')
  expect(reviewPrompt('skill', 'plan')).toBe(SKILL_REVIEW_PLAN_PROMPT)
  expect(reviewPrompt('skill', 'agent')).toBe(SKILL_REVIEW_PROMPT)
  expect(reviewPrompt('combined', 'plan')).toBe(COMBINED_REVIEW_PLAN_PROMPT)
  // Both variants are covered by the bundle digest.
  expect(PROMPT_BUNDLE.prompts['skillPlan']).toBe(SKILL_REVIEW_PLAN_PROMPT)
  expect(PROMPT_BUNDLE.prompts['combinedPlan']).toBe(COMBINED_REVIEW_PLAN_PROMPT)
})

it('authoring standards carry the colon-quote and privacy motive guarantees', () => {
  expect(DSH_AUTHORING_STANDARDS).toContain('wrap the whole value in double quotes')
  expect(DSH_AUTHORING_STANDARDS).toContain('privacy leak')
  expect(DSH_AUTHORING_STANDARDS).toContain('Learn workflow')
})

it('skills guidance section is the Hermes SKILLS_GUIDANCE analogue (save + immediate patch)', () => {
  expect(SKILLS_GUIDANCE).toContain('5+ tool calls')
  expect(SKILLS_GUIDANCE).toContain("don't wait to be asked")
  expect(PROMPT_BUNDLE.prompts['skillsGuidance']).toBe(SKILLS_GUIDANCE)
})
