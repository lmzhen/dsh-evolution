# @lmzhen/dsh-evolution-merge

Skill merge service with candidate screening, two-round authoring, pending/skipped queues, staged model work, commit orchestration, recovery, and undo.

Use `/evolution merge …` for operations. `merge_stage` is the model-facing staging tool. The sidebar supplied by `evolution-merge-ui` is read-only and copies commands rather than executing a merge itself.

## Control axes

| Setting | Default | Meaning |
|---|---|---|
| `mergeApproval` | `false` | Do not pause after round 1 for merge-specific approval. |
| `mergeSkippedTtlDays` | `0` | Skipped pairs never expire automatically. |
| `mergeRunTimeoutMinutes` | `0` | No overall run timeout. |
| `mergePairTimeoutMinutes` | `15` | Bound one pair round. |
| `mergeModelsRoot` | empty | Must be configured to the local model root for the shipped engine path. |

For scan, the model root contains `potion-multilingual-128M-int8` and `potion-multilingual-128M-pca64-int8`. Missing required models fail explicitly; this package does not silently provision them. Ordinary pair skips this local candidate-screening dependency, but its round 1 and authoring still require the child-session model channel rather than scan's stub fallback.

Merge approval is independent of the ordinary memory/skill approval queue. `platformWrite` is accepted as a fallback parameter, overridden by the host approval capability when available, and included in run reports and snapshots; it is not an admission check in this package. Actual write execution depends on host capability preparation and the merge state machine; neither that projected field nor `mergeApproval:false` proves that every environment permits writes.

Four read-only host routes expose view, rows, body, and history data. `merge/run` and `merge/runs` are declared but not implemented. Committed merges have durable receipts for undo; recovery and reconcile report blocked or interrupted state rather than hiding it.
