# @deepseek-ai/dsh-evolution-capability

Explicit staged governance adapter for Creator-mode capability packages


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-capability` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- This adapter validates and stages capability packages only. It never executes model code; activation remains a manual Creator-mode operation.
- This service is a governance seam reserved for Creator-mode capability adoption: it has no live consumer in the production composition (not mounted by the host bundle or the presets), so deployments add the row on top when they enable staged capability governance.

