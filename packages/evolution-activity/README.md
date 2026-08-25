# @deepseek-ai/dsh-evolution-activity

Session projection for self-evolution activity

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-activity` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- The projection registers BOTH contract generations — `stateSchema` + `wire.viewSchema` (DSH 0.1.1+ session-projection contract) and legacy `schema` + `view` (0.1.0-rc.6 era) — because each registry ignores the fields it does not know. When the legacy fields are removed, drop the old half of the dual registration.
- On 0.1.1+ hosts the cold-read path (`restore`) calls `stateSchema.parse` on checkpointed rows; a registration missing `stateSchema` would throw on the first cold read, so the new half is load-bearing, not cosmetic.
