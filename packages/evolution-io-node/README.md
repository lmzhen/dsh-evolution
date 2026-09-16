# @deepseek-ai/dsh-evolution-io-node

Local atomic node:fs IO provider: registers the `node` backend into `ctx.evolutionIo`; the
implementation is core's `nodeEvolutionIo()` (this package adds the name).

## Model surface

- **Model-visible:** nothing of its own — the rows that write through this backend own the injection.
- **Prompt prefix / KV cache:** unchanged by this package — family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-io-node` row, in `evolution-host`/`evolution-all`/one-click `evolution-preset`.

## Known limitations

- Local node:fs provider. Remote or shared media requires another `ctx.evolutionIo` provider.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history


