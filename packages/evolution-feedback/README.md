# @deepseek-ai/dsh-evolution-feedback

Feedback-to-quality scoring: durable through `ctx.evolutionIo`; skill feedback feeds the
FEEDBACK-OWNED `feedback_score`/`feedback_warn` pair.

## Model surface

- **Model-visible:** nothing of its own: the usage-record readers own it.
- **Prompt prefix / KV cache:** unchanged by this package: family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-feedback` row, `evolution-host`/`evolution-all`/`evolution-preset`.

## Configuration

- `qualityWarnThreshold` (default `-0.25`): score below which the pair flips to warned.
- `path`: boot-cache path; `''` means `$DSH_HOME/evolution/feedback.json` (the event log is not affected).

## Known limitations

- Lifecycle and scope views read `quality_warn || feedback_warn`, so negative feedback shortens the stale window even though the curator recomputes `quality_warn`.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- Persists through the IO seam; quality propagation into skill usage requires BOTH the `skillUsage` service and a mounted IO backend: with no `evolutionIo` the push returns before touching the persistent usage sidecar (S4.6), so an optimistic in-memory score never lands there unconfirmed.
- The in-memory-wins window of a log refold is the IN-FLIGHT append window only, counted PER TARGET (two appends for one target in flight at once both stay protected, and the no-io path never enters it): a settled target folds from the log truth, so another process sharing `DSH_HOME` is not overwritten by this process's stale record (S1.4).
- P1-1 (v15): feedback writes the FEEDBACK-OWNED `feedback_score`/`feedback_warn` usage fields.
