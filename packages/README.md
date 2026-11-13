# Evolution plugin family — package reference

This directory holds the 36 packages of the dsh-evolution family. For the user guide, start at [README.md](../README.md) or [docs/](../docs/README.md); this file is the package map and maintainer reference.

## Package map

### Foundations

| Package | Role |
|---|---|
| `evolution-core` | SkillLibrary, MemoryStore, write kernel/unit transactions, prompts, projections, events, presets, `./restrictor` plugin; `./io-registry` + `./io-node` (IO seam), `./authority-plugin` (the `evolutionMutationAuthority` home lock service), `./policy`, `./contract` |
| `evolution-state` | domain provider (subpath `./domain`);  State facade and provider pinning |

### Domain services

| Package | Role |
|---|---|
| `evolution-approval` | Staged writes, 4 routes, TTL, release, preview, cross-package `effectiveSessionPolicy` |
| `evolution-merge` | Merge service, 16 verbs, `merge_stage`, 4 read-only routes, recovery/reconcile |
| `evolution-merge-engine` | Pure library: screening, report map, vendored pipeline; no plugin surface |
| `evolution-review` | Review cadence, aux delivery, notice state machine |
| `evolution-maintenance` | `maintenance_probe` tool + maintain scan/facts/validation |
| `evolution-curator` | Lifecycle curation, restore/history/undo, health view, reports |
| `evolution-activity` | feedback store, replay scorer, learning graph and threat scan (subpaths `./feedback`, `./replay`, `./learning-graph`, `./threat`);  Bounded activity sidecar for plan and review outcomes |

### Skill ecosystem

| Package | Role |
|---|---|
| `evolution-skill-health` | Read-only health route + sidebar panel (disabled in `all`) |
| `evolution-skill-discovery` | catalog provider, health route/panel and usage counters (subpaths `./catalog`, `./health`, `./usage`);  `skill_search`, `/skill-domain`, pre-step domain cards; `mode: off` default |
| `tool-skill-manage` | `skill_manage` (13 actions), write gates, approval, guidance |
| `memory` | registry, `MEMORY.md`/`USER.md` provider and model tools (subpaths `./files`, `./tools`);  `ctx.memory` provider registry |

### Command and UI

| Package | Role |
|---|---|
| `evolution-commands` | `/evolution` command face (27 entries), diagnostics route, run registry |
| `evolution-ui` | Parameter cards in the family settings section (approval/diagnostics/params) + skill history panel + 6 routes |
| `evolution-merge-ui` | Read-only merge sidebar panel |
| `evolution-client-kit` | Sidebar registration, generated routes/contracts/states/tokens |

### Install forms

| Package | Role |
|---|---|
| `evolution-host` | Infrastructure bundle (21 rows + 2 overrides) |
| `evolution-all` | Full bundle (28 rows + 2 overrides); default |
| `evolution-agent` | Agent preset delta (5 rows) + 4 base table; not a bundle |

## Command and tool entry points

User-facing surfaces are documented once in [docs/commands.md](../docs/commands.md).

| Command | Purpose |
|---|---|
| `/evolution doctor` | Check installation form, versions and service state |

Summary: `/evolution` (27 table entries), `/graph`, and `/skill-domain` (mode:on). Family model-tool entries are `memory`, `skill_manage`, `skill_search`, `maintenance_probe`, and the merge-child-only `merge_stage`; the bundles also mount the platform session-query tools.

## State and IO

The shipped state provider is `evolution-state-domain`, which registers a KV domain on the platform storage stack (base bundle: `storage` + `storage-json` + `storage-domain`). `evolution-state` is a facade, not a medium. IO is a local `node:fs` provider; the honest process scope is **single-process**.

## Generated surfaces

- Bundle YAMLs are generated from `packages/scripts/bundle-rows.json` by `gen-bundle-patches.mjs`.
- Client routes/contracts/states/fallbacks are generated from core/commands sources; do not hand-edit.
- Gate manifest and checks fact are generated; regenerate before treating a gate red as code drift.

## Development

Build, test, gates and layout rules are in [docs/developer/development.md](../docs/developer/development.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Canonical facts (single source)

The family uses one naming rule for the services it provides: **every key is prefixed `evolution`**. The two registered exceptions are `memory` and `skillUsage`. Service keys: `evolutionPlatform`, `evolutionState`, `evolutionStateStorage`, `evolutionPolicy`, `evolutionIo`, `evolutionCurator`, `evolutionFeedback`, `evolutionReplay`, `evolutionApproval`, `evolutionMerge`, `evolutionMemoryBudget`, `evolutionProjections`, `evolutionLlm`.

**Validated platform line: DSH `0.2.2-rc.1`.** Published `@deepseek-ai/dsh-*` ranges declare `^0.2.2-rc.0`; prerelease ranges do not cross platform lines.

The 60-char catalog cap is applied to the generated preset row: the composer injects the cap onto that preset row, while a profile-root tool-skill row is a different row, which no profile patch can reach for this purpose.

The install-form semantics and the variant command-face difference are single-sourced in [INSTALL.md](INSTALL.md); this section cites that home instead of restating it. The root publish/install details are in the repository [INSTALL.md](../INSTALL.md).

The family uses declared gates rather than trusting a green test run. A check without a declaration is not accounted; an unevaluated criterion is not a pass. Gate declarations live in `scripts/family-facts.json`; the command table lives in `CONTRIBUTING.md`.

> 旧的 consolidate 已从用户面退役；合并请用 `merge`。

## Configuration dials

Maintainer map of the user-facing dials: **autonomy** (approval), **curatorBackground** (curator schedule), **memoryInjection** (memory prompt), **threatStrictness** (write scan). Each dial names fields that exist in the owning package; do not document a ghost field.
