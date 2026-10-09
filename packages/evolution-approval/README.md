# @deepseek-ai/dsh-evolution-approval

Stage/pending approval service for self-evolution writes. DSH native approval is
one-shot; this service adds the Hermes staged queue: `request()` stores background writes,
`approve()` replays them through a runner, `reject()` discards them. The model-facing write tools
register their own runners (`tool-memory` via `registerRunner('memory', …)`, `tool-skill-manage`
via `registerRunner('skill', …)`), so staged writes are replayable only when the corresponding
tool package is composed. The pending window is also reachable from the browser half over four
loopback routes (§HTTP surface), so the settings panel can list, decide and PREVIEW staged writes
without the console command.

Tests:

```sh
node node_modules/vitest/vitest.mjs run packages/evolution-approval/tests   # overlay: packages/evolution/evolution-approval/tests
```

## Model surface

- **Model-visible:** nothing of its own: a staged write's effect is what the model notices.
- **Prompt prefix / KV cache:** unchanged by this package: family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-approval` row, in `evolution-host`/`evolution-all`/one-click `evolution-preset` (`enabled: false` there).

## Configuration

- `enabled` (default `false`): master switch (off = ungated).
- `stageForeground` (default `true`): stage foreground writes too.

## HTTP surface

Four loopback routes over the same service methods the console command uses, so the two faces cannot drift:

| route | what it does |
|---|---|
| `GET /api/dsh-evolution/approval/pending?status=` | the staged rows the settings card renders (id, kind, summary, staged-at, age) — never the staged `args` |
| `POST …/approve`, `POST …/reject` | forward to `approve(id)` / `reject(id)`; a refusal is HTTP 200 carrying the service's own sentence |
| `GET …/preview?id=` | what that write WOULD store, resolved read-only |

The fence is the family's shared loopback check (`evolution-core`'s `http-routes.ts`, one home for every
route surface), and every "cannot answer" path is a JSON body with a `code` and a `message` rather than an
empty response.

**Previews** come from the package that OWNS the replay: `registerRunner(kind, runner, preview?)` takes an
optional read-only companion that resolves the same `args` into `{path, before, after}`, and the route turns
that into the same diff facts the history panel's diff route uses (`textDiffFacts`). A kind without a
preview, or a resolver that cannot answer (a stale anchor, an operation with no byte-level change), answers
`{available: false, reason}` — the card prints that sentence instead of an empty diff.

## Known limitations

- **Freshness re-validation is per KIND:** a skill write carries `staged_from_sha256`, so its replay (and its
  preview) refuses a target that changed after staging; kinds that carry no anchor replay the `args` snapshot
  as-is. `/evolution pending --detail` shows what will be replayed.
- **A preview is a read, not a reservation:** it resolves the bytes on disk right now, so a target that
  changes between the preview and the approve is refused by the replay's own anchor check rather than by the
  preview that was shown.
- **Previews exist only where a resolver is registered** (`skill` today; `tool-skill-manage` supplies it). Every
  other kind answers `{available: false, reason}`.
- `approve()` dedupes inside one process and providers resolve the record atomically, but the replay runner executes BEFORE that resolution: two OS processes approving one id can both write while one wins the audit transition. Run approvals from one writer process, or make runners idempotent.
- **Approve + reject on one id** are not serialized inside a process: a reject can resolve a still-executing record while the runner completes and the write still lands: verify the write state, or reject only when no approve is in flight.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- **The HTTP face + preview seam (G3, 2026-09-30).** The routes exist so a reader can act on the window
  without the console; the preview is registered BESIDE the runner because a preview derived anywhere else
  would drift from what the replay writes (the write path owns its own normalization).

- **Concurrent approve + reject on the same id (F-204).** Inside one process the dedupe keys are `approve:<id>` / `reject:<id>`, so the two paths are not serialized against each other. When an approve runner is slow, a reject resolves the still-executing record to `rejected` **without holding a claim**; the runner may then complete and the write can still land while the audit history reads `rejected`: the write effect, not the audit verdict, is what actually persists (`写效果以实际为准`). `reject` on an executing record reports this and asks you to verify the write state manually. Only reject a write after confirming no approve is in flight, or verify the write effect manually afterwards.
- **No freshness re-validation for kinds WITHOUT an anchor (F-328, corrected).** The staged record stores the `args` snapshot captured at request time and replays exactly those args. Kinds that carry no anchor — **`memory` today** — replay that snapshot as-is, so a target that changed after staging is not re-checked. A skill write is NOT in that class: it carries `staged_from_sha256`, so its replay and its preview refuse a changed target (the per-kind rule above). The pending surface (`/evolution pending --detail`) exposes the staged `args` so you can review what will actually be replayed before approving.
