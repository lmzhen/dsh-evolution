# @deepseek-ai/dsh-evolution-activity

Durable activity store for self-evolution plan outcomes: it subscribes to the `evolution/plan-applied`
process event (payload v2, with sessionId) and append-merges every outcome into
`$DSH_HOME/evolution/activity.json` through the evolution IO seam — load → fold → save under an
in-process queue, so records survive host restarts and are readable without a session. A
session log carrying `evolution/*` types is refused wholesale at resume, so plan-outcome
durability lives here; a storage-domain table is deferred until a consumer needs domain routing.

## Model surface

- **Model-visible:** nothing of its own — the rows and commands that read the sidecar own the injection; it backs `/evolution replay` (`evolution-replay`).
- **Prompt prefix / KV cache:** unchanged by this package — family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-activity` row, in `evolution-host`/`evolution-all`/one-click `evolution-preset`.

## Configuration

- `maxItems` — `DEFAULT_MAX_ITEMS = 200` — bound on the retained sidecar; a non-finite value falls back to the default, a non-positive value fails loud at the schema.

## Known limitations

- Each event lands through `transactIo` (like `feedback.json`), so append cycles are cross-process atomic at the single-write granularity; the read-modify-write of one event is serialized in-process and atomic on disk. A multi-record batch is still one event at a time — no batch transaction exists.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- A non-finite value (NaN/±Infinity) falls back to the default (0.3.19, S6.4 guard), while a non-positive value (0 or negative) fails loud at the schema — `z.number().min(1)` — because `slice(-0)` would keep everything and disable the retention window (G3.1, 0.3.23).
