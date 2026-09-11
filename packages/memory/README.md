# @deepseek-ai/dsh-memory

Memory provider registry for self-evolution

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-memory` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- `provider` pins the registry to one provider name (V27 G6.3); empty (the default) serves the FIRST registered provider, so with two providers mounted the choice is row order. A pin that no mounted provider satisfies warns when a differently-named provider registers and then fails the first read/write with the pin named — the registry and the registration API are one service, so there is no earlier point to check it.
