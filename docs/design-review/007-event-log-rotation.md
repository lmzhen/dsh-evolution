# 007 — Event log growth: split rotation with seq-dedupe timeline (design)

Status: design declaration for review before implementation. Trigger: AUDIT_REPORT_v5.md §3
reminder — under high-frequency feedback/learn traffic `events.json` is simultaneously the
largest sidecar and the hottest write point.

## Problem (measured characteristics)

- `appendEvolutionEvent` is a full-file RMW: parse whole file, rewrite whole file
  (`evolution-events.ts`). Each append is O(n); cumulative append cost is O(n²) IO.
- Every boot reads and parses the whole log (O(n)); the boot CACHE only saves the
  FOLD (delta), not the parse.
- The log is the loop substrate (feedback-vs-learn ordering). Plain COMPACTION
  (merge old events into aggregates) would destroy the ordering the log exists for —
  rotation, not compaction, is the fix.

## Design

### Layered files (after rotation)

| Artifact | Role |
|---|---|
| `events.json` | ACTIVE log — only the newest `ROTATE_AT` events; the only file appended to. |
| `events-<maxSeq>.json` | ARCHIVE — read-only, created atomically by splitting the active at its midpoint; globbed at boot and merged into the timeline. |
| `events.archive.json` (does NOT exist) | deliberately avoided — a single accumulating archive reintroduces O(archive) per-rotation rewrite. |

### Rotation (inside the existing append transact)

- Trigger: `active.length >= EVENT_LOG_ROTATE_AT` (default **4000**) checked before
  appending, inside the same transact task that holds the active-file lock.
- Action (copy-then-truncate, one task):
  1. `mid = ceil(active.length / 2)`; head = events[0..mid), tail = events[mid..].
  2. Write `events-<tail[0].seq - 1>.json` = head (via `io.writeText` — the archive
     path has its OWN lock file, so no recursion into the active lock).
  3. Return the new active body `{ events: [...tail, newEvent] }` — seqs continue
     globally (tail seqs are already high; next append derives from tail-max).
- **Crash safety**: between (2) and (3) the active file still holds the FULL old
  content and the archive holds the head — the boot timeline merge is seq-DEDUPED,
  so the crash window yields the identical timeline (no double counts, no loss).
  Between (1)-math and (2): nothing committed — pure no-op crash.

### Timeline read (boot)

- New `readEvolutionTimeline(io, path)`: read active + all `events-*.json`
  (glob via `io.list` in the same directory), parse each, MERGE by `seq`
  (dedupe: first occurrence wins; duplicates only arise from the crash-copy
  window above), sort ascending. Returns `{ events, malformed }` with
  `malformed = true` only when the ACTIVE file is non-JSON (syntax-level, rc.70-F-1
  boundary still applies per file).
- Cost calibration: with `ROTATE_AT=4000` the active parse is bounded; boot parse
  stays O(total events) — for realistic n (≤10⁵ events ≈ 20–30 MB total) that is
  a ~100–200 ms scan, acceptable. The O(n²) APPEND problem is the one removed.

### Retention

- `EVENT_LOG_RETAIN_ARCHIVES = 10` (core default): at rotation, older archives are
  pruned (best-effort `io.remove`, mirrors `retainReports`). The horizon covers
  the loop analysis window; very old ordering data is explicitly disposable.
- Pruning races a concurrent boot read: a deleted archive reads as missing →
  skipped — safe.

### Migration interplay (condition change)

- Migration currently triggers when `events.json` is missing/whitespace. After
  rotation, that condition must include "AND no archive exists": a manually
  deleted active file with archives present must NOT re-synthesize a fresh log
  from the cache — the archive timeline IS the truth. (A deleted active is
  rebuilt by the next append; the timeline before that boot comes from archives.)

### Fold consumers (feedback)

- `restore()`/`persistCache()` switch from `readEvolutionEvents` to
  `readEvolutionTimeline`; `foldWithDelta`/`foldFeedbackState` are unchanged
  (they fold a seq-sorted array — the timeline provides it).
- Migration's `containsLegacySequence` continues to scan the ACTIVE file only
  (migration runs only when no log and no archives exist).

## Tests (planned)

1. Rotation at threshold: append past `ROTATE_AT` → archive appears with the old
   head (seq 1..mid), active continues (mid+1..), no gap/dup, total count exact.
2. Timeline merge: active + 2 archives → sorted, deduped.
3. Crash-copy duplicate: archive and active both containing seq 1..mid →
   timeline dedupes to one occurrence; fold counts once.
4. Retention: 12 rotations → only the newest 10 archives remain.
5. Migration vs archives: active deleted + archives present → no synthesis;
   timeline = archives (+ cache ready to serve the gap).
6. Concurrent appenders during rotation: global seq uniqueness preserved
   (transact serializes; append derives next-seq from the post-rotation active).

## Risks / open points for review

- Archive name `events-<seq>.json`: a crashed rotation whose archive-write landed
  but active-rewrite failed leaves BOTH full — handled by dedupe (upper bound:
  one stale header file, pruned by the same retention pass).
- Boot time with 10 archives + active is O(total) — calibrated above; if a real
  deployment reaches ~10⁶ events, re-evaluate (NDJSON + offset index would be
  the next step, NOT implemented now).
- Threshold/retention values are core `DEFAULT_*` constants (tunable defaults,
  not protocol constants).

## Decision points for the reviewer

1. `ROTATE_AT = 4000` / `RETAIN_ARCHIVES = 10` as shipped defaults?
2. Retention prunes WITHOUT config surface (constants only) — ok for now?
3. Segue into implementation as rc.71 with the six tests above?
