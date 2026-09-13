# Evolution plugin family

Hermes-style self-evolution for DeepSeek Harness, implemented as composable
Cordis plugins. The model may only propose and write **memory** and **skills**;
policy, prompts, routing, state, and audit history are control-plane data.

> Community-published packages under `@lmzhen` are maintained by the
> dsh-evolution community and are not official DeepSeek releases.
>
> **UPSTREAM SCOPE OCCUPANCY (P2-12, v15).** In the monorepo/overlay the
> family occupies the upstream `@deepseek-ai` scope; publishing rewrites the
> scope to `@lmzhen`. All `dsh-evolution-*` names are family-owned. Five
> mirror-only MEMORY SEAM + TOOL packages are NOT in the `dsh-evolution-*`
> namespace (they have no upstream counterpart and the highest collision
> risk) — `@deepseek-ai/dsh-memory`,
> `@deepseek-ai/dsh-skill-usage`, `@deepseek-ai/dsh-memory-files`,
> `@deepseek-ai/dsh-tool-memory`, `@deepseek-ai/dsh-tool-skill-manage`.
> UPSTREAM UPGRADE CHECK: re-verify this list on every upstream bump — if the
> upstream introduces a same-named package, the overlay would double-provide /
> shadow it and the seam must be renamed or reconciled BEFORE merging.


## Package map

| Package | Role |
|---|---|
| `evolution-core` | Shared pure stores/prompts/signals/constants; no main Cordis plugin entry (ships the `./invariant` companion entry only) |
| `evolution-io` / `evolution-io-node` | File-tree IO seam registry + atomic node:fs provider |
| `memory` / `memory-files` / `tool-memory` | Memory seam: registry, provider, model tool |
| `skill-usage` / `tool-skill-manage` / `evolution-skill-catalog` | Usage telemetry + `skill_manage` + native `ctx.skills` provider |
| `evolution-policy` | Immutable policy snapshot + native `tools.guard` denials |
| `evolution-plan-validator` | Deterministic validation for model-produced plans |
| `evolution-state-storage` / `-domain` / `-json` / `evolution-state` | State seam: provider registry, storage-domain KV, JSON fallback, consumer |
| `evolution-approval` | Hermes-style staged/pending writes over `evolutionState` |
| `evolution-threat` | `tools.guard` content threat guard |
| `evolution-review` | Signal gate → one-shot subagent → validated plan execution |
| `evolution-curator` | Deterministic lifecycle + LLM nomination + run reports + min-idle gate |
| `evolution-activity` | Durable audit store for self-evolution plan outcomes (`evolution/plan-applied`) |
| `evolution-feedback` | Durable feedback store; exposes `evolutionFeedback.record()` for hosts/custom commands — the family ships NO producer (the upstream `/feedback` event is free text), so `feedback_score`/`feedback_warn` fire only when a deployment wires one (union-read with `quality_warn` in the curator) |
| `evolution-learning-graph` | Graph command over skills + memory |
| `evolution-replay` | A/B replay scoring + session-event driver |
| `evolution-commands` | `/evolution` command surface (see the command table below — rendered from the registry single source) |
| `evolution-maintenance` | Deterministic maintenance-scan surface (snapshot / drift signals / facts) |
| `evolution-host` | Host-plane infrastructure bundle (no memory/skill model tools; ships the read-only `maintenance_probe` diagnostic) |
| `evolution-agent` | Agent preset: standard tools + the four model rows (`memory` / `skill_manage` / session search / skill catalog) |
| `evolution-preset` | Compatibility one-click bundle (`cordis.yml` standalone, `cordis.patch.yml` overlay) |
| `evolution-all` | Full-functionality bundle — DEFAULT install (infra + model tools, profile-root) |

## Installation

**Validated platform line: DSH `0.1.5-rc.2`.** That single version is what
`.github/workflows/release.yml` pins as `PLATFORM_VERSION`, what the CI
`compat-check` job validates against (`dsh-v0.1.5-rc.2`), and what every
published `@deepseek-ai/dsh-*` dependency range declares (`^0.1.5-rc.2`).
`0.1.1-rc.2` and earlier are **outside the support window**: a `^0.1.5-rc.2`
range does not resolve them (node-semver rejects a prerelease from a different
major.minor.patch), so installing this line on an older platform fails at
resolution rather than misbehaving at runtime. See
`scripts/verify-platform-ranges.mjs` — the support window *is* the anchor, and
that script asserts it.

See [INSTALL.md](./INSTALL.md) for the layered host/agent flow, the one-click
compatibility flow, and profile override examples. Its install-form table also
carries the per-form status against this platform line (verified / not yet
exercised), and `docs/v33-no-action-register.md` records every platform change
reviewed this round that needs no code action.

## Command reference

The `/evolution` surface below is generated from the subcommand registry
(`evolution-commands/src/registry.ts` — single source shared with the
input-declaration hint and the emitted help/README text; `registry.spec.ts`
pins the equality).

| Command | Purpose |
|---|---|
| `/evolution pending [--detail]` | list staged evolution writes (--detail shows staged args) |
| `/evolution approve <id>` | replay an approved staged write through its runner |
| `/evolution reject <id>` | drop a staged write without running it |
| `/evolution doctor [--json]` | read-only self-check: install form, conflicts, env, services (--json feeds scripts) |
| `/evolution curator run\|pause\|resume\|status\|report\|scope` | run one curation pass, control or inspect automatic curation |
| `/evolution mutations` | list skill-mutation audit records |
| `/evolution restore` | restore skills from the latest snapshot |
| `/evolution consolidate <target> <sources...> [--plan <runId>]` | merge source skills into a target umbrella skill |
| `/evolution skill restore <name>` | restore one archived skill by name |
| `/evolution skills health` | structure-health verdicts for the skill library |
| `/evolution skills refresh` | drop the catalog caches and re-read the tree |
| `/evolution learn [request]` | send a learning request to this session |
| `/evolution maintain [--timeout=<ms> \| --facts]` | run a maintenance scan (--facts: 0-token preview) |
| `/evolution preset install` | generate the Evolution agent preset into the user root |
| `/evolution restructure <name> "<heading>" <to_file> [--plan <runId>]` | move a body section into a references/ file |
| `/evolution replay` | compare plan outcomes across sessions and restarts (backfilled from the activity store) |

## Composition details

### Configuration dials (5 knobs — field names pinned by T-WC2)

| Dial | Values | Underlying config fields |
|---|---|---|
| autonomy | auto / reviewed / observe | approval.enabled (profile row), reviewEnabled (evolution-review), pending/approve/reject commands |
| scope | global / per-session | package choice: evolution-all (global, DEFAULT) vs host + evolution preset (per-session) |
| curatorBackground | on / off | autoStart, intervalHours, minIdleHours (evolution-curator) |
| memoryInjection | on / off | memoryEnabled (tool-memory: off = the whole row is a no-op, no tool/guidance/snapshot) |
| threatStrictness | strict / exempt-list | threat config + threatExemptLabels (core SkillLibrary/MemoryStore option) |

### Environment variables (DSH_EVOLUTION_*)

| Variable | Layer | Effect |
|---|---|---|
| DSH_EVOLUTION_SESSION_QUERY | profile config (`!!js` in bundle patch) | startup / first-search / never; invalid normalizes to startup |
| DSH_EVOLUTION_SESSION_QUERY_PATH | profile config (`!!js`) | durable index path; empty falls back to `$DSH_HOME/evolution/session-query.db` |
| DSH_EVOLUTION_ALLOW_ROW_COLLISIONS | plugin code (core env.ts) | `1` downgrades delta-row collision from fail-loud to warn+keep-both |
| EVOLUTION_SCOPE | source installers only (`install-layered.mjs`, `test-support/row-contract.ts`) | scope written into generated profile/preset rows; defaults to the package's own scope. Plugin runtime never reads it |
| DSH_EVOLUTION_DELTA_PATH | source installers only (`install-layered.mjs`) | overrides the agent-preset delta fragment path the layered installer composes from; default stays the packaged `evolution-agent/agent.cordis.yml`. Plugin runtime never reads it |
| DSH_EVOLUTION_ARCH_STRICT | guard scripts only (`verify-arch-guards.mjs`) | `1` makes the architecture-duplication guard fail loud instead of warn (same effect as `--strict`). Plugin runtime never reads it |
| DSH_EVOLUTION_DECLARED_CONFIG_STRICT | guard scripts only (`verify-declared-config.mjs`) | `1` makes the declared-config-reach guard fail loud instead of warn (same effect as `--strict`). Plugin runtime never reads it |

### Model-visible prompt prefix and the KV cache

The family contributes exactly two `systemPrompt.section` entries — the memory
guidance (`MEMORY_GUIDANCE_SECTION_ORDER`) and the skills guidance
(`SKILLS_GUIDANCE_SECTION_ORDER`), both in `evolution-core/src/constants.ts`.
They are part of the system prefix, so **changing their text or their order
invalidates every session's KV-cache prefix once**. The other injected surface,
the memory snapshot, is registered as `systemPrompt.context`: it is a persisted
user-role snapshot appended at the message tail and skipped while its text is
unchanged, so it is not part of the prefix.

0.1.5-rc.2 re-scaled the platform's first-party section orders from `-100…190`
to `-1000…10200` and changed the equal-order tie-break to code-unit name order,
which moved both family sections into the middle of the tool guidance. The two
orders were therefore re-stated as the named constants above — above every
first-party section on the target line — and that is the single prefix shift of
this round. `scripts/verify-platform-contract.mjs --upstream <tree>` fails when
the platform's highest first-party order ever reaches them.

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
`evolution-maintenance-tools` row, its own `session-query-sqlite` index
override and the same root-level `tool-skill` 60-char catalog cap override as
the host bundle. Sessions running under an agent preset read the PRESET-scope
`tool-skill` row, which no profile patch can reach — and under the web profile
the platform DISABLES the profile-root row
(`packages/bundle/web-app/cordis.patch.yml`), so a profile-root override takes
effect in headless/base installs only. For presets the evolution composer
generates (`/evolution preset install` and the layered flow — one rule since
0.3.53) the composer injects the cap onto that preset row; a session running a
preset the composer did not generate (a platform preset, or one anchored
before the composer ran) keeps the platform default until the preset is
recomposed or the upstream default changes. The `verify-declared-config.mjs`
guard prints this reach per profile and per declared key. The 60-char authoring
bar enforced by tool-skill-manage applies regardless.

Or compose manually — order matters because provider rows declare `inject`.
This mirrors the row set shipped by the two bundles (evolution-host infra +
evolution-agent model tools); in the OVERLAY the DSH profile HOST provides the storage facility
(`storage`/`storage-json`/`storage-domain`), which this preset does not own;
the standalone `evolution-preset` package declares those storage packages as
dependencies and mounts them from its own `cordis.yml`. `evolution-state-domain`
joins only when mounted (D-30):

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
    path: !!js (process.env.DSH_EVOLUTION_SESSION_QUERY_PATH || '').trim() || dshHomePath('evolution', 'session-query.db')
    openAt: !!js "['startup', 'first-search', 'never'].includes(process.env.DSH_EVOLUTION_SESSION_QUERY) ? process.env.DSH_EVOLUTION_SESSION_QUERY : 'startup'"
- id: tool-skill
  config:
    catalogDescriptionMaxLength: 60
```

## Control-plane invariants

1. Model writes only `memory` and `skills`; policy/prompts/routing/state are
   never model-writable. `evolution-policy` installs a monotonic
   `ctx.tools.guard` and `evolution-plan-validator` rejects forbidden fields.
2. Every mutation is gated by the `tools.guard` threat scan (the pre-execute allow path) and, when
   enabled, the staged approval service. Approved writes replay through the
   exact runner they were registered with.
3. Skill destruction is never a hard delete: archival moves to `.archive/`,
   and every curator run snapshots the skill tree first (a skill held by a
   live writer's lock is skipped, recorded in the snapshot manifest, and
   reported as not-restored by a later restore).
4. Review plans require event-sequence evidence bounded by the session seq;
   invalid ops are dropped while valid ops still apply.
5. Provider seams (`ctx.evolutionIo`, `ctx.evolutionStateStorage`) keep media
   decisions out of policy code; media providers perform no node:fs IO of
   their own (commands' preset/doctor helpers are the explicit direct-fs exception).

## Extension points

One change point per extension; a second edit anywhere else means the seam is
being bypassed. (v14 audit §7.)

| Extension | The one place to change | Must ship with it |
|---|---|---|
| New IO medium (remote/in-memory backend) | `evolution-io` `registerProvider` + one bundle row | seam-method passthrough test; declare the default provider (`{ default: true }`) or leave the node backend as the declared default |
| New durable-state backend | `evolution-state-storage` `registerProvider` + record schema | schema in **zod** (`domainTable`) for the domain provider; the json provider's `gateScan` must accept the same records — **both read AND write paths** (v14 P2-1) |
| New memory backend | `ctx.memory.registerProvider` | `snapshot()` **and** `renderContext()` must both be single-generation (v14 P2-3) |
| New threat rule | `evolution-core/threats.ts` `PATTERNS` row + `scope` | one false-positive and one true-positive case; add the label to the exemption surface if it can be benign |
| New `/evolution` subcommand | `evolution-commands/src/registry.ts` row + handler | the README command table is rendered from this table (T-WD2 pins it) |
| New model-facing tool | the tool package + the `evolution-agent` delta row (+ a bundle row only if every session needs it) | tool description must name the real fields/tools; unit test on the tool surface |
| New agent-preset row | `evolution-agent/agent.cordis.yml` (delta only) | never repeat a host-owned row; `composePresetComposition` / installer byte-parity test |
| Upstream platform bump | `UPSTREAM_SHA` + `PLATFORM_VERSION` + the name-collision check | CI baseline **and** released-compat chains; re-verify the seams listed in the audit report §3 |

## Development: the two layouts and their tsconfigs

Dev source lives at `packages/evolution/*`; the mirrored publication repo uses
the flat form `packages/evolution-*`. The repo `tsconfig.base.json` /
`tsconfig.host.json` carry the `@deepseek-ai/dsh-evolution*` alias (the publish chain rewrites the scope; no `@lmzhen` alias exists in tsconfig)
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
