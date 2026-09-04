# @deepseek-ai/dsh-evolution-skill-catalog

Native ctx.skills provider for the evolution-managed skill tree


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-skill-catalog` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- Read-only native `ctx.skills` catalog. Skill mutations still happen through `tool-skill-manage`.
- **Out-of-band edits need a refresh (0.3.18, E-71).** The catalog invalidates on the in-band `evolution/skill-mutated` event (all writes through SkillLibrary). Edits made outside the family — manual file edit, a git pull, another process — bypass that event and cannot be auto-detected (decision C: no filesystem watcher). A root-mtime probe re-stamps the summaries cache when the provider is re-queried after a structural change (directory add/remove/rename), but any out-of-band change is only guaranteed to be visible after `/evolution skills refresh` runs (or the process restarts).

