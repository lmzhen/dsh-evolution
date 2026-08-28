# @deepseek-ai/dsh-evolution-curator

Deterministic skill lifecycle and recovery

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-curator` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- LLM nomination pass is advisory and disabled by default; deterministic lifecycle remains authoritative.
- Consolidation is control-plane only (`/evolution consolidate <target> <source...>`): no LLM pass proposes merge groups yet, and merged source bodies are appended verbatim rather than rewritten into a synthesized skill.

## Recovery and consolidation

- `archive` never deletes: skills move to `.archive/` with a `.archive-reason` marker.
- `restore(name)` (service) / `/evolution skill restore <name>` brings one archived skill back to the active root and resets its usage state.
- `consolidate(target, sources)` (service) / `/evolution consolidate` merges source bodies into the target, archives the sources with an absorbed-into marker, and folds their usage records into `archived` state. Both operations snapshot the full state first (`pre-consolidate` / `pre-restore`).
- `restoreSnapshot` (service) / `/evolution restore` rolls the FULL state back to the latest snapshot: active tree, usage/suppression sidecars, `.archive/` and the curator state carried in the snapshot (`curator-state.json`), so the interval gate does not immediately re-fire after a rollback. The restore itself is undoable — the pre-rollback safety snapshot preserves the current tree plus its state.

## Automatic scheduling

- `autoStart` (default true) arms an hourly interval check plus a deferred catch-up check `bootGraceSeconds` (default 10) after host boot. Both decide due-ness from the **persisted** `lastRunAt`, so a restart with an overdue schedule runs the first pass within the boot grace instead of waiting a full interval. `bootGraceSeconds: 0` disables the deferral (not recommended: the check may run against a half-mounted host). All scheduling gates — interval, idle, first-run deferral, and the reentrancy guard — remain inside `run()`.
- `autoStart: false` disables both automatic checks; `/evolution curator run` (manual, gate-skipping) still works.
