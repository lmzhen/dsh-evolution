# @deepseek-ai/dsh-skill-usage

Skill usage telemetry: the `use`/`view`/`patch` counters behind the skill tree's usage records.
`record(name, kind)` is the write API; reads are observed from `session/event`
`tool/call` records of the `skill` tool and bump `view` on EXISTING records only — a read never
mints one.

## Model surface

- **Model-visible:** nothing of its own: the counter readers own it.
- **Prompt prefix / KV cache:** unchanged by this package: family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `skill-usage` row (`sessionScoped: true`), `evolution-host`/`evolution-all`/one-click `evolution-preset`; consumed by `evolution-feedback` and `tool-skill-manage`.

## Configuration

- `root` (default `''`): skills-tree root.
- `eventsHome`: the event timeline's home; `''` means `DSH_HOME` / `~/.dsh`.
- `sessionScoped` (default `false`): act only on sessions carrying the family's model tools (the bundles set it).

## Known limitations

- No known durable consumer gaps; runtime contracts are covered by package and boundary tests.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history


