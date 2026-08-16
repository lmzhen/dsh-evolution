# @deepseek-ai/dsh-evolution-state-json

JSON-file evolution state provider over the IO seam


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-state-json` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- - JSON provider serializes writers inside one process. Multi-process writers should use the storage-domain provider.

