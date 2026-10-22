/** Pure merge decision state machine. No IO, no host imports. */
export type MergeState = 'verify' | 'pending' | 'approved' | 'fuse' | 'skipped'

export type MergeQueue = 'verify' | 'pending' | 'fuse' | 'skipped'

export type MergeEvent =
  | { readonly type: 'candidate' }
  | { readonly type: 'round1-start' }
  | { readonly type: 'round1-keep' }
  | { readonly type: 'round1-merge'; readonly approval: boolean }
  | { readonly type: 'round1-fail' }
  | { readonly type: 'approve' }
  | { readonly type: 'reject' }
  | { readonly type: 'round2-start' }
  | { readonly type: 'round2-fail' }
  | { readonly type: 'round2-merged' }
  | { readonly type: 'round2-cancel' }
  | { readonly type: 'staging-expired' }
  | { readonly type: 'source-gone' }
  | { readonly type: 'target-taken' }
  | { readonly type: 'source-changed' }
  | { readonly type: 'cancel' }
  | { readonly type: 'timeout' }

export type TransitionResult =
  | { readonly ok: true; readonly state: MergeState }
  | { readonly ok: true; readonly state: null; readonly removed: true }
  | { readonly ok: false; readonly code: 'invalid-transition'; readonly message: string }

export function queueOf(state: MergeState): MergeQueue {
  switch (state) {
    case 'verify': return 'verify'
    case 'pending': return 'pending'
    case 'approved':
    case 'fuse': return 'fuse'
    case 'skipped': return 'skipped'
  }
}

export function isTerminal(state: MergeState): boolean {
  return state === 'skipped'
}

function fail(state: MergeState, event: MergeEvent): TransitionResult {
  return { ok: false, code: 'invalid-transition', message: 'cannot apply ' + event.type + ' to ' + state }
}

/** Single transition point; callers must not mutate fields outside this function. */
export function transition(state: MergeState, event: MergeEvent): TransitionResult {
  switch (event.type) {
    case 'candidate':
      return state === 'verify' ? { ok: true, state: 'verify' } : fail(state, event)
    case 'round1-start':
      return state === 'verify' ? { ok: true, state: 'verify' } : fail(state, event)
    case 'round1-keep':
      return state === 'verify' ? { ok: true, state: 'skipped' } : fail(state, event)
    case 'round1-merge':
      return state === 'verify'
        ? { ok: true, state: event.approval ? 'pending' : 'approved' }
        : fail(state, event)
    case 'round1-fail':
      return state === 'verify' ? { ok: true, state: 'verify' } : fail(state, event)
    case 'approve':
      return state === 'pending' ? { ok: true, state: 'approved' } : fail(state, event)
    case 'reject':
      return state === 'pending' || state === 'approved' || state === 'fuse'
        ? { ok: true, state: 'skipped' }
        : fail(state, event)
    case 'round2-start':
      return state === 'approved' ? { ok: true, state: 'fuse' } : fail(state, event)
    case 'round2-fail':
    case 'round2-cancel':
      return state === 'fuse' || state === 'approved' ? { ok: true, state: 'approved' } : fail(state, event)
    case 'round2-merged':
      return state === 'fuse' || state === 'approved' ? { ok: true, state: null, removed: true } : fail(state, event)
    case 'staging-expired':
      return state === 'fuse' ? { ok: true, state: 'approved' } : fail(state, event)
    case 'source-gone':
      return { ok: true, state: null, removed: true }
    case 'target-taken':
    case 'source-changed':
      return state === 'pending' ? { ok: true, state: 'pending' } : fail(state, event)
    case 'cancel':
    case 'timeout':
      return state === 'verify' || state === 'approved' || state === 'fuse' ? { ok: true, state } : fail(state, event)
  }
}

export function allowedEvents(state: MergeState): readonly MergeEvent['type'][] {
  switch (state) {
    case 'verify': return ['candidate', 'round1-start', 'round1-keep', 'round1-merge', 'round1-fail', 'source-gone', 'cancel', 'timeout']
    case 'pending': return ['approve', 'reject', 'target-taken', 'source-changed', 'source-gone']
    case 'approved': return ['round2-start', 'reject', 'staging-expired', 'source-gone', 'cancel', 'timeout']
    case 'fuse': return ['round2-fail', 'round2-merged', 'round2-cancel', 'staging-expired', 'reject', 'source-gone', 'cancel', 'timeout']
    case 'skipped': return []
  }
}
