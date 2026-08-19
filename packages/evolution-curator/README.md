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
- `consolidate(target, sources)` (service) / `/evolution consolidate` merges source bodies into the target, archives the sources with an absorbed-into marker, and folds their usage records into `archived` state. Both operations snapshot the skill tree first (`pre-consolidate` / `pre-restore`).
