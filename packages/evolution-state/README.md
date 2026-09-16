# @deepseek-ai/dsh-evolution-state

Durable evolution state consumer: it owns no medium and performs no IO — a provider registered in
`ctx.evolutionStateStorage` does.

## Model surface

- **Model-visible:** nothing of its own: the rows that read this state own the injection.
- **Prompt prefix / KV cache:** unchanged by this package: family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-state` row, in `evolution-host`/`evolution-all`/one-click `evolution-preset` (all pin `provider: json`).

## Configuration

- `provider` (`''` default, or `json` / `domain`): pins the provider for every operation; empty = first registered wins.

## Known limitations

- An empty pin with two providers mounted resolves by REGISTRATION ORDER (one warn per ambiguous period): enabling the domain row in an overlay rebinds every operation to an empty medium while the state on disk under the other provider becomes invisible (`/evolution pending` empty, approve misses).

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- `provider` pins the registry to one provider name; a pinned name is checked at mount once any provider has registered (S-07).
