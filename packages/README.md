# Evolution plugin family

Hermes-style self-evolution for DeepSeek Harness, implemented as composable
Cordis plugins. The model may only propose and write **memory** and **skills**;
policy, prompts, routing, state, and audit history are control-plane data.

> Community-published packages under `@lmzhen` are maintained by the
> dsh-evolution community and are not official DeepSeek releases.


## Package map

| Package | Role |
|---|---|
| `evolution-core` | Shared pure stores/prompts/signals/constants (no Cordis plugin entry) |
| `evolution-io` / `evolution-io-node` | File-tree IO seam registry + atomic node:fs provider |
| `memory` / `memory-files` / `tool-memory` | Memory seam: registry, provider, model tool |
| `skill-usage` / `tool-skill-manage` / `evolution-skill-catalog` | Usage telemetry + `skill_manage` + native `ctx.skills` provider |
| `evolution-policy` | Immutable policy snapshot + native `tools.guard` denials |
| `evolution-plan-validator` | Deterministic validation for model-produced plans |
| `evolution-state-storage` / `-domain` / `-json` / `evolution-state` | State seam: provider registry, storage-domain KV, JSON fallback, consumer |
| `evolution-approval` | Hermes-style staged/pending writes over `evolutionState` |
| `evolution-threat` | `tools/pre-execute` content threat guard |
| `evolution-review` | Signal gate → one-shot subagent → validated plan execution |
| `evolution-curator` | Deterministic lifecycle + LLM nomination + run reports + min-idle gate |
| `evolution-activity` | Durable audit store for self-evolution plan outcomes (`evolution/plan-applied`) |
| `evolution-feedback` | Durable feedback → `quality_score`/`quality_warn` → curator |
| `evolution-learning-graph` | Graph command over skills + memory |
| `evolution-replay` | A/B replay scoring + session-event driver |
| `evolution-commands` | `/evolution pending|approve|reject|curator run|curator report|restore` |
| `evolution-maintenance` | Deterministic maintenance-scan surface (snapshot / drift signals / facts) |
| `evolution-capability` | Staged non-executing governance adapter for Creator-mode capability packages |
| `evolution-host` | Host-plane infrastructure bundle (no model tools) |
| `evolution-agent` | Agent preset: standard tools + `memory`/`skill_manage` model entry |
| `evolution-preset` | Compatibility one-click bundle (`cordis.yml` standalone, `cordis.patch.yml` overlay) |
| `evolution-all` | Full-functionality bundle — DEFAULT install (infra + model tools, profile-root) |

## Installation

See [INSTALL.md](./INSTALL.md) for the layered host/agent flow, the one-click
compatibility flow, and profile override examples.

## Command reference

The `/evolution` surface below is generated from the subcommand registry
(`evolution-commands/src/registry.ts` — single source shared with the
input-declaration hint and the emitted help/README text; `commands.spec`
pins the equality).

| Command | Purpose |
|---|---|
| `/evolution pending [--detail]` | list staged evolution writes (--detail shows staged args) |
| `/evolution approve <id>` | replay an approved staged write through its runner |
| `/evolution reject <id>` | drop a staged write without running it |
| `/evolution doctor` | read-only self-check: install form, conflicts, env, services |
| `/evolution curator run\|pause\|resume\|status\|report\|scope` | run one curation pass, control or inspect automatic curation |
| `/evolution mutations` | list skill-mutation audit records |
| `/evolution restore` | restore skills from the latest snapshot |
| `/evolution consolidate <target> <sources...>` | merge source skills into a target umbrella skill |
| `/evolution skill restore <name>` | restore one archived skill by name |
| `/evolution skills health` | structure-health verdicts for the skill library |
| `/evolution skills refresh` | drop the catalog caches and re-read the tree |
| `/evolution learn [request]` | send a learning request to this session |
| `/evolution maintain [--timeout=<ms> \| --facts]` | run a maintenance scan (--facts: 0-token preview) |
| `/evolution preset install` | generate the Evolution agent preset into the user root |
| `/evolution restructure <name> "<heading>" <to_file>` | move a body section into a references/ file |
| `/evolution replay` | compare prompt-bundle replay for this session |

## Composition details

### Configuration dials (5 knobs — field names pinned by T-WC2)

| Dial | Values | Underlying config fields |
|---|---|---|
| autonomy | auto / reviewed / observe | approval.enabled (profile row), reviewEnabled (evolution-review), pending/approve/reject commands |
| scope | global / per-session | package choice: evolution-all (global, DEFAULT) vs host + evolution preset (per-session) |
| curatorBackground | on / off | autoStart, intervalHours, minIdleHours (evolution-curator) |
| memoryInjection | on / off | memoryEnabled (tool-memory) |
| threatStrictness | strict / exempt-list | threat config + threatExemptLabels (core SkillLibrary/MemoryStore option) |

### Environment variables (DSH_EVOLUTION_*)

| Variable | Layer | Effect |
|---|---|---|
| DSH_EVOLUTION_SESSION_QUERY | profile config (`!!js` in bundle patch) | startup / first-search / never; invalid normalizes to startup |
| DSH_EVOLUTION_SESSION_QUERY_PATH | profile config (`!!js`) | durable index path; empty falls back to `$DSH_HOME/evolution/session-query.db` |
| DSH_EVOLUTION_ALLOW_ROW_COLLISIONS | plugin code (core env.ts) | `1` downgrades delta-row collision from fail-loud to warn+keep-both |

## Composition

### Layered install (recommended)

Install the host bundle into the profile:

```yaml
- id: dsh-evolution-host
  name: '@deepseek-ai/dsh-evolution-host'
```

Then select the `Evolution` agent preset for sessions that should expose the
`memory` / `skill_manage` tools. Sessions on other presets keep the shared
automation (review, curator, approval, observability) without model-facing
evolution tools.

> **One-time step (V7-06):** before a session can select the `Evolution`
> preset, run `/evolution preset install` once in a session on any preset —
> it writes `.agent-presets/evolution/` so the preset actually exists in the
> profile. See the Chinese README for the same flow; without this step a
> `dsh plugin add`-installed host is mounted but the preset is absent.

### One-click compatibility install

Use the legacy preset overlay on a standard DSH host:

```yaml
- id: dsh-evolution
  name: '@deepseek-ai/dsh-evolution-preset'
```

This one-click preset and the layered `evolution-host` bundle are ALTERNATIVE
install targets (mutual exclusion, E-33) — install one, not both, or the shared
infra rows mount twice. The one-click preset carries its own
`evolution-maintenance-tools` row and its own `session-query-sqlite` index
override; the `tool-skill` 60-char catalog cap override is evolution-host-owned
and a preset-alone install runs the platform catalog default (add the override
yourself if you want the cap — the 60-char authoring bar enforced by
tool-skill-manage still applies regardless).

Or compose manually — order matters because provider rows declare `inject`.
This mirrors the row set shipped by the two bundles (evolution-host infra +
evolution-agent model tools); the DSH profile HOST provides the storage
facility (`storage`/`storage-json`/`storage-domain`), which this preset never
owns — `evolution-state-domain` joins it only when mounted (D-30):

```yaml
- id: evolution-policy
  name: '@deepseek-ai/dsh-evolution-policy'
- id: evolution-io
  name: '@deepseek-ai/dsh-evolution-io'
- id: evolution-io-node
  name: '@deepseek-ai/dsh-evolution-io-node'
- id: evolution-state-storage
  name: '@deepseek-ai/dsh-evolution-state-storage'
- id: evolution-state-domain
  name: '@deepseek-ai/dsh-evolution-state-domain'
  # Opt-in: joins the HOST storage-domain facility when mounted; disabled by
  # default so evolution-state-json stays the portable backend.
  disabled: true
- id: evolution-state-json
  name: '@deepseek-ai/dsh-evolution-state-json'
- id: evolution-state
  name: '@deepseek-ai/dsh-evolution-state'
- id: memory
  name: '@deepseek-ai/dsh-memory'
- id: memory-files
  name: '@deepseek-ai/dsh-memory-files'
- id: skill-usage
  name: '@deepseek-ai/dsh-skill-usage'
# model-facing tools (evolution-agent preset layer)
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'
- id: tool-skill-manage
  name: '@deepseek-ai/dsh-tool-skill-manage'
- id: tool-session-query
  name: '@deepseek-ai/dsh-tool-session-query'
- id: evolution-skill-catalog
  name: '@deepseek-ai/dsh-evolution-skill-catalog'
- id: evolution-approval
  name: '@deepseek-ai/dsh-evolution-approval'
  config:
    enabled: false
    stageForeground: true
- id: evolution-threat
  name: '@deepseek-ai/dsh-evolution-threat'
- id: evolution-review
  name: '@deepseek-ai/dsh-evolution-review'
  config:
    reviewToolAllow: [skill]
- id: evolution-curator
  name: '@deepseek-ai/dsh-evolution-curator'
- id: evolution-commands
  name: '@deepseek-ai/dsh-evolution-commands'
- id: evolution-maintenance-tools
  name: '@deepseek-ai/dsh-evolution-maintenance/tools'
- id: evolution-activity
  name: '@deepseek-ai/dsh-evolution-activity'
- id: evolution-feedback
  name: '@deepseek-ai/dsh-evolution-feedback'
- id: evolution-learning-graph
  name: '@deepseek-ai/dsh-evolution-learning-graph'
- id: evolution-replay
  name: '@deepseek-ai/dsh-evolution-replay'

# Cross-session recall (base `session-query-sqlite` override) and the Hermes
# 60-char catalog cap (base `tool-skill` override) — both also carried by the
# evolution-host bundle.
- id: session-query-sqlite
  config:
    path: !!js (process.env.DSH_EVOLUTION_SESSION_QUERY_PATH ?? dshHomePath('evolution', 'session-query.db'))
    openAt: !!js process.env.DSH_EVOLUTION_SESSION_QUERY || 'startup'
- id: tool-skill
  config:
    catalogDescriptionMaxLength: 60
```

## Control-plane invariants

1. Model writes only `memory` and `skills`; policy/prompts/routing/state are
   never model-writable. `evolution-policy` installs a monotonic
   `ctx.tools.guard` and `evolution-plan-validator` rejects forbidden fields.
2. Every mutation is gated by `tools/pre-execute` threat scan and, when
   enabled, the staged approval service. Approved writes replay through the
   exact runner they were registered with.
3. Skill destruction is never a hard delete: archival moves to `.archive/`,
   and every curator run snapshots the full skill tree first.
4. Review plans require event-sequence evidence bounded by the session seq;
   invalid ops are dropped while valid ops still apply.
5. Provider seams (`ctx.evolutionIo`, `ctx.evolutionStateStorage`) keep media
   decisions out of policy code; native packages perform no node:fs IO of
   their own.

## Development: the two layouts and their tsconfigs

Dev source lives at `packages/evolution/*`; the mirrored publication repo uses
the flat form `packages/evolution-*`. The repo `tsconfig.base.json` /
`tsconfig.host.json` carry the `@deepseek-ai/dsh-evolution*`/`@lmzhen` alias
lines and project references as `./packages/evolution/<pkg>` paths. Those
`packages/evolution/...` paths resolve ONLY in the full upstream checkout (the
dev tree or the CI overlay built against it) — they are not resolvable as a
standalone flat mirror, where the packages live as `packages/evolution-*`.
When a config in the published repo is copied into the flat tree for a
stand-alone build, its project references therefore remain
CI-overlay-only and must not be expected to resolve independently (G5.5).
The same layout rule applies to the setup commands: in the flat mirror run
`node packages/scripts/install-layered.mjs` (there is no
`packages/evolution/scripts` directory here), while the upstream checkout
uses `packages/evolution/scripts/install-layered.mjs`.

> **V9-03 (0.3.50):** this file is the canonical copy — the mirrored
> `packages/README.md` is synced from here on every release (robocopy);
> the mirror-root `README.md` is a sibling document with its own install
> sections, keep its notes in sync manually (see its top note).
