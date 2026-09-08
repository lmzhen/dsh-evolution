# @deepseek-ai/dsh-evolution-commands

Human commands for the evolution family

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-commands` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

P2-22 (v11) correction: this package's **only** direct model-visible token is the
`/evolution learn` injection — the full learning guidance is injected as a user
message in this session. Everything else adds no tokens; consumers add their own.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.
