# @deepseek-ai/dsh-evolution-state-json

JSON-file evolution state provider over the IO seam: review, curator and pending records are JSON
files under the state root, so the medium behind `ctx.evolutionIo` can change without a format
change.

## Model surface

- **Model-visible:** nothing of its own: the rows that read this state own the injection.
- **Prompt prefix / KV cache:** unchanged by this package: family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-state-json` row, in `evolution-host`/`evolution-all`/one-click `evolution-preset` (it is the medium they pin).

## Configuration

- `root`: the directory the state files live in; `''` means the evolution home.

## Known limitations

- Both tables are capped (200 pending, 500 sessions), and past the pending cap the DOMAIN provider deletes instead of archiving: this provider keeps an audit sidecar. The `updatedAt` stamp is stripped on read, so the consumer-facing record shape is unchanged.
- All shipped JSON media are **single-process**: the IO backend has no cross-process lock. A second process sharing `DSH_HOME` is not coordinated; route multi-process deployments to a platform-provided cross-process backend before relying on this provider.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- P2-4 (v15): the live pending map is BOUNDED — resolved (approved/rejected) records are kept to the most recent `PENDING_RESOLVED_CAP` (200, seam constant in `evolution-state-storage`); the oldest by `resolvedAt` rotate into the `pending-state-archive.json` sidecar (with `.bak` rotation), which is JSON-provider-specific.
- V25-11 (v25): the review-state table is likewise BOUNDED: `REVIEW_STATE_SESSION_CAP` (500, seam constant) rows keyed by session; on every save the least-recently-active sessions (provider-stamped `updatedAt`, stored on disk only) are pruned.
- The JSON provider serializes writers inside one process only (the internal transact wrapper is not public API, audit v10 S-03). It does **not** claim cross-process safety; the shipped IO backend declares single-process.
