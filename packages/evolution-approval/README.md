# @deepseek-ai/dsh-evolution-approval

Stage/pending approval service for Hermes-style self-evolution writes.

DSH native approval is one-shot; this service adds the Hermes staged queue:
`request()` stores background writes, `approve()` replays them through a runner,
and `reject()` discards them. The model-facing write tools register their own
runners — `tool-memory` via `registerRunner('memory', …)` and
`tool-skill-manage` via `registerRunner('skill', …)` — so staged writes are
replayable only when the corresponding tool package is composed.

Run the companion invariant and tests:

```sh
node node_modules/vitest/vitest.mjs run packages/evolution/evolution-approval/tests
```

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-approval` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- `approve()` deduplicates concurrent approvals inside one process, and state providers resolve the pending record atomically. However, the replay runner executes **before** that atomic resolution, so two OS processes approving the same id can each perform the write once while only one process wins the audit transition. Run approvals from a single writer process, or make replay runners idempotent when multi-process approval is required.
- **Concurrent approve + reject on the same id (F-204).** Inside one process the dedupe keys are `approve:<id>` / `reject:<id>`, so the two paths are not serialized against each other. When an approve runner is slow, a reject resolves the still-executing record to `rejected` **without holding a claim**; the runner may then complete and the write can still land while the audit history reads `rejected` — the write effect, not the audit verdict, is what actually persists (`写效果以实际为准`). `reject` on an executing record reports this and asks you to verify the write state manually. Only reject a write after confirming no approve is in flight, or verify the write effect manually afterwards.
- **No staged-content freshness re-validation (F-328).** The staged record stores the `args` snapshot captured at request time and replays exactly those args, but does not record a content hash, so `approve()` does **not** re-check whether the on-disk skill/memory the write targets changed since staging. The write is applied as staged regardless. The pending surface (`/evolution pending --detail`) exposes the staged `args` so you can review what will actually be replayed before approving; there is no automatic drift warning if the target changed in the meantime.
