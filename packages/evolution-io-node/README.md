# @deepseek-ai/dsh-evolution-io-node

Local atomic node:fs IO provider

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-io-node` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- Local node:fs provider. Remote or shared media requires another `ctx.evolutionIo` provider.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).
