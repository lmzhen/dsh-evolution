// @tier pre-tag
/** G1/1.3 (S3-02): the authority behind a write must not hang on a TIMING mark. The plan names the
 * criterion exactly: "with the gate foreground short-circuit removed, the two gates must go red" - i.e.
 * some non-foreground path must actually reach them.
 *
 * Two halves, both from ONE table (`resolveOrigins`):
 *  A. a review-pipeline LIBRARY write declares its own origin (the review IS the review channel), so it
 *     reaches the gates whether or not the session mark was ever set;
 *  B. a TOOL running inside a review SUBAGENT session is resolved from the platform header (`origin:
 *     subagent`, set by the platform own child-agent), so the mark being skipped cannot downgrade it.
 * This used to fail: the review background write constructed its library as `foreground`, the one value
 * that switches POLICY_PROTECTION, read-before-write, the .pinned guard, the authorship mark and staging
 * off. */
import { expect, it } from 'vitest'
import { resolveExecOrigins, resolveOrigins } from '../src/skill-store.ts'

it('G1/1.3: the review pipeline library write is NOT foreground, mark or no mark', () => {
  expect(resolveOrigins(undefined, true)).toEqual({ approval: 'background_review', library: 'background_review' })
})

it('G1/1.3: a tool inside a review subagent session resolves from the header, not from the mark', () => {
  const subagentSession = { id: 'never-marked-session', header: { origin: 'subagent' } }
  expect(resolveExecOrigins({ agent: { session: subagentSession } })).toEqual({ approval: 'background_review', library: 'subagent' })
})
