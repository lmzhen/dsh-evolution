# @lmzhen/dsh-evolution-approval

Staged approval service for memory and skill writes. It records a proposed mutation, then replays the registered runner only after an operator approves it.

## Operator surface

Use `/evolution pending`, `approve <id>`, and `reject <id>`. The settings UI can show the pending queue and, when the owning tool registered a preview, a before/after diff without executing the write.

`/evolution release <id>` is different from approval. It returns an orphaned `executing` record to `pending` after a crashed approval. A live foreign process or an in-flight local decision blocks release.

## Defaults

| Setting | Default | Effect |
|---|---|---|
| `enabled` | `false` | Writes proceed without this staged queue. |
| `stageForeground` | `true` | Once enabled, foreground writes also stage unless the effective session policy is `never`. |
| `pendingTtlMs` | `0` | Pending records never expire automatically. |
| `approvalConfirm` | `auto` | Approving does not add a second confirmation by default. |

A positive `pendingTtlMs` closes expired records as `rejected` and never executes them. Expiry is evaluated on queue reads and decisions, not by a background timer.

## Boundaries

- Background-review writes require a registered replay runner. Staging a record without one is not a usable approval flow.
- Curator and merge writes have their own controls; they do not pass through this ordinary memory/skill approval queue.
- Before using `release`, verify whether the original runner already landed the write and what effect it had. Approving the returned record replays that operation, which may be non-idempotent.
- Resolved history is bounded by the state provider. The JSON provider archives older resolved records; the domain provider does not create that JSON archive sidecar.
