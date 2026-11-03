# Evolution plugin family — package reference

This directory holds the 36 packages of the dsh-evolution family. For the user guide, start at [README.md](../README.md) or [docs/](../docs/README.md); this file is the package map and maintainer reference.

## Package map

### Foundations

| Package | Role |
|---|---|
| `evolution-contract` | Pure cross-package types; no runtime, no plugin row |
| `evolution-core` | SkillLibrary, MemoryStore, write kernel/unit transactions, prompts, projections, events, presets, `./restrictor` plugin |
| `evolution-io` | IO provider registry |
| `evolution-io-node` | `node:fs` provider (single-process) |
| `evolution-state-storage` | State provider registry, record contracts, claim/capacity rules, conformance suite |
| `evolution-state-json` | Default JSON state provider: transactions, quarantine, legacy retirement |
| `evolution-state-domain` | Optional storage-domain provider (disabled by default) |
| `evolution-state` | State facade and provider pinning |
| `evolution-policy` | Immutable policy snapshot + `tools.guard` control-key denials |
| `evolution-threat` | Write-time threat scan for memory/skill args |

### Domain services

| Package | Role |
|---|---|
| `evolution-approval` | Staged writes, 4 routes, TTL, release, preview, cross-package `effectiveSessionPolicy` |
| `evolution-merge` | Merge service, 16 verbs, `merge_stage`, 4 read-only routes, recovery/reconcile |
| `evolution-merge-engine` | Pure library: screening, report map, vendored pipeline; no plugin surface |
| `evolution-review` | Review cadence, delivery, notice state machine, branch mode |
| `evolution-maintenance` | `maintenance_probe` tool + maintain scan/facts/validation |
| `evolution-curator` | Lifecycle curation, restore/history/undo, health view, reports |
| `evolution-learning-graph` | `/graph` view/detail/edit/delete over skills + memory |
| `evolution-activity` | Activity ledger for plan/review events |
| `evolution-feedback` | Feedback store, quality fold; no in-family producer |
| `evolution-replay` | Plan ranking/compare and activity backfill |

### Skill ecosystem

| Package | Role |
|---|---|
| `evolution-skill-catalog` | Native `ctx.skills` provider (rank 390, `user-dsh` shadow) |
| `evolution-skill-discovery` | `skill_search`, `/skill-domain`, pre-step domain cards; `mode: off` default |
| `evolution-skill-health` | Read-only health route + sidebar panel (disabled in `all`) |
| `skill-usage` | `ctx.skillUsage` counters and session event observation |
| `tool-skill-manage` | `skill_manage` (13 actions), write gates, approval, guidance |
| `memory` | `ctx.memory` provider registry |
| `memory-files` | Local `MEMORY.md`/`USER.md` provider + budget service |
| `tool-memory` | `memory` tool + guidance/snapshot prompt sections |

### Command and UI

| Package | Role |
|---|---|
| `evolution-commands` | `/evolution` command face (30 entries), diagnostics route, run registry, migrate/preset install |
| `evolution-ui` | Settings section (approval/diagnostics/params/row config) + skill history panel + 6 routes |
| `evolution-merge-ui` | Read-only merge sidebar panel |
| `evolution-client-kit` | Sidebar registration, generated routes/contracts/states/tokens |

### Install forms

| Package | Role |
|---|---|
| `evolution-host` | Infrastructure bundle (21 rows + 2 overrides) |
| `evolution-all` | Full bundle (28 rows + 2 overrides); default |
| `evolution-preset` | Compatibility bundle (26 rows + 2 overrides) + standalone `cordis.yml` |
| `evolution-agent` | Agent preset delta (5 rows) + 4 base table; not a bundle |

## Command and tool entry points

User-facing surfaces are documented once in [docs/commands.md](../docs/commands.md). Summary: `/evolution` (30 table entries), `/graph`, `/skill-domain` (mode:on), and 6 model tools (`memory`, `skill_manage`, `skill_search`, `session_search`, `maintenance_probe`, `merge_stage`).

## State and IO

The default state provider is `evolution-state-json`; `evolution-state-domain` is optional and disabled in the shipped patches. `evolution-state` is a facade, not a medium. IO is a local `node:fs` provider; the honest process scope is **single-process**.

## Generated surfaces

- Bundle YAMLs are generated from `packages/scripts/bundle-rows.json` by `gen-bundle-patches.mjs`.
- Client routes/contracts/states/fallbacks are generated from core/commands sources; do not hand-edit.
- Gate manifest and checks fact are generated; regenerate before treating a gate red as code drift.

## Development

Build, test, gates and layout rules are in [docs/developer/development.md](../docs/developer/development.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Canonical facts (single source)

The family uses one naming rule for the services it provides: **every key is prefixed `evolution`**. The two registered exceptions are `memory` and `skillUsage`. Service keys: `evolutionState`, `evolutionStateStorage`, `evolutionPolicy`, `evolutionIo`, `evolutionCurator`, `evolutionFeedback`, `evolutionReplay`, `evolutionApproval`, `evolutionMerge`, `evolutionMemoryBudget`.

**Validated platform line: DSH `0.2.1-rc.3`.** Published `@deepseek-ai/dsh-*` ranges declare `^0.2.1-rc.2`; prerelease ranges do not cross platform lines.

The 60-char catalog cap is applied to the generated preset row: the composer injects the cap onto that preset row, while a profile-root tool-skill row is a different row, which no profile patch can reach for this purpose.

Command surface includes the preset install row:

| Command | Purpose |
|---|---|
| `/evolution preset install [--base <name>[,<name>...]]` | Generate the Evolution agent preset row |

The install-form semantics and the variant command-face difference are single-sourced in [INSTALL.md](INSTALL.md); this section cites that home instead of restating it. The root publish/install details are in the repository [INSTALL.md](../INSTALL.md).

The family uses declared gates rather than trusting a green test run. A column nobody has written yet is not a pass; an unevaluated criterion is not a pass. Gate declarations live in `scripts/family-facts.json`; the command table lives in `CONTRIBUTING.md`.

> 旧的 consolidate 已从用户面退役；合并请用 `merge`。
