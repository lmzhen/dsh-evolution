# @deepseek-ai/dsh-evolution-state-json

JSON-file evolution state provider over the IO seam


## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-state-json` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- JSON provider serializes writers inside one process AND through the IO backend's cross-process transact lock (an internal transact wrapper — not public API, audit v10 S-03 — wraps every mutation, 0.3.20/0.3.27) — this provider is NOT limited to single-process safety. The caveat below is about the DSH storage-domain providers (`storage-json` documents no cross-process write locking) when the DOMAIN provider is used instead; multi-process deployments should route the evolution domain to a backend with cross-process semantics such as SQLite or remote storage.

