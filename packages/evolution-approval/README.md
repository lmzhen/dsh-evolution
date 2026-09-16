# @deepseek-ai/dsh-evolution-approval

Stage/pending approval service for self-evolution writes. DSH native approval is
one-shot; this service adds the Hermes staged queue: `request()` stores background writes,
`approve()` replays them through a runner, `reject()` discards them. The model-facing write tools
register their own runners — `tool-memory` via `registerRunner('memory', …)`, `tool-skill-manage`
via `registerRunner('skill', …)` — so staged writes are replayable only when the corresponding
tool package is composed.

Tests:

```sh
node node_modules/vitest/vitest.mjs run packages/evolution-approval/tests   # overlay: packages/evolution/evolution-approval/tests
```

## Model surface

- **Model-visible:** nothing of its own — a staged write's effect is what the model notices.
- **Prompt prefix / KV cache:** unchanged by this package — family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-approval` row, in `evolution-host`/`evolution-all`/one-click `evolution-preset` (`enabled: false` there).

## Configuration

- `enabled` — `false` — master switch (off = ungated).
- `stageForeground` — `true` — stage foreground writes too.

## Known limitations

- `approve()` dedupes inside one process and providers resolve the record atomically, but the replay runner executes BEFORE that resolution: two OS processes approving one id can both write while one wins the audit transition. Run approvals from one writer process, or make runners idempotent.
- **Approve + reject on one id** are not serialized inside a process: a reject can resolve a still-executing record while the runner completes and the write still lands — verify the write state, or reject only when no approve is in flight.
- **No freshness re-validation:** the staged `args` snapshot is replayed as-is (no content hash), so `approve()` never checks whether the target changed; `/evolution pending --detail` shows what will be replayed.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- **Concurrent approve + reject on the same id (F-204).** Inside one process the dedupe keys are `approve:<id>` / `reject:<id>`, so the two paths are not serialized against each other. When an approve runner is slow, a reject resolves the still-executing record to `rejected` **without holding a claim**; the runner may then complete and the write can still land while the audit history reads `rejected` — the write effect, not the audit verdict, is what actually persists (`写效果以实际为准`). `reject` on an executing record reports this and asks you to verify the write state manually. Only reject a write after confirming no approve is in flight, or verify the write effect manually afterwards.
- **No staged-content freshness re-validation (F-328).** The staged record stores the `args` snapshot captured at request time and replays exactly those args, but does not record a content hash, so `approve()` does **not** re-check whether the on-disk skill/memory the write targets changed since staging. The write is applied as staged regardless. The pending surface (`/evolution pending --detail`) exposes the staged `args` so you can review what will actually be replayed before approving; there is no automatic drift warning if the target changed in the meantime.
