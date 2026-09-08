# @deepseek-ai/dsh-evolution-host

Host-plane self-evolution infrastructure bundle for DeepSeek Harness

> ⚠️ **Mutually exclusive install target.** `dsh-evolution-host` is the
> infrastructure-only bundle: no model-facing tools, and it must be paired with
> the Evolution agent preset to expose `memory`/`skill_manage`. It shares its
> infrastructure rows with `@deepseek-ai/dsh-evolution-preset`; do **not** add
> both bundles to the same profile — pick host + the Evolution agent preset
> (layered), or the one-click preset bundle. (V10-14 / H-02: the previous
> wording "pick host+preset" described the forbidden combination itself —
> "host + preset" IS the layered install, not an alternative to it.)
>
> **0.3.54 (route B)**: the DEFAULT full bundle is now
> `@lmzhen/dsh-evolution-all` (infra + model tools, profile-root). This package
> is the **shrink path**: the same automation minus model tools. `all`, `host`
> and the one-click preset are three ALTERNATIVE install targets — mounting two
> of them fails loud at startup (invariants: already registered).


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-host` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- Host-only by design. It provides no model-facing tools; pair it with the Evolution agent preset to expose `memory`/`skill_manage`.

