# @deepseek-ai/dsh-evolution-state-storage

Provider registry seam for durable evolution state


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-state-storage` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- - Provider registry has no default medium. Mount `evolution-state-domain` or `evolution-state-json` before state reads.

