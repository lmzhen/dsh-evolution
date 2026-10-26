/** Pure pair state machine. Every legal transition is explicit; no IO. */
import type { PairEvent, PairSnapshot, PairState } from './model.ts'

export type TransitionErrorCode = 'illegal-transition' | 'version-conflict' | 'invalid-event'
export type TransitionResult =
  | { readonly ok: true; readonly snapshot: PairSnapshot }
  | { readonly ok: false; readonly code: TransitionErrorCode; readonly message: string }

function fail(code: TransitionErrorCode, message: string): TransitionResult {
  return { ok: false, code, message }
}

function clean(snapshot: PairSnapshot): Omit<PairSnapshot, 'failure' | 'closedReason'> {
  const { failure, closedReason, ...rest } = snapshot
  void failure
  void closedReason
  return rest
}

function next(snapshot: PairSnapshot, state: PairState, at: string, patch: Partial<PairSnapshot> = {}): PairSnapshot {
  return { ...clean(snapshot), state, version: snapshot.version + 1, updatedAt: at, ...patch }
}

function requireText(value: string | undefined, field: string): TransitionResult | null {
  return value === undefined || value.length === 0 ? fail('invalid-event', field + ' is required') : null
}

export function transition(snapshot: PairSnapshot, event: PairEvent, expectedVersion: number): TransitionResult {
  if (snapshot.version !== expectedVersion) return fail('version-conflict', 'expected ' + String(expectedVersion) + ', got ' + String(snapshot.version))
  const at = event.at
  switch (event.type) {
    case 'screen':
      return snapshot.state === 'candidate' ? { ok: true, snapshot: next(snapshot, 'deciding', at) } : fail('illegal-transition', 'screen from ' + snapshot.state)
    case 'decide': {
      if (snapshot.state !== 'deciding') return fail('illegal-transition', 'decide from ' + snapshot.state)
      if (event.decision === 'keep') return { ok: true, snapshot: next(snapshot, 'closed', at, { closedReason: 'keep', origin: 'agent' }) }
      const missing = requireText(event.target, 'target')
      if (missing !== null) return missing
      const decision = { target: event.target!, sources: [snapshot.a, snapshot.b] as const }
      const patch: Partial<PairSnapshot> = { decision, target: event.target!, approval: event.approval, ...(event.runId === undefined ? {} : { runId: event.runId }) }
      return { ok: true, snapshot: next(snapshot, event.approval === 'on' ? 'pending' : 'approved', at, patch) }
    }
    case 'approve':
      return snapshot.state === 'pending' ? { ok: true, snapshot: next(snapshot, 'approved', at) } : fail('illegal-transition', 'approve from ' + snapshot.state)
    case 'reject':
      return snapshot.state === 'pending' ? { ok: true, snapshot: next(snapshot, 'closed', at, { closedReason: 'reject', origin: 'human' }) } : fail('illegal-transition', 'reject from ' + snapshot.state)
    case 'author-start':
      return snapshot.state === 'approved' ? { ok: true, snapshot: next(snapshot, 'authoring', at) } : fail('illegal-transition', 'author-start from ' + snapshot.state)
    case 'staged': {
      if (snapshot.state !== 'authoring') return fail('illegal-transition', 'staged from ' + snapshot.state)
      const missing = requireText(event.stageRef, 'stageRef')
      return missing ?? { ok: true, snapshot: next(snapshot, 'staged', at, { stageRef: event.stageRef }) }
    }
    case 'commit-start': {
      if (snapshot.state !== 'staged') return fail('illegal-transition', 'commit-start from ' + snapshot.state)
      const missing = requireText(event.unitId, 'unitId')
      return missing ?? { ok: true, snapshot: next(snapshot, 'committing', at, { unitId: event.unitId }) }
    }
    case 'commit-succeeded':
      if (snapshot.state !== 'committing') return fail('illegal-transition', 'commit-succeeded from ' + snapshot.state)
      if (event.receipt.unitId.length === 0) return fail('invalid-event', 'receipt.unitId is required')
      return { ok: true, snapshot: next(snapshot, 'committed', at, { unitId: event.receipt.unitId, receipt: event.receipt }) }
    case 'commit-failed':
      return snapshot.state === 'committing' ? { ok: true, snapshot: next(snapshot, 'failed', at, { failure: event.failure }) } : fail('illegal-transition', 'commit-failed from ' + snapshot.state)
    case 'commit-unknown':
      return snapshot.state === 'committing' ? { ok: true, snapshot: next(snapshot, 'unknown', at) } : fail('illegal-transition', 'commit-unknown from ' + snapshot.state)
    case 'recover': {
      if (snapshot.state !== 'unknown') return fail('illegal-transition', 'recover from ' + snapshot.state)
      if (event.outcome === 'committed') {
        if (event.receipt === undefined || event.receipt.unitId.length === 0) return fail('invalid-event', 'receipt is required for recovered commit')
        return { ok: true, snapshot: next(snapshot, 'committed', at, { unitId: event.receipt.unitId, receipt: event.receipt }) }
      }
      if (event.outcome === 'failed') {
        if (event.failure === undefined) return fail('invalid-event', 'failure is required for recovered failure')
        return { ok: true, snapshot: next(snapshot, 'failed', at, { failure: event.failure }) }
      }
      return { ok: true, snapshot: next(snapshot, 'cancelled', at) }
    }
    case 'close':
      if (event.reason !== 'over-limit') return fail('invalid-event', 'close only accepts over-limit; keep/reject belong to decide/reject')
      return snapshot.state === 'authoring' || snapshot.state === 'staged'
        ? { ok: true, snapshot: next(snapshot, 'closed', at, { closedReason: event.reason }) }
        : fail('illegal-transition', 'close from ' + snapshot.state)
    case 'expire':
      return snapshot.state === 'pending' || snapshot.state === 'staged'
        ? { ok: true, snapshot: next(snapshot, 'expired', at) }
        : fail('illegal-transition', 'expire from ' + snapshot.state)
    case 'cancel':
      return ['candidate', 'deciding', 'pending', 'approved', 'authoring', 'staged', 'unknown'].includes(snapshot.state)
        ? { ok: true, snapshot: next(snapshot, 'cancelled', at) }
        : fail('illegal-transition', 'cancel from ' + snapshot.state)
    case 'fail':
      return ['candidate', 'deciding', 'pending', 'approved', 'authoring', 'staged'].includes(snapshot.state)
        ? { ok: true, snapshot: next(snapshot, 'failed', at, { failure: event.failure }) }
        : fail('illegal-transition', 'fail from ' + snapshot.state)
    case 'retry':
      return snapshot.state === 'failed'
        ? { ok: true, snapshot: next(snapshot, 'candidate', at, { attempts: snapshot.attempts + 1 }) }
        : fail('illegal-transition', 'retry from ' + snapshot.state)
    case 'undo':
      return snapshot.state === 'committed' ? { ok: true, snapshot: next(snapshot, 'undone', at) } : fail('illegal-transition', 'undo from ' + snapshot.state)
    case 'supersede':
      return snapshot.state === 'undone' ? fail('illegal-transition', 'supersede from undone') : { ok: true, snapshot: next(snapshot, 'superseded', at) }
    default:
      return fail('invalid-event', 'unknown event')
  }
}

