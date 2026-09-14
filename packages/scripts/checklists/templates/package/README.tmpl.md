# @deepseek-ai/dsh-<pkg>

<One line: what this package owns, and what it deliberately does not.>

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-<pkg>` registers no direct prompt or tool schema itself.
Model-visible effects are owned by the packages that consume this service.

#### Token effect

<None, or the exact injection and its size.>

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the
assembled prompt or tool list.

## Known Limitations and Deferred Work

- <A limitation a user must know, with its mechanism and its workaround.>

**Runtime invariant:** No companion is published. The platform auto-assembles
nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion
here would never execute (v37 S2.1 / I-3).
