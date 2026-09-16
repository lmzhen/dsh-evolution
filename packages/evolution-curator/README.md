# @deepseek-ai/dsh-evolution-curator

Deterministic skill lifecycle and recovery

## Model surface

- **Model-visible:** nothing of its own — it registers no prompt section and no tool schema; the packages that consume this service own the model-visible effects.
- **Prompt prefix / KV cache:** independent of request-prefix construction — it does not alter the assembled prompt or tool list; family-level rules: `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-curator` row, carried by the `evolution-host`, `evolution-all` and one-click `evolution-preset` bundles; it provides the `evolutionCurator` service the `/evolution curator …` commands and doctor read.

## Known limitations

- LLM nomination pass is advisory and disabled by default; deterministic lifecycle remains authoritative.
- Consolidation is a REAL merger path: the LLM nomination (when enabled / via `recommend()`) proposes
 merge groups, the control plane gates them and applies the mutation — merged source bodies are appended
 verbatim rather than rewritten into a synthesized skill.

## Recovery and consolidation

- `archive` never deletes: skills move to `.archive/` with a `.archive-reason` marker.
- `restore(name)` (service) / `/evolution skill restore <name>` brings one archived skill back to the active root and resets its usage state.
- `consolidate(target, sources)` (service) / `/evolution consolidate` merges source bodies into the target, archives the sources with an absorbed-into marker, and folds their usage records into `archived` state. Both operations snapshot the full state first (`pre-consolidate` / `pre-restore`).
- `restoreSnapshot` (service) / `/evolution restore` rolls the state back to the latest snapshot: active tree, usage/suppression sidecars, `.archive/` and the curator state carried in the snapshot (`curator-state.json`), so the interval gate does not immediately re-fire after a rollback. Skills that were skipped at snapshot time (a live writer held their lock; recorded in the manifest's `skipped` list) are NOT restored — the restore result names them, and `.backups` may hold a copy. The restore itself is undoable — the pre-rollback safety snapshot preserves the current tree plus its state.

## Configuration

- `autoStart` (default true) arms an HOURLY tick that only asks whether the due-ness interval (`intervalHours`, default 168 h) has elapsed — the tick is not the interval — plus a deferred catch-up check `bootGraceSeconds` (default 10) after host boot. Both decide due-ness from the **persisted** `lastRunAt`, so a restart with an overdue schedule runs the first pass within the boot grace instead of waiting a full interval. `bootGraceSeconds: 0` disables the deferral (not recommended: the check may run against a half-mounted host). All scheduling gates — interval, idle, first-run deferral, and the reentrancy guard — remain inside `run()`.
- `autoStart: false` disables both automatic checks; `/evolution curator run` (manual, gate-skipping) still works.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).
## Notes and history

- The one-click `/evolution consolidate <target> <source...>` remains the direct manual path (P2-8, v11: the earlier "no LLM pass proposes merge groups" wording contradicted the tested nomination chain).
