# dsh-evolution — self-evolving memory and skills for DeepSeek Harness

[English](./README.md) · [中文](./README.zh.md)

**One install. The agent keeps project memory, improves its own skills, and leaves an audit trail you can review.**

This repository publishes **36 composable Cordis packages** for DeepSeek Harness. The model may write memory and skills. Policy, prompts, routing, state, and audit history are control-plane data it cannot change.

Current family version: **0.32.4**. See [Compatibility](#compatibility-and-family-version) for the validated platform line and the declared range.

## Start here

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# restart dsh so the profile is recomposed
/evolution doctor
```

The default `all` bundle installs the complete surface. If you only want background automation and no memory/skill tools, use `host`. If you want tools only in selected sessions, use `host` plus the Evolution preset. **Never mount two bundles in one profile**; they share infrastructure rows and the loader fails on duplicate ids.

## What you get

| Capability | What happens | Where to look |
|---|---|---|
| Memory | Facts and preferences persist in `MEMORY.md` / `USER.md`; new sessions get a snapshot | settings parameter cards; `memory` tool |
| Skills | The model creates, patches, moves, and archives skills; every write is gated and versioned | `skill_manage`; skill history panel |
| Review | Background review at conversation boundaries; `inject` by default, `branch` optional | `/evolution params`; review state file |
| Curation | Deterministic lifecycle: stale, archive, merge near-duplicates; optional LLM nomination | `/evolution curator …`; reports |
| Merge | Screening, two-round authoring, staging, approval, commit, undo | `/evolution merge …`; merge panel |
| Control plane | Threat scan, immutable policy, optional staged approval | approval panel; `/evolution pending` |
| Observability | Activity ledger, replay ranking, health, usage, graph | `/evolution replay`, `/graph`, health panel |

## Install forms (choose one)

| Form | Install | Model tools | Notes |
|---|---|---|---|
| **All (default)** | `dsh-evolution-all` | profile-wide | full surface; no preset step |
| Host | `dsh-evolution-host` | only `maintenance_probe` and `merge_stage` | background automation only |
| One-click preset | `dsh-evolution-preset` | profile-wide | compatibility form; no settings/health rows |
| Layered preset | `host` + `/evolution preset install` | only sessions on the Evolution preset | exclusive with all/preset |

`all`, `host`, `preset`, and the layered preset are mutually exclusive. To shrink, uninstall one and install another; do not add both. The per-form session semantics and the variant command-face difference are single-sourced in [packages/INSTALL.md](packages/INSTALL.md); this page cites that home.

## Commands and tools

Main command surface: `/evolution` (30 table entries, 36 expanded leaves), `/graph`, and `/skill-domain` when discovery is `mode: on`. The compatibility `/merge` alias is removed in 0.32.

| Surface | Entry |
|---|---|
| Preset install | See the preset-install row in [docs/commands.md](docs/commands.md) |
| Approval | `/evolution pending`, `approve <id>`, `reject <id>` |
| Doctor | `/evolution doctor [--json]` |
| Curator | `/evolution curator status|scope|report|run` |
| Merge | `/evolution merge scan|pair|status|approve|resume|undo|doctor` |
| Model tools | `memory`, `skill_manage`, `skill_search`, `session_search`, `maintenance_probe`, `merge_stage` |

## Service keys and ownership

The family uses one naming rule for the services it provides: **every key is prefixed `evolution`**. The two registered exceptions are `memory` and `skillUsage`.

The model can write memory and skills only. Policy, prompts, routing, state, audit history, and approval decisions remain control-plane data.

## Compatibility and family version

| | Value |
|---|---|
| Validated platform line | **`0.2.1-rc.3`** |
| Declared dependency window | `^0.2.1-rc.2` |
| Family version | `0.32.4` |
| Node | 22.19+ or 24+ |

**Validated platform line: DSH `0.2.1-rc.3`.** The published `@deepseek-ai/dsh-*` ranges declare `^0.2.1-rc.2`; node-semver prerelease rules admit this line, not an earlier one. The platform line and the floor live in `platform-line.json`; the release workflow reads that file verbatim.

## Catalog cap

The 60-character catalog cap applies to the generated preset row, not to a profile-root tool-skill row. The canonical statement lives in [packages/README.md](packages/README.md); this page does not restate it.

## Safety boundaries

- **single-process state.** The IO provider is a local `node:fs` provider; this is not a distributed lock or WAL.
- **No shadow promotion.** A shadow write never becomes official without the explicit path.
- **No automatic hard delete.** Skill deletion archives; restore and unit undo are explicit.
- **Approval is optional, gates are not.** Even with approval off, every write passes the write gates and threat scan.
- **No telemetry.** Data stays under `$DSH_HOME`.

## Known limitations

- `host` does not expose memory/skill tools by design.
- `skill-health` is disabled in the `all` bundle until explicitly enabled.
- `skill-discovery` ships `mode: off`; only `skill_search` stays registered.
- `merge/run` and `merge/runs` HTTP paths are declared but not implemented.
- `reviewToolAllow` is present in bundle YAML but is not read by the review plugin.
- `feedback` has no in-family producer/consumer; activity/replay only receive events in branch review mode.
- `/merge` alias removed; `/evolution consolidate` removed from the command face.

## Documentation

- [docs/](docs/README.md) — Chinese user guide: getting started, feature map, commands, configuration, operations, troubleshooting, architecture.
- [INSTALL.md](INSTALL.md) — install, upgrade, uninstall, verification.
- [packages/README.md](packages/README.md) — package map and maintainer reference.
- [CHANGELOG.md](CHANGELOG.md) — release history.
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributor gates and house rules.

## Checks

The family uses declared gates rather than trusting a green test run. A criterion that has not been evaluated is not a pass. See `CONTRIBUTING.md` for the current gate table and `packages/scripts/family-facts.json` for the single-source declarations.
