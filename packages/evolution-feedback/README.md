# @deepseek-ai/dsh-evolution-feedback

Feedback-to-quality scoring for self-evolution

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-feedback` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- Persists through the IO seam; quality propagation into skill usage requires BOTH the `skillUsage` service and a mounted IO backend — with no `evolutionIo` the push returns before touching the persistent usage sidecar (S4.6), so an optimistic in-memory score never lands there unconfirmed.
- The in-memory-wins window of a log refold is the IN-FLIGHT append window only, counted PER TARGET (two appends for one target in flight at once both stay protected, and the no-io path never enters it): a settled target folds from the log truth, so another process sharing `DSH_HOME` is not overwritten by this process's stale record (S1.4).
- P1-1 (v15): feedback writes the FEEDBACK-OWNED `feedback_score`/`feedback_warn` usage fields. The lifecycle engine and the scope view read the union `quality_warn || feedback_warn`, so a negative feedback shortens the stale window even though the curator's six-factor run always recomputes `quality_warn` itself.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).
