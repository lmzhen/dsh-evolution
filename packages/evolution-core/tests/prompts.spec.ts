// @tier fast
import { expect, it } from 'vitest'
import { COMBINED_REVIEW_PROMPT, COMPLETION_SKILL_REVIEW_PROMPT, CURATOR_DRY_RUN_BANNER, CURATOR_PROMPT, DSH_AUTHORING_STANDARDS, MAINTAIN_PROMPT, MEMORY_REVIEW_PROMPT, PROMPT_BUNDLE, PROMPT_BUNDLE_VERSION, SKILL_REVIEW_PROMPT, SKILLS_GUIDANCE, reviewPrompt, verifyPromptBundle } from '@deepseek-ai/dsh-evolution-core'

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

it('skill review prompt keeps neutral decision structure and pass wording', () => {
  expect(SKILL_REVIEW_PROMPT).toContain('A precise no-op is a valid outcome')
  expect(SKILL_REVIEW_PROMPT).toContain('class-level skill')
  expect(SKILL_REVIEW_PROMPT).toContain('references/')
  expect(SKILL_REVIEW_PROMPT).toContain('this review pass')
  expect(SKILL_REVIEW_PROMPT).not.toContain('background review pass')
  expect(SKILL_REVIEW_PROMPT).toContain('Update only skills whose body you have read')
  expect(SKILL_REVIEW_PROMPT).toContain('A new skill has no body to read')
  expect(SKILL_REVIEW_PROMPT).toContain('A one-off environment failure')
  expect(SKILL_REVIEW_PROMPT).toContain('Capture only a reproducible setup or repair procedure')
  expect(SKILL_REVIEW_PROMPT).toContain('A user correction about how a class of task should be done')
  expect(SKILL_REVIEW_PROMPT).toContain('Nothing to save.')
  expect(MEMORY_REVIEW_PROMPT).toContain('durable facts that change future collaboration')
  expect(MEMORY_REVIEW_PROMPT).toContain('Prefer merging or replacing')
})

it('authoring standards put routing metadata in frontmatter', () => {
  expect(DSH_AUTHORING_STANDARDS).toContain('whenToUse:')
})

it('combined review prompt mirrors the same neutral decision structure', () => {
  expect(COMBINED_REVIEW_PROMPT).toContain('## Memory')
  expect(COMBINED_REVIEW_PROMPT).toContain('durable facts that change future collaboration')
  expect(COMBINED_REVIEW_PROMPT).toContain('## Skills')
  expect(COMBINED_REVIEW_PROMPT).toContain('A precise no-op is a valid outcome')
  expect(COMBINED_REVIEW_PROMPT).toContain('A user correction about how a class of task should be done')
})

it('keeps no-op delivery out of the shared decision body', () => {
  expect(SKILL_REVIEW_PROMPT).toContain('If nothing durable exists, say "Nothing to save." and stop.')
  expect(COMPLETION_SKILL_REVIEW_PROMPT).toContain('If nothing durable exists, say "Nothing to save." and stop.')
  expect(COMBINED_REVIEW_PROMPT).toContain('Nothing to save (memory)')
  expect(COMBINED_REVIEW_PROMPT).toContain('continue to the Skills pass')
  expect(COMBINED_REVIEW_PROMPT).toContain('If nothing durable exists in either pass')
  expect(SKILL_REVIEW_PROMPT).toContain('add the SKILL.md line that points to it')
  expect(SKILL_REVIEW_PROMPT).toContain('If a lesson can only live in a protected skill')
  expect(SKILL_REVIEW_PROMPT).toContain('Write skills only through skill_manage')
  expect(SKILL_REVIEW_PROMPT).toContain('search the existing library')
  expect(SKILL_REVIEW_PROMPT).toContain('at least two different future events')
  expect(SKILL_REVIEW_PROMPT).toContain('Any one of these warrants a decision')
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
  // V3 (design §16.2): the B1 clause gained the authoring-band discipline, so the
  // bundle identity moves with it (v18 pinned the step-7 wording).
  expect(PROMPT_BUNDLE_VERSION).toBe(27)
  // v46 S1.12b (finding T3-07): the dry-run banner is model-visible curator text, so it rides
  // the bundle and the digest covers it.
  expect(PROMPT_BUNDLE.prompts['curatorDryRun']).toBe(CURATOR_DRY_RUN_BANNER)
  // The digest covers the new entry: tampering with the banner alone must fail verification.
  const tampered = { ...PROMPT_BUNDLE, prompts: { ...PROMPT_BUNDLE.prompts, curatorDryRun: 'drifted' } }
  expect(verifyPromptBundle(tampered)).toBe(false)
})

it('maintain persona ships in the bundle with signal placeholders (011)', () => {
  expect(PROMPT_BUNDLE.prompts['maintain']).toBe(MAINTAIN_PROMPT)
  expect(MAINTAIN_PROMPT).toContain('{signal:')
  expect(MAINTAIN_PROMPT).toContain('MECHANICAL_FACTS')
})

it('maintain persona v14 carries the guidance clauses pinned by the prompt loops (0.3.7 + 0.3.11 + 0.3.13)', () => {
  // §3 completeness contract: every over signal lands in an item or a note.
  expect(MAINTAIN_PROMPT).toContain('完整性契约')
  expect(MAINTAIN_PROMPT).toContain('禁止静默省略')
  // §4 workflow: mandatory reads + honest tool-fact reporting (not "无法读取").
  expect(MAINTAIN_PROMPT).toContain('读取失败必须报告工具返回的事实')
  // §5-B1 three-question anchor test + 锚≠可读 + no is_override on the anchor path.
  expect(MAINTAIN_PROMPT).toContain('三问判据')
  expect(MAINTAIN_PROMPT).toContain('锚≠可读')
  expect(MAINTAIN_PROMPT).toContain('锚不使用 is_override')
  // §5-B2 pointer_missing one-way semantics (0.3.11).
  expect(MAINTAIN_PROMPT).toContain('缺失指针=支持文件存在、正文无引用')
  // §5-B4 full-count reporting.
  expect(MAINTAIN_PROMPT).toContain('全量口径')
  // §5-B5 nature classification with a strict semi-mechanical third-class gate (0.3.11).
  expect(MAINTAIN_PROMPT).toContain('第三类门槛')
  expect(MAINTAIN_PROMPT).toContain('半机械')
  expect(MAINTAIN_PROMPT).toContain('试写')
  expect(MAINTAIN_PROMPT).toContain('分类特征')
  // §6 confidence downgrade rule + pre-submit checklist.
  expect(MAINTAIN_PROMPT).toContain('confidence 降档规则')
  expect(MAINTAIN_PROMPT).toContain('提交前自查')
  // §7 reviewer perspective (independent judgment, no self-narrative as evidence).
  expect(MAINTAIN_PROMPT).toContain('审查者视角')
  // §6 language rule follows the library (0.3.13 de-coupling: the previous
  // hardcoded '（中文）' was the only dataset-visible content coupling and
  // would mis-drive output language on a non-Chinese library).
  expect(MAINTAIN_PROMPT).toContain('与库正文语言一致')
  expect(MAINTAIN_PROMPT).not.toContain('（中文）')
})

it('reviewPrompt keeps inject kind-specific and includes memory in background skill reviews', () => {
  expect(reviewPrompt('memory')).toBe(MEMORY_REVIEW_PROMPT)
  expect(reviewPrompt('skill')).toBe(SKILL_REVIEW_PROMPT)
  expect(reviewPrompt('combined')).toBe(COMBINED_REVIEW_PROMPT)
  expect(reviewPrompt('memory', 'aux')).toBe(MEMORY_REVIEW_PROMPT)
  expect(reviewPrompt('skill', 'aux')).toBe(COMBINED_REVIEW_PROMPT)
  expect(reviewPrompt('combined', 'aux')).toBe(COMBINED_REVIEW_PROMPT)
  expect(COMBINED_REVIEW_PROMPT).toContain('## Memory')
})

it('skill review keeps read-before-write and the create exemption neutral', () => {
  expect(SKILL_REVIEW_PROMPT).toContain('Update only skills whose body you have read in this review pass')
  expect(SKILL_REVIEW_PROMPT).toContain('A new skill has no body to read')
  expect(COMBINED_REVIEW_PROMPT).toContain('Update only skills whose body you have read in this review pass')
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
