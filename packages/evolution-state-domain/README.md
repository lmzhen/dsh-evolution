# @deepseek-ai/dsh-evolution-state-domain

storage-domain provider for evolution state: records live in the DSH storage-domain data form —
schema-validated, change-emitting durable KV routed by whatever backend the domain facility
provides (`json`, `sqlite`, remote RPC).

## Model surface

- **Model-visible:** nothing of its own — the rows that read this state own the injection.
- **Prompt prefix / KV cache:** unchanged by this package — family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-state-domain` row, in `evolution-host`/`evolution-all`/one-click `evolution-preset`, where it is `disabled: true` until the host has the `storage-domain` facility.

## Known limitations

- Requires the host-plane `storage-domain` facility. The bundle row stays dormant when it is absent.
- Both tables are capped (200 pending, 500 sessions), and past the caps records are gone, not archived: the audit-archive sidecar the json provider keeps has no equivalent here (a failed prune warns and retries on the next save).

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- P2-4 (v15): the live pending table is BOUNDED — resolved (approved/rejected) records are kept to the most recent `PENDING_RESOLVED_CAP` (200, seam constant in `evolution-state-storage`); the oldest by `resolvedAt` are deleted on resolve.
- V25-11 (v25): the review-state table is likewise BOUNDED — `REVIEW_STATE_SESSION_CAP` (500, seam constant) rows keyed by session; on every save the least-recently-active sessions (provider-stamped `updatedAt`) are pruned (delete failures warn and retry on the next save).
