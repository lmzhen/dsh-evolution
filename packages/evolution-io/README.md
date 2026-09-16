# @deepseek-ai/dsh-evolution-io

IO seam for evolution providers: the registry the file-backed family stores (`memory-files`,
`skill-usage`, `evolution-activity`) write through.

## Model surface

- **Model-visible:** nothing of its own: the rows that write through this seam own the injection.
- **Prompt prefix / KV cache:** unchanged by this package: family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-io` row, `evolution-host`/`evolution-all`/`evolution-preset`; a seam backed by `evolution-io-node`.

## Known limitations

- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history


