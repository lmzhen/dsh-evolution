# @deepseek-ai/dsh-evolution-preset

Compatibility one-click bundle for the dsh-evolution plugin family

> ⚠️ **Mutually exclusive install target.** `dsh-evolution-preset` is the
> one-click bundle that exposes the model tools profile-wide. It shares its
> infrastructure rows with `@deepseek-ai/dsh-evolution-host`; do **not** add both
> bundles to the same profile — pick the layered host/agent layout (recommended)
> or this preset bundle.
>
> **0.3.54 (route B)**: `@lmzhen/dsh-evolution-all` is now the DEFAULT
> full-functionality bundle with the same row set — new installs should use
> `all` and reserve this preset for legacy compatibility. Its rows are kept in
> sync with `all` by the bundle-mutual-exclusion guard (identical row bodies).


## Model Experience

### Indirect model surface

#### What the model sees

**S5.7 correction (2026-09-16, audit P2-25)**: earlier revisions claimed this
bundle "registers no direct prompt or tool schema itself" / "Zero direct token
effect" / "does not alter the assembled prompt or tool list" — that was
inaccurate (the same error class the host README corrected at v20). This is
the one-click FULL bundle: its `cordis.patch.yml` mounts the model-visible
rows directly — the `memory` tool (`tool-memory`), the `skill_manage` tool
(`tool-skill-manage`), the session-search tool row (`tool-session-query`),
the `ctx.skills` catalog provider (`evolution-skill-catalog`, which feeds the
`skill` tool's catalog section) and the read-only `maintenance_probe` tool
(`evolution-maintenance/tools`).

#### Token effect

Non-zero: the mounted tools add their schemas to every session under this
bundle, and the skill catalog adds its prompt section (populated from the
library). The guidance sections injected by the family's model rows are owned
by those rows, not re-declared here.

#### KV Cache effect

Same shape as the installed rows: tool schemas and the skill-catalog section
enter the request prefix; this patch file itself adds no additional prompt
beyond what those rows register.

## Known Limitations and Deferred Work


- Compatibility one-click bundle exposes model tools profile-wide. Prefer the layered host/agent install for stricter session control.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

