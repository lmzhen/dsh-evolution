# @deepseek-ai/dsh-evolution-policy

Immutable evolution policy service: the frozen `PolicySnapshot` the review and curation legs read
their dials from, plus the `tools.guard` refusal of a control-plane key in a write.

## Model surface

- **Model-visible:** nothing of its own — the rows that read the snapshot own the injection.
- **Prompt prefix / KV cache:** unchanged by this package — family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-policy` row, in `evolution-host`/`evolution-all`/one-click `evolution-preset`.

## Known limitations

- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history


