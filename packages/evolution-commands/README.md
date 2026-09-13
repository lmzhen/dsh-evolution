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
The injection goes through the agent's waking primitive (`followup`, falling back
to `inject` when the host lacks it), **called on the agent instance**: the
platform's `Agent.followup` is a prototype method (`this.send(...)`), so a
detached reference throws and queues nothing (0.3.73 fix; the same shape is
pinned by rule N13b in `packages/scripts/verify-arch-guards.mjs`, which masks comments and string literals before matching and self-tests its detector at startup).

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).
