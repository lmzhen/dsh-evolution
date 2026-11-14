/** Merge state vocabulary shared by the row types and the queue projection. */
export type MergeState = 'verify' | 'pending' | 'approved' | 'fuse' | 'skipped'

export type MergeQueue = 'verify' | 'pending' | 'fuse' | 'skipped'

export function queueOf(state: MergeState): MergeQueue {
  switch (state) {
    case 'verify': return 'verify'
    case 'pending': return 'pending'
    case 'approved':
    case 'fuse': return 'fuse'
    case 'skipped': return 'skipped'
  }
}
