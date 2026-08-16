# @deepseek-ai/dsh-evolution-feedback

Feedback-to-quality scoring for self-evolution

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-feedback` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- - Persists through the IO seam; quality propagation into skill usage requires the `skillUsage` service.
