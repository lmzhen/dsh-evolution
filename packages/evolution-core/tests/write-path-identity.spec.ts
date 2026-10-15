// @tier pre-tag
/** G1/1.1: both entry points land the body they were given, unchanged - and the origin reaches the event.
 *
 * What this guards: the tool face and the review face go through ONE WriteAuthority, so a body must not
 * gain a reformatting, a trailing newline or a frontmatter touch on one path and not the other. The two
 * bodies here come from ONE template and differ only in the `name:` line, which the validator requires to
 * match the target skill (frontmatter.ts:628) - so "the same body" is stated as "each face wrote exactly
 * what it was handed", which is the property that can actually break.
 *
 * What it deliberately does NOT assert: that two DIFFERENT origins produce identical bytes. Origin reaches
 * the mutation event (skill-store.ts:892), not the file, so that comparison would pass whatever the code
 * did - the second half below (the emitted origins must differ) is what keeps the first half meaningful. */
import { expect, it } from 'vitest'
import { SkillLibrary, authorityFrom } from '../src/index.ts'
import { fakeIo } from '../../test-support/fake-io.ts'

/** One template; only the name line differs, because the validator insists it matches the skill. */
const BODY = (name: string): string => '---\nname: ' + name + '\ndescription: Shared.\n---\n\nbody line\n'

it('G1/1.1: two entry points write the same bytes, and origin reaches the event', async () => {
  const io = fakeIo()
  const seen: string[] = []
  const onMutation = (event: { origin?: string }): void => { seen.push(String(event.origin)) }
  const toolFace = new SkillLibrary('/skills', io, undefined, onMutation, undefined, undefined, authorityFrom({ origin: 'foreground' }))
  const reviewFace = new SkillLibrary('/skills', io, undefined, onMutation, undefined, undefined, authorityFrom({ origin: 'background_review' }))
  const toolBody = BODY('tool-body')
  const reviewBody = BODY('review-body')
  expect((await toolFace.create('tool-body', toolBody, 'foreground')).ok).toBe(true)
  expect((await reviewFace.create('review-body', reviewBody, 'background_review')).ok).toBe(true)
  // Each face lands the bytes it was handed: no reformatting, no added newline, no frontmatter touch.
  expect(await io.readText('/skills/tool-body/SKILL.md')).toBe(toolBody)
  expect(await io.readText('/skills/review-body/SKILL.md')).toBe(reviewBody)
  // Non-vacuous: the origin really is consumed - inside the store, by writeProtection (skill-store.ts:1132)
  // and by the authorship audit, NOT by the file or the mutation event (the event carries no origin field).
  // The sharp pair: the review origin may not write a pinned skill, the foreground one may.
  await toolFace.setPinned('tool-body', true, 'foreground')
  const refused = await reviewFace.update('tool-body', BODY('tool-body'), 'background_review')
  expect(refused.ok).toBe(false)
  expect(refused.message).toContain('pinned')
  const allowed = await toolFace.update('tool-body', BODY('tool-body'), 'foreground')
  expect(allowed.ok).toBe(true)
})
