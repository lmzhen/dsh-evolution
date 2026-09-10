# Evolution plugin family

> **V9-03 (0.3.50):** `packages/README.md` is synced from the dev-tree
> `README.md` by the release robocopy (its canonical copy) — this root file
> and the packages copy are SIBLING documents with parallel install sections;
> keep them in sync manually (the packages copy carries the same note at its
> top).

Hermes-style self-evolution for DeepSeek Harness, implemented as composable
Cordis plugins. The model may only propose and write **memory** and **skills**;
policy, prompts, routing, state, and audit history are control-plane data.

> Community-published packages under `@lmzhen` are maintained by the
> dsh-evolution community and are not official DeepSeek releases.

## Concepts: the two evolution loops

Evolution runs two loops. Both share the same engine — **Review** (watch the
conversation and produce a change plan) + **Curator** (merge, demote, archive
the skills over time) + **Governance** (threat scan, immutable policy,
staged approval as the gate):

**Memory Evolution** — observe conversations → review → memory plan →
write (memory entries) → injected into new sessions. Carrier: `memory` /
`memory-files` / `tool-memory` / review.

**Skill Evolution** — observe conversations → review → skill plan →
(when gated: approve) → write/patch the skill tree → catalog shows it to the
model → the model extends/uses it → usage stats → curator merges/archives
(metabolism). Carrier: `skill-store` / `tool-skill-manage` / `skill-catalog`
/ `curator` / `skill-usage` / review.

**Vocabulary (single source in code + docs):** `plan` — a review-proposed
change set; `pending` — a staged write awaiting approval (approve replays it
through its runner); `staged` — approval-stage writes; `snapshot` — point-in-time
skill-tree backup (restore target); `consolidate` — merge sources into an
umbrella skill; `nomination` — the curator's LLM proposal; `drift` —
out-of-band file edits detected before write; `substantive` — review-trigger
budget class; `catalog` — the model-visible skill index (60-char cap);
`rank` — catalog provider priority; `review mode` — how a review decides
(cadence / subagent plan).

## Get started

**First 10 minutes** (defaults as shipped): after the M1 install and restart,
a review observes the first sessions — the FIRST automatic pass is deferred
until the interval/usage window opens, so nothing writes on boot. The first
memory entry arrives after a review decides a conversation fact is worth
keeping; the first skill edit arrives after a review proposes a change the
conversation supports. Everything is visible in `/evolution doctor` (form,
services, pending) and every write shows in `/evolution mutations`. To gate
the background writes, use M2 (human approval); M3 removes only the model
tools — its automation keeps running.

### Install modes (M1-M4)

| Mode | One-liner | What you get |
|---|---|---|
| **M1 Full-auto (DEFAULT)** | `dsh plugin --profile web add @lmzhen/dsh-evolution-all` | Both loops run and write automatically; model tools in every session |
| **M2 Human gated** | M1 + `approval.enabled: true` | Evolution may propose; every write shows as `/evolution pending` for you to approve/reject |
| **M3 Infrastructure only** | `dsh plugin --profile web add @lmzhen/dsh-evolution-host` | Automation runs but the model has no memory/skill tools — nothing gets written by the model |
| **M4 Per-session (advanced)** | host + `/evolution preset install` | Tools only in sessions selecting the Evolution preset (exclusive with M1) |

**Fastest check — `/evolution doctor`:** after any install, run it once: it
tells you the install form, flags conflicts (all/host/preset double mounts,
all vs layered), checks `DSH_EVOLUTION_*` variables and the mounted services,
and ends with suggested next steps. Install docs point here instead of
repeating the same prose.

## Development: package map (mechanism)

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
| `evolution-feedback` | Durable feedback → `feedback_score`/`feedback_warn` → curator (union-read with `quality_warn`) |
| `evolution-learning-graph` | Graph command over skills + memory |
| `evolution-replay` | A/B replay scoring + session-event driver |
| `evolution-commands` | The `/evolution` command surface (approval queue, curator, maintenance, presets) — full enumeration under "Command surface" below |
| `evolution-maintenance` | Deterministic maintenance-scan surface (snapshot / drift signals / facts) |
| `evolution-host` | Host-plane infrastructure bundle (no memory/skill model tools; ships the read-only `maintenance_probe` diagnostic) |
| `evolution-agent` | Agent preset: standard tools + `memory`/`skill_manage` model entry |
| `evolution-preset` | Compatibility one-click bundle (`cordis.yml` standalone, `cordis.patch.yml` overlay) |
| `evolution-all` | One-command aggregate entry (host + model tools) |

## Reference

### Command surface (`/evolution`)

Generated from the subcommand registry (`evolution-commands/src/registry.ts` —
single source with the input hint and the emitted help/README text):

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
| `/evolution replay` | compare prompt-bundle replay for this session |

### Configuration dials (5 knobs, underlying fields pinned by tests)

| Dial | Values | Underlying fields (all in package Config / profile rows) |
|---|---|---|
| autonomy | auto / reviewed / observe | `approval.enabled` (profile row), `reviewEnabled` (evolution-review), `/evolution pending\|approve\|reject` |
| scope | global / per-session | package choice — evolution-all (global, DEFAULT) vs host + evolution preset (per-session) |
| curatorBackground | on / off | `autoStart` / `intervalHours` / `minIdleHours` (evolution-curator) |
| memoryInjection | on / off | `memoryEnabled` (tool-memory: the whole row is a no-op when off — no `memory` tool registration and no guidance/snapshot injection) |
| threatStrictness | strict / exempt-list | `threatExemptLabels` — per config site: the evolution-threat row, the tool-skill-manage row, the evolution-commands row, and the SkillLibrary/MemoryStore store options (P2-18 + P2-4) |

Fine-grained knobs run into the three-level appendix: **daily** (review
intervals, curator cadence), **tuning** (health thresholds, quality weights),
**high-risk** (maxOpsPerPlan, char budgets, review/curator model choice —
cost and behavior).

### Environment variables

| Variable | Where read | Effect |
|---|---|---|
| `DSH_EVOLUTION_SESSION_QUERY` | profile config (`!!js` in bundle patch) | `startup` / `first-search` / `never` (SQLite index openAt); invalid values normalize to `startup` |
| `DSH_EVOLUTION_SESSION_QUERY_PATH` | profile config (`!!js` in bundle patch) | durable index path; empty falls back to `$DSH_HOME/evolution/session-query.db` |
| `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS` | plugin code (core `env.ts`) | `1` downgrades a preset delta-row collision from fail-loud to warn+keep-both |
| `EVOLUTION_SCOPE` | source installers only (`install-layered.mjs`, `test-support/row-contract.ts`) | scope written into generated profile/preset rows; defaults to the package's own scope. Plugin runtime never reads it |

## Installation

See [INSTALL.md](./INSTALL.md) for the layered host/agent flow, the one-click
compatibility flow, and profile override examples.

## Operate

### Troubleshooting

| Symptom / code | Meaning | Next step |
|---|---|---|
| startup: `invariants: package "…" is already registered` | two bundles or bundle+preset double-mount the same rows | keep ONE of evolution-all / evolution-host / evolution-preset / layered — run `/evolution doctor` |
| `E-301` | approval service not mounted | evolution-approval row ships with host/all; run doctor |
| `E-302` | curator service not mounted | mount evolution-curator row; run doctor |
| `E-303` | replay service not mounted | mount evolution-replay row; run doctor |
| threat deny (memory/skill write) | strict scan hit an instruction-like phrase | rephrase; or exempt a known-innocent label via `threatExemptLabels` (dial reference) |
| `/evolution doctor` reports `install form: none` | no bundle installed | `dsh plugin --profile web add @lmzhen/dsh-evolution-all` |

### Migration (0.3.x → 0.3.56)

| Current install | What changes on upgrade | Action |
|---|---|---|
| host (infra only) | nothing | stays M3 |
| evolution-all (passive aggregate era) | becomes the FULL bundle — every session gains the model tools | keep (M1) or switch to host (M3) |
| one-click preset | nothing | stays; new installs should use all |
| layered (host + preset) | nothing | stays; don't add all (exclusive) |

## Development: composition & bundles

### Full bundle (DEFAULT, 0.3.54)

Install everything at profile root in one step — no agent preset, no session
choice:

```yaml
- id: dsh-evolution-all
  name: '@lmzhen/dsh-evolution-all'
```

`all` mounts the host automation AND the four model tools
(`memory` / `skill_manage` / `session_search` / skill catalog) with the
SKILLS/MEMORY guidance injection in every session.

### Layered install (host + preset, per-session tools)

Install the host bundle into the profile:

```yaml
- id: dsh-evolution-host
  name: '@lmzhen/dsh-evolution-host'
```

Then select the `Evolution` agent preset for sessions that should expose the
`memory` / `skill_manage` tools. Sessions on other presets keep the shared
automation (review, curator, approval, observability) without model-facing
evolution tools. **`all` and this layout are exclusive** — do not combine them.

> **One-time step (V7-06, 0.3.43):** before a session can select the `Evolution`
> preset, run `/evolution preset install` once in a session on any preset —
> it writes `.agent-presets/evolution/` so the preset actually exists in the
> profile. See the Chinese README ("Evolution 预设无需手动拷贝" note) for the
> same flow; without this step a `dsh plugin add`-installed host is mounted but
> the preset is absent.

### One-click compatibility install

Use the legacy preset overlay on a standard DSH host:

```yaml
- id: dsh-evolution
  name: '@lmzhen/dsh-evolution-preset'
```

This one-click preset, the `all` bundle and the layered `evolution-host`
layout are ALTERNATIVE installs (mutual exclusion, E-33) — install one, not
two, or the shared infra rows mount twice and startup fails loud. The one-click
preset carries its own `evolution-maintenance-tools` row, its own
`session-query-sqlite` index override and the same root-level `tool-skill`
60-char catalog cap override as the host bundle. Sessions running under an
agent preset read the PRESET-scope `tool-skill` row, which no profile patch
can reach; the layered flow injects the cap onto that row at generation time
(V10-14). The 60-char authoring bar enforced by tool-skill-manage applies
regardless.

Or compose manually — order matters because provider rows declare `inject`.
This mirrors the row set shipped by the two bundles (evolution-host infra +
evolution-agent model tools); in the OVERLAY the DSH profile HOST provides the storage facility
(`storage`/`storage-json`/`storage-domain`), which this preset does not own;
the standalone `evolution-preset` package declares those storage packages as
dependencies and mounts them from its own `cordis.yml`. `evolution-state-domain`
joins only when mounted (D-30):

```yaml
- id: evolution-policy
  name: '@lmzhen/dsh-evolution-policy'
- id: evolution-io
  name: '@lmzhen/dsh-evolution-io'
- id: evolution-io-node
  name: '@lmzhen/dsh-evolution-io-node'
- id: evolution-state-storage
  name: '@lmzhen/dsh-evolution-state-storage'
- id: evolution-state-domain
  name: '@lmzhen/dsh-evolution-state-domain'
  # Opt-in: joins the HOST storage-domain facility when mounted; disabled by
  # default so evolution-state-json stays the portable backend.
  disabled: true
- id: evolution-state-json
  name: '@lmzhen/dsh-evolution-state-json'
- id: evolution-state
  name: '@lmzhen/dsh-evolution-state'
- id: memory
  name: '@lmzhen/dsh-memory'
- id: memory-files
  name: '@lmzhen/dsh-memory-files'
- id: skill-usage
  name: '@lmzhen/dsh-skill-usage'
# model-facing tools (evolution-agent preset layer)
- id: tool-memory
  name: '@lmzhen/dsh-tool-memory'
- id: tool-skill-manage
  name: '@lmzhen/dsh-tool-skill-manage'
- id: tool-session-query
  name: '@lmzhen/dsh-tool-session-query'
- id: evolution-skill-catalog
  name: '@lmzhen/dsh-evolution-skill-catalog'
- id: evolution-approval
  name: '@lmzhen/dsh-evolution-approval'
  config:
    enabled: false
    stageForeground: true
- id: evolution-threat
  name: '@lmzhen/dsh-evolution-threat'
- id: evolution-review
  name: '@lmzhen/dsh-evolution-review'
  config:
    reviewToolAllow: [skill]
- id: evolution-curator
  name: '@lmzhen/dsh-evolution-curator'
- id: evolution-commands
  name: '@lmzhen/dsh-evolution-commands'
- id: evolution-maintenance-tools
  name: '@lmzhen/dsh-evolution-maintenance/tools'
- id: evolution-activity
  name: '@lmzhen/dsh-evolution-activity'
- id: evolution-feedback
  name: '@lmzhen/dsh-evolution-feedback'
- id: evolution-learning-graph
  name: '@lmzhen/dsh-evolution-learning-graph'
- id: evolution-replay
  name: '@lmzhen/dsh-evolution-replay'

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
   and every curator run snapshots the full skill tree first.
4. Review plans require event-sequence evidence bounded by the session seq;
   invalid ops are dropped while valid ops still apply.
5. Provider seams (`ctx.evolutionIo`, `ctx.evolutionStateStorage`) keep media
   decisions out of policy code; media providers perform no node:fs IO of
   their own (commands' preset/doctor helpers are the explicit direct-fs exception).

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
The same is true of the per-package `tsconfig.json` files: they keep the dev
tree's `"extends": "../../../tsconfig.base.json"` depth and reference
`../../core/session`, `../../../vendor/cordis` and
`../../runtime-diagnostics/invariants`, none of which exist in the flat
mirror; `tsconfig.base.json`'s `paths` likewise point at `./packages/evolution/*`
and `vendor/*`, and `tsconfig.host.json` includes `apps/web/tests/**` and
`packages/evolution/test-support/**`. Type-checking therefore runs in the CI
overlay tree, never in the mirror checkout itself.
The same layout rule applies to the setup commands: in the flat mirror run
`node packages/scripts/install-layered.mjs` (there is no
`packages/evolution/scripts` directory here), while the upstream checkout
uses `packages/evolution/scripts/install-layered.mjs`.

Tests rely on the same merged layout: the suites import ~30 `@deepseek-ai/*`
modules that are intentionally NOT declared in the packages'
`package.json`. Those imports resolve only in the merged upstream tree (the
same G5.5 rule as the tsconfig paths above) — a known, accepted tradeoff, and
devDependencies are deliberately NOT added for the tests (the merged tree is
the only layout where they run; declaring them would just add a second
surface to keep in sync).

## Upstream upgrade checklist

Walk through this list on every upstream bump (see `UPSTREAM_SHA`):

1. **Skill-provider shadow rank** (`evolution-skill-catalog`): our provider
   registers `EVOLUTION_SKILL_RANK = 390` and relies on the upstream
   `USER_DSH_RANK` (400 in 0.1.1-rc.2) sorting ABOVE it — lower rank wins the
   `user-dsh` source shadow. Both constants are private to their owners: if
   upstream changes either value or the comparison semantics, our provider
   silently loses the shadow. Re-verify both sides on upgrade.
2. **`@deepseek-ai` package-name collision**: inside the upstream monorepo the
   family occupies the official `@deepseek-ai` names (`dsh-memory`,
   `dsh-tool-memory`, `dsh-skill-usage`, `dsh-memory-files`,
   `dsh-tool-skill-manage`, …) and `prepare-release --scope` rewrites them to
   the publish scope (`@lmzhen`) in every manifest, `cordis*.yml`,
   `agent.cordis.yml` and built `.js`/`.d.ts`. Before adopting an upstream
   release, check its package list for new names that collide with ours — a
   collision makes resolution ambiguous.
