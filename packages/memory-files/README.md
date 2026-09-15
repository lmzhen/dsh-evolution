# @deepseek-ai/dsh-memory-files

Local layered memory provider

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-memory-files` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work

- **The memory budget is configured in two places.** `memoryCharLimit`/`userCharLimit` (this package) is what the STORE enforces; `evolution-policy`'s `memoryChars`/`userChars` is what the review pipeline PLANS against. An UNSET limit here follows the mounted policy (row order permitting — the policy must already be mounted when this row assembles), an explicit value wins, and an explicit value that contradicts the policy warns once at load. `/evolution doctor` re-checks the pair at run time and reports a `memory budget:` finding, which also catches the row-order case. "Unset" is read as "equal to the schema default": the loader fills defaults into the row config, so a row that pins the default value explicitly is indistinguishable from one that omits it.


- `providerName` (default `files`) is the name this provider registers under. Nothing selects it implicitly: `memory.provider` pins the registry to one name (V27 G6.3), and with the pin empty the FIRST registered provider serves every read/write — so with two providers mounted, set the pin or the choice is row order.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).
