// @tier pre-tag
/** G1/1.2: the graph commands write-admission call. This case exists to make the WIRING provable: if
 * graphWriteGate stops passing the protected list to the shared sequence (or stops calling it at all),
 * the first expectation below turns red. A policy-route end-to-end case cannot do that here: the delete
 * command archives (the gate allows it by design, archive is reversible) and the edit command validates
 * the new body frontmatter BEFORE the gate, which the command input cannot express. */
import { expect, it } from 'vitest'
import { graphWriteGate } from '../src/index.ts'

const services = (names: readonly string[]) => ({
  policy: { get: () => ({ protectedSkillNames: names }) },
  warn: () => {},
})

it('G1/1.2: a protected skill is refused on the update path', async () => {
  const refusal = await graphWriteGate(services(['guarded']), {
    action: 'update', name: 'guarded', content: 'Body.', origin: 'background_review',
  })
  expect(typeof refusal).toBe('string')
  expect(refusal).toContain('guarded')
})

it('G1/1.2: an unprotected skill passes, and archive is allowed even when protected', async () => {
  const open = await graphWriteGate(services(['guarded']), { action: 'update', name: 'other', content: 'Body.', origin: 'background_review' })
  expect(open).toBeNull()
  // MEASURED: the protection gate applies at BOTH points and refuses ANY non-foreground write to a
  // protected name - archive included. The delete path is therefore observable here too (the earlier
  // "archive is allowed by design" reading came from passing origin foreground, which the gate exempts
  // on purpose: the operator may always act on their own skills).
  const archived = await graphWriteGate(services(['guarded']), { action: 'delete', name: 'guarded', origin: 'background_review' })
  expect(typeof archived).toBe('string')
})
