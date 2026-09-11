# @deepseek-ai/dsh-evolution-state-domain

storage-domain provider for evolution state


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-state-domain` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- Requires the host-plane `storage-domain` facility. The bundle row stays dormant when it is absent.
- P2-4 (v15): the live pending table is BOUNDED — resolved (approved/rejected) records are kept to the most recent `PENDING_RESOLVED_CAP` (200, seam constant in `evolution-state-storage`); the oldest by `resolvedAt` are deleted on resolve. The audit ARCHIVE sidecar that the json provider maintains beyond the cap is json-specific (the domain seam has no sidecar facility) — resolved records past the cap are gone, not archived.
- V25-11 (v25): the review-state table is likewise BOUNDED — `REVIEW_STATE_SESSION_CAP` (500, seam constant) rows keyed by session; on every save the least-recently-active sessions (provider-stamped `updatedAt`) are pruned (delete failures warn and retry on the next save). The stamp is stripped on read, so the consumer-facing record shape is unchanged.

