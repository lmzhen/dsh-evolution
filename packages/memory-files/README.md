# @deepseek-ai/dsh-memory-files

Local layered memory provider

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-memory-files` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- `providerName` (default `files`) is the name this provider registers under. Nothing selects it implicitly: `memory.provider` pins the registry to one name (V27 G6.3), and with the pin empty the FIRST registered provider serves every read/write — so with two providers mounted, set the pin or the choice is row order.
