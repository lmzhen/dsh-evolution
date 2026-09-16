# @deepseek-ai/dsh-memory

Memory provider registry: the `memory` service the memory tool and the loops use.

## Model surface

- **Model-visible:** nothing of its own — `tool-memory` owns the tool and the injection.
- **Prompt prefix / KV cache:** unchanged by this package — family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `memory` row, `evolution-host`/`evolution-all`/one-click `evolution-preset`; a seam whose shipped provider is `memory-files`.

## Configuration

- `provider` — `''` (default) — pins one provider for all reads and writes; empty = first registered.

## Known limitations

- A pin no mounted provider satisfies warns when a differently-named provider registers, then fails the first read/write with the pin named — there is no earlier check (registry and registration API are one service).

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- `provider` pins the registry to one provider name (V27 G6.3); empty (the default) serves the FIRST registered provider, so with two providers mounted the choice is row order.
