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

`@deepseek-ai/dsh-evolution-preset` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- Compatibility one-click bundle exposes model tools profile-wide. Prefer the layered host/agent install for stricter session control.

