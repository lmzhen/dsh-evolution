# @deepseek-ai/dsh-evolution-state

Provider-selection surface for durable curator and review state records

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-state` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- `provider` pins the registry to one provider name; a pinned name is checked at mount once any provider has registered (S-07). With the pin EMPTY and two providers mounted the effective one is REGISTRATION ORDER, warned once per ambiguous period — enabling the domain row in an overlay rebinds every `evolutionState` operation to an empty medium while the state already on disk under the other provider becomes invisible (`/evolution pending` shows nothing, approve misses). Pin config: `{ provider: json|domain }`.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).
