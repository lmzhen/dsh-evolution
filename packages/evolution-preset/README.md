# @deepseek-ai/dsh-evolution-preset

Compatibility one-click bundle for the dsh-evolution plugin family


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-preset` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- - Compatibility one-click bundle exposes model tools profile-wide. Prefer the layered host/agent install for stricter session control.

