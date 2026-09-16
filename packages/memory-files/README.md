# @deepseek-ai/dsh-memory-files

Local layered memory provider: registers the `files` provider into `ctx.memory` over the IO seam.

## Model surface

- **Model-visible:** nothing of its own: `tool-memory` owns the tool and the injection.
- **Prompt prefix / KV cache:** unchanged by this package: family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `memory-files` provider row, in `evolution-host`/`evolution-all`/one-click `evolution-preset`.

## Configuration

- `providerName` (default `files`): the registered name.
- `memoryCharLimit` / `userCharLimit` (`2200` / `1375`) the budget the STORE enforces per target.
- `root`: directory override; `''` means `$DSH_HOME/memories`.
- `addDatePrefix` / `maxConsolidationFailures` (`false` / `3`) date prefixes on entries; consolidation failures one turn tolerates.
- `threatExemptLabels` (default `[]`): benign threat labels for the MEMORY store (per-site rule in `evolution-threat`).

## Known limitations

- **The memory budget is configured in two places.** `memoryCharLimit`/`userCharLimit` (this package) is what the STORE enforces; `evolution-policy`'s `memoryChars`/`userChars` is what the review pipeline PLANS against. An unset limit follows the mounted policy, an explicit value wins, a contradiction warns once at load; `/evolution doctor` re-checks the pair at run time.
- Nothing selects this provider implicitly: with `memory.provider` empty the FIRST registered provider serves every read/write: set the pin or row order decides.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- `memory.provider` pins the registry to one name (V27 G6.3), and with the pin empty the FIRST registered provider serves every read/write: so with two providers mounted, set the pin or the choice is row order.
