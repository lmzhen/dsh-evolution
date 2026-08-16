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


- - LLM nomination pass is advisory and disabled by default; deterministic lifecycle remains authoritative.
