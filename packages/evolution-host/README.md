# @deepseek-ai/dsh-evolution-host

Host-plane self-evolution infrastructure bundle for DeepSeek Harness

> ⚠️ **Mutually exclusive install target.** `dsh-evolution-host` is the
> infrastructure-only bundle: no memory/skill model tools (its single
> model-facing surface is the read-only `maintenance_probe` diagnostic), and
> it must be paired with
> the Evolution agent preset to expose `memory`/`skill_manage`. It shares its
> infrastructure rows with `@deepseek-ai/dsh-evolution-preset`; do **not** add
> both bundles to the same profile — pick host + the Evolution agent preset
> (layered), or the one-click preset bundle. (V10-14 / H-02: the previous
> wording "pick host+preset" described the forbidden combination itself —
> "host + preset" IS the layered install, not an alternative to it.)
>
> **0.3.54 (route B)**: the DEFAULT full bundle is now
> `@lmzhen/dsh-evolution-all` (infra + model tools, profile-root). This package
> is the **shrink path**: the same automation minus the memory/skill model
> tools. `all`, `host`
> and the one-click preset are three ALTERNATIVE install targets — mounting two
> of them fails loud at startup (invariants: already registered).
>
> **v20 correction**: earlier revisions of this document claimed the bundle
> registers "NO model-facing tools" / "Zero direct token effect" — that was
> inaccurate: the `evolution-maintenance/tools` row mounts the read-only
> `maintenance_probe` tool schema into every session. The claims below are
> now scoped to the prompt/assembly surface.


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-host` registers no direct prompt itself. Its one model-visible artifact is the read-only `maintenance_probe` tool schema (from the `evolution-maintenance/tools` row); everything else model-visible is owned by the packages that consume these services.

#### Token effect

Near-zero direct token effect: the only model-visible tokens this package adds are the `maintenance_probe` tool schema; consumers add any other model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt; the assembled TOOL list gains the read-only `maintenance_probe` row (v20 correction — the former "does not alter the tool list" claim was false).

## Known Limitations and Deferred Work


- Host-only by design. It provides no memory/skill write tools — the read-only `maintenance_probe` diagnostic is the one exception; pair it with the Evolution agent preset to expose `memory`/`skill_manage`.

