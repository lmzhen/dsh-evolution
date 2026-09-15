import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { PendingRecord } from '@deepseek-ai/dsh-evolution-state-storage'
import { tempRoot } from '../../test-support/temp-home.ts'
import { mountStateStack } from '../../test-support/state-stack.ts'

// v43 S1-9 (the deeper half of F-2): the four pending-state mutations used to
// leave the gate-drop set empty, because only the RETIREMENT path handed
// jsonTransact the onGateDrop reporter. A record whose fields go bad is then
// quarantined away from `current`, and its legacy pending twin — old but valid
// bytes — was merged back and became claimable: an approve would replay a write
// that had already landed. This spec drives claimPending DIRECTLY, with no
// listPending first: the READ path's readJson also fills the drop set, so a
// preceding read would mask the mutation-path gap this step closes.
describe('pending gate drops exclude the legacy twin on the WRITE path (S1-9)', () => {
  it('claimPending refuses the legacy twin of a record the field gate dropped', async () => {
    const root = await tempRoot('dsh-json-gatedrop-')
    const ctx = await mountStateStack(root)
    const provider = ctx.evolutionStateStorage.provider('json')
    const io = ctx.evolutionIo.provider('node')

    // The legacy file holds a VALID pending twin — the ghost that must not return.
    const legacy: Record<string, PendingRecord> = {
      ghost: { id: 'ghost', kind: 'skill', summary: 'awaiting approval', args: {}, createdAt: 'now', status: 'pending' },
    }
    await io.writeText(join(root, 'pending.json'), JSON.stringify(legacy))
    // The current file holds the SAME id with fields the per-record gate rejects,
    // so the gate drops it and `current` no longer carries the id at all.
    const landed = {
      ghost: { id: 'ghost', kind: 'skill', summary: 'landed already', args: {}, createdAt: 'now', status: 'bogus' },
    }
    await io.writeText(join(root, 'pending-state.json'), JSON.stringify(landed))

    const claimed = await provider.claimPending('ghost', 'claim-1')
    expect(claimed).toBeNull()
  })
})
