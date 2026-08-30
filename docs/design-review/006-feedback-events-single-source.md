# 006 — Feedback event log: single source of truth (rc.68 design)

Status: design declaration for review before implementation.

## Problem

`evolution-feedback` persists an aggregate snapshot (`$DSH_HOME/evolution/feedback.json`,
`{ skills, sessions }` counters). rc.66 made each `record()` increment a transactional
locked RMW, which closed the cross-process lost-increment; the remaining debt is
structural:

- The aggregate is the only write shape, so the file cannot tell "two processes
  incrementing the same target" from "one record seen twice" (rc.65 verdict).
- `record(target, rating, note, kind, io?)` accepts an `io` that is unrelated to the
  constructor's path derivation (audit-v4 K-6) — a latent path/backend mismatch.
- The self-improvement loop has no durable timeline: learn actions (rc.67 `/evolution
  learn` inject) and feedback events never share an ordered record, so "feedback
  before learn on target X" (the loop signal) is unanswerable.

## Architecture

### Layering

Event-log primitives live in `evolution-core/src/events.ts` (next to `usage.ts` /
`memory-store.ts`). Both consumers already depend on core — no new package, no new
dependency edges. The event log is the loop substrate, not feedback's private file.

### Data planes (three roles, one hot write)

| Artifact | Role | Writes |
|---|---|---|
| `evolution/events.json` `{ version: 1, events: [...] }` | **Single source of truth.** Append-only by design (compact only into a new file + rename, never in place). | Hot path ONLY: `appendEvolutionEvent(io, path, event)` — transact RMW, `seq = max+1` inside the lock (cross-process unique). Malformed → refuse (rc.65 posture). |
| `evolution/feedback.json` `{ version: 2, lastSeq, skills, sessions }` | **Rebuildable boot cache.** Losing it costs an O(events) fold, no truth. | Boot when `lastSeq < max(events.seq)` (incremental fold: cache + delta); unload best-effort write. Uses transact; failure = warn only. |
| In-memory `EvolutionFeedback.state` | Derived aggregate (fold of cache + events delta). | `score()`/`snapshot()` read it; `record()` updates it optimistically with the same timeout-free posture as rc.66. |

Event shape (tagged union in one timeline, `seq` = ordering key):

```json
{ "seq": 1, "type": "feedback", "at": "ISO", "target": "python-testing",
  "kind": "skill", "rating": "positive", "note": "..." }
{ "seq": 2, "type": "learn", "at": "ISO", "target": "python-testing",
  "source": "manual", "request": "..." }
```

### Migration (idempotent)

Boot sees legacy v1 `feedback.json` (no `lastSeq`) and no `events.json` → synthesize
one feedback event per (kind, target, rating, note-preserving) aggregate count, write
`events.json`, rewrite `feedback.json` as v2 cache. Once `events.json` exists, migration
is skipped. Mid-crash replay-safe: cache write after events write; lost cache = refold.

### K-6 absorption

New signature `record(target, rating, note?, kind?)` — the `io` parameter is REMOVED.
`io`/`path` come only from the constructor surface (registry + `home`/`pathOverride`),
killing the mismatch class outright. The apply bridge simplification follows.

### /learn events

rc.67's learn branch (after successful inject) appends `{ type: 'learn', source:
'manual', request }` via soft-probed `evolutionIo` registry; no registry → skip, and
the inject itself never blocks on the log.

### Gate

Sidecar inventory gains a row: `{ file: 'evolution-core/src/events.ts', marker:
'appendEvolutionEvent' }` (7th). Cache writer is covered by the same file row.

## Tests

- events.spec (core): concurrent appenders keep `seq` unique and the fold exact
  (two-instance pattern); fold/incremental-fold; migration idempotence incl. crash
  replay; malformed events file never overwritten.
- feedback.spec: updated for the no-`io` signature; restore → events load; quality
  bridge (`setQuality`) unchanged; `waitIdle` semantics preserved.
- commands.spec: learn event appended when the io registry is mounted; inject not
  blocked when absent.

## Risks

- Single migration window (idempotent + replayable; cache loss harmless).
- Event-file growth: no consumer needs compaction yet; pagination/size cap deferred
  (documented, not implemented).
- Two writers appending concurrently: transact RMW is the same convergence the whole
  family uses; no new lock semantics introduced.
