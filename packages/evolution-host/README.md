# @deepseek-ai/dsh-evolution-host

Host-plane self-evolution infrastructure bundle for DeepSeek Harness


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-host` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- - Host-only by design. It provides no model-facing tools; pair it with the Evolution agent preset to expose `memory`/`skill_manage`.

