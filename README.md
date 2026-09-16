# dsh-evolution · self-evolving memory & skills for DeepSeek Harness

**English** · [中文](./README.zh.md)

<p align="center">
  <a href="https://www.npmjs.com/package/@lmzhen/dsh-evolution-all"><img src="https://img.shields.io/npm/v/@lmzhen/dsh-evolution-all?style=flat-square&label=npm&color=4c6ef5" alt="npm version"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@lmzhen/dsh-evolution-all"><img src="https://img.shields.io/npm/dm/@lmzhen/dsh-evolution-all?style=flat-square&label=downloads%2Fmo" alt="npm downloads"></a>
  &nbsp;
  <a href="https://github.com/lmzhen/dsh-evolution/actions/workflows/release.yml"><img src="https://github.com/lmzhen/dsh-evolution/actions/workflows/release.yml/badge.svg?branch=main" alt="release CI"></a>
  &nbsp;
  <a href="https://github.com/lmzhen/dsh-evolution"><img src="https://img.shields.io/github/stars/lmzhen/dsh-evolution?style=flat-square&label=stars" alt="stars"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-0.1.5--rc.2-4c6ef5?style=flat-square" alt="validated platform line">
  &nbsp;
  <img src="https://img.shields.io/badge/node-22.19%2B%20%7C%2024%2B-339933?style=flat-square" alt="node">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT">
</p>

<p align="center">
  <strong>Hermes-style self-evolution for DeepSeek Harness — one install, two loops.</strong><br>
  <em>review · memory · skills · curator · approval gate · threat scan · audit trail</em>
</p>

<p align="center">
  <a href="#what-it-is">What it is</a> ·
  <a href="#why-this-exists">Why</a> ·
  <a href="#install-in-60-seconds">Install</a> ·
  <a href="#choose-your-install-m1m4">Choose your install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#observability--control">Observe</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#security--boundaries">Boundaries</a> ·
  <a href="#known-limitations">Limitations</a> ·
  <a href="#troubleshooting--faq">FAQ</a> ·
  <a href="#documentation-index">Docs</a>
</p>

> Community-published packages under `@lmzhen` are maintained by the dsh-evolution
> community and are **not** official DeepSeek releases. `@deepseek-ai/*` package names
> and DeepSeek branding are not used by these releases.

## What it is

A family of **29 composable Cordis plugins** that give a DeepSeek Harness install a
self-evolution layer: the agent reviews its own conversations, keeps **memory**, proposes
and patches **skills**, and curates that skill library over time — with a
policy/threat/approval control plane around every write.

The model may only propose and write **memory** and **skills**. Policy, prompts, routing,
state and audit history are control-plane data the model can never write.

What it is **not**: not a model, not a hosted service, and not a GUI of its own — there
is no browser panel to install. Everything it adds is model tools, slash commands, and
files under your own `$DSH_HOME`.

## Why this exists

Coding agents forget. They re-learn the same project conventions every session, and the
"skills" they accumulate never improve, never merge, and never retire. Hermes Agent
solved this with two loops; this family ports that design to the DeepSeek Harness plugin
model, keeping every write observable and reversible:

```text
        conversation events
                │
   ┌────────────▼────────────┐        ┌───────────────────────┐
   │  Review (gate + plan)   │───────▶│  Memory Evolution     │  <DSH_HOME>/memories
   │  cadence / completion   │        │  durable facts        │  injected next session
   └────────────┬────────────┘        └───────────────────────┘
                │
                │                     ┌───────────────────────┐
                └────────────────────▶│  Skill Evolution      │  <DSH_HOME>/skills
                                      │  write · patch · merge│  catalog shows them
                                      └───────────┬───────────┘
                                                  │ usage + feedback
                                      ┌───────────▼───────────┐
                                      │  Curator (metabolism) │  merge · demote · archive
                                      └───────────────────────┘
     every step passes: threat scan → immutable policy → (optional) approval gate
```

## Native DSH vs. + dsh-evolution

| Capability | Native DeepSeek Harness | With this family |
|---|---|---|
| Memory across sessions | manual notes | review-written memory + user profile, injected into new sessions |
| Skill library | files you write by hand | model-proposed writes/patches, validated plans, catalog with a 60-char cap |
| Skill upkeep | none | curator: merge near-duplicates, demote, archive, snapshot before every run |
| Write safety | none | ordered guard: threat scan → immutable policy → staged approval (opt-in) |
| Audit trail | none | `/evolution mutations`, per-run curator reports, activity store |
| Usage insight | none | per-skill use/view/patch counters; low-quality flags |
| Conversation review | none | cadence/completion-triggered review in-session, or an opt-in subagent reviewer |
| Self-improvement loop | none | feedback → quality → curator decisions → catalog ranking |

## Install in 60 seconds

```bash
# 1. the default full bundle (infra + model tools in every session)
dsh plugin --profile web add @lmzhen/dsh-evolution-all

# 2. restart the host so the profile is re-composed
# 3. ask any session:
/evolution doctor
```

Gated writes instead of full-auto? Add `approval.enabled: true` to that row (mode M2
below). Everything else has a sensible default: nothing writes on boot, and the first
automatic review only fires once the interval/usage window opens.

A real install looks like this (0.3.83, this project's own host):

```text
$ dsh plugin --profile web add @lmzhen/dsh-evolution-all
+ @lmzhen/dsh-evolution-all 0.3.83   … 28 packages, Done in 8.3s

$ dsh --profile web --dump-config | wc -l
773                      # composed lines; 207 distinct row ids, 0 duplicates
```

## Choose your install (M1–M4)

The M numbers are defined HERE; the install **forms** and their per-platform verification
status are single-sourced in `packages/INSTALL.md`, and the layered variant's
session-level consequences are stated once in `packages/INSTALL.md` ("Install forms").

| Mode | How | What you get |
|---|---|---|
| **M1 Full-auto (DEFAULT)** | `dsh plugin --profile web add @lmzhen/dsh-evolution-all` | Both loops run and write; model tools in every session |
| **M2 Human gated** | M1 + `approval.enabled: true` | Evolution may propose; every write appears as `/evolution pending` for you to approve or reject |
| **M3 Infrastructure only** | `dsh plugin --profile web add @lmzhen/dsh-evolution-host` | Automation runs, the model gets **no** memory/skill tools |
| **M4 Per-session (advanced)** | M3 + `/evolution preset install` | Tools only in sessions that select the Evolution preset (mutually exclusive with M1 and the legacy one-click preset) |

The legacy one-click preset (`@lmzhen/dsh-evolution-preset`) is the compatibility
spelling of M1. On M1/M3 the row that pins the state medium matters: the bundle pins
`provider: json` so an unrelated overlay cannot silently move your state onto an empty
domain.

## Compatibility

| | Value |
|---|---|
| Validated DSH platform line | **`0.1.5-rc.2`** (`PLATFORM_VERSION`; `UPSTREAM_SHA=fb2c4b9e…`) |
| Declared dependency window | `^0.1.5-rc.2` on every `@deepseek-ai/dsh-*` peer/dependency |
| Family version | `0.3.83` (`@lmzhen/dsh-evolution-all`, npm `latest`) |
| Node | 22.19+ or 24+ (`engines`) |
| Per-form status | `packages/INSTALL.md` — which forms were exercised on this platform line, and which are source-level judgements |

A prerelease range admits **one** anchor, not a family of them: `^0.1.5-rc.2` rejects
later prerelease successors while admitting stable `0.1.5`. Earlier prerelease lines
(`0.1.1-rc.2` and older) fail at dependency resolution — that is the support window, not
a bug. When in doubt run `/evolution doctor`: it reports the install form it detected
and the rows it found.

## How it works

| Layer | What it does | Where it lives |
|---|---|---|
| Review | watches session events, applies the substantive gate, produces a validated plan | `evolution-review` (+ `evolution-plan-validator`) |
| Memory loop | writes durable facts and a user profile; injects guidance into new sessions | `memory` / `memory-files` / `tool-memory` |
| Skill loop | proposes/writes/patches skills through the `skill_manage` tool; the catalog shows them to the model | `tool-skill-manage` / `evolution-skill-catalog` |
| Curator | deterministic lifecycle (stale/archive) + LLM nomination, snapshot before every run | `evolution-curator` |
| Control plane | threat scan, immutable policy, optional staged approval with replay | `evolution-threat` / `evolution-policy` / `evolution-approval` |
| Plumbing | IO seam, state providers (json/domain), events, activity, replay, learning graph | `evolution-io*` / `evolution-state*` / `evolution-activity` / `evolution-replay` |

Where your data goes — all under your own home, no service in the middle:

```text
$DSH_HOME/evolution/events.json          append-only feedback/usage timeline
$DSH_HOME/evolution/review-state.json    per-session review counters
$DSH_HOME/evolution/activity.json        self-evolution plan outcomes
$DSH_HOME/evolution/reports/             curator run reports (json + md)
$DSH_HOME/skills/                        the skill tree (+ .usage.json counters)
$DSH_HOME/memories/                      MEMORY.md + USER.md
```

**Review delivery.** `reviewMode` defaults to `inject` (since 0.3.74): the review runs
inside the session at a conversation boundary, so nothing is spawned and no budget is
spent on a second prefix. `subagent` is an explicit opt-in for deployments that want the
review to read skills with a clean parent context or to use a dedicated model; that mode
is the one the review watchdog and the review-model knobs apply to.

**Session scoping.** Cross-session consumers (review, skill-usage) are declared
`sessionScoped`: they act on a session only when that session can resolve the family's
model tools. With the `all` bundle the model rows sit at profile root, so every session
qualifies; a host-only install (M3) legitimately never matches, and the plugin logs one
warning saying so instead of failing silently.

## What you get

| Capability | What it changes for you |
|---|---|
| **Memory that survives** | facts worth keeping are written during review and injected into later sessions — no more re-explaining your project each time |
| **Skills that improve** | the agent patches its own skills from what actually happened, with plans validated before execution |
| **Metabolism** | the curator merges near-duplicates, demotes unused skills and archives them — with a snapshot before each run so `restore` is always possible |
| **A gate you control** | one config flag turns every write into a `/evolution pending` item you approve or reject; approvals replay through the exact registered runner |
| **A threat guard with an exempt list** | instruction-like content in memory/skill writes is refused; known-innocent labels can be exempted per config site |
| **An audit trail** | `/evolution mutations` and per-run curator reports answer "what changed my skills, and when" |
| **Usage-driven decisions** | use/view/patch counters per skill, low-quality flags, and a catalog ranked so the model sees the good ones |
| **Feedback without a producer** | `evolutionFeedback.record()` is a public seam for your own hosts/commands; the family ships no producer of its own |
| **Replay and graph** | A/B replay scoring for skill changes, and a learning graph over skills and memory |

## Observability & control

Day one, four commands are enough — the full `/evolution` command table is rendered once
in `packages/README.md` (§Command reference, generated from the registry and pinned
byte-for-byte by its spec):

- `/evolution doctor` — what is installed: form, scoped rows, services, pending count.
- `/evolution pending` + `approve` / `reject` — the staged writes (M2).
- `/evolution curator status` — background curation: last run, next due, counts.
- `/evolution preset install [--base <name>[,<name>...]]` — generate the family agent
  preset (M4); one variant per named base, in one pass.

Then, when you want the paper trail: `/evolution mutations` (every write),
`/evolution release <id>` (recover an orphaned `executing` record),
`/evolution maintain --facts` (maintenance scan) and `/graph` (skills + memory view).

**Verify an install without asking the model anything:** the composed profile must have no
duplicate row ids, and the family rows must all be present.

```bash
dsh --profile web --dump-config | grep -c 'id: evolution-'   # 18 such rows
dsh --profile web --dump-config | grep -c 'id:'              # 207 ids, all distinct
```

On Windows, replace `grep -c` with `Select-String -Pattern … | Measure-Object`

## Configuration

Five semantic dials; every underlying field is a normal row config, and the fine-grained
knobs run into a three-level appendix (**daily** — review intervals, curator cadence;
**tuning** — health thresholds, quality weights; **high-risk** — `maxOpsPerPlan`, char
budgets, review/curator model choice).

| Dial | Values | Underlying fields |
|---|---|---|
| autonomy | auto / reviewed / observe | `approval.enabled` (profile row), `reviewEnabled` (evolution-review), `/evolution pending\|approve\|reject` |
| scope | global / per-session | package choice — evolution-all (global, DEFAULT) vs host + evolution preset (per-session) |
| curatorBackground | on / off | `autoStart` / `intervalHours` / `minIdleHours` (evolution-curator) |
| memoryInjection | on / off | `memoryEnabled` (tool-memory: the whole row is a no-op when off — no `memory` tool registration and no guidance/snapshot injection) |
| threatStrictness | strict / exempt-list | `threatExemptLabels` — declared per config site (guard rows, the command face, the store options); the owning list of declaring sites is single-sourced in `evolution-threat/README.md` |

Defaults that surprise people, stated up front: `reviewEnabled: true`,
`reviewMode: 'inject'`, `memoryInterval = skillInterval = 10` turns, substantive gate =
"≥3 tool calls **or** ≥200 user characters **or** ≥500 agent characters", curator tick
hourly with a due-ness interval of `168 h`.

Environment variables:

| Variable | Where read | Effect |
|---|---|---|
| `DSH_EVOLUTION_SESSION_QUERY` | profile config (`!!js` in bundle patch) | `startup` / `first-search` / `never` (SQLite index openAt); invalid values normalize to `startup` |
| `DSH_EVOLUTION_SESSION_QUERY_PATH` | profile config (`!!js` in bundle patch) | durable index path; empty falls back to `$DSH_HOME/evolution/session-query.db` |
| `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS` | plugin code (core `env.ts`) | `1` downgrades a preset delta-row collision from fail-loud to warn+keep-both |
| `EVOLUTION_SCOPE` | source installers only (`install-layered.mjs`, `test-support/row-contract.ts`) | scope written into generated profile/preset rows; defaults to the package's own scope. The plugin runtime never reads it |
| `DSH_EVOLUTION_DELTA_PATH` | source installers only (`install-layered.mjs`) | overrides the agent-preset delta fragment the layered installer composes from (default: the packaged `evolution-agent/agent.cordis.yml`); tests and one-off builds inject a fixture |
| `DSH_EVOLUTION_ARCH_STRICT` | guard scripts only (`verify-arch-guards.mjs`) | `1` makes the architecture-duplication guard fail loud instead of warn (same effect as `--strict`); the plugin runtime never reads it |
| `DSH_EVOLUTION_DECLARED_CONFIG_STRICT` | guard scripts only (`verify-declared-config.mjs`) | `1` makes the declared-config-reach guard fail loud instead of warn (same effect as `--strict`); the plugin runtime never reads it |

## Security & boundaries

1. **The model writes memory and skills only.** Policy, prompts, routing, state and audit
   history are never model-writable; `evolution-policy` installs a monotonic
   `ctx.tools.guard` and `evolution-plan-validator` rejects forbidden fields.
2. **Every mutation is gated.** The `tools.guard` threat scan runs on the pre-execute
   path, and with approval enabled a write is staged, reviewed by you, and replayed
   through the exact runner it registered with.
3. **Skill destruction is never a hard delete.** Archival moves to `.archive/`, and every
   curator run snapshots the skill tree first (a skill held by a live writer's lock is
   skipped, recorded, and reported as not-restored by a later restore).
4. **Review plans need evidence.** A plan is bounded by the session's event sequence;
   invalid ops are dropped while valid ones still apply.
5. **Redaction at the boundary.** Text that leaves the session for a model passes the
   family's secret-redaction pass (PEM blocks, URL credentials, inline assignments and
   camelCase credential keys).
6. **Nothing leaves your machine except the prompts you already send.** There is no
   telemetry service: counters and reports are files under `$DSH_HOME`. The family
   publishes no `./invariant` companion — the platform auto-assembles nothing, so a
   companion would never execute.

## Known limitations

- **`reviewMode` defaults to `inject`.** Reviews run inside the session, and the
  injected mode produces no `evolution/plan-applied` ledger — the activity store and
  replay views stay empty until you opt into `subagent` reviews.
- **Session-scoped consumers.** On M3 (host-only) review and usage telemetry never match
  a session; on M4 only sessions on the Evolution preset match.
- **No GUI panel.** The family adds slash commands and model tools, not a browser UI.
- **The curator is deliberately slow.** Hourly tick, 168 h due-ness by default — quiet
  weeks are normal; `/evolution curator status` says when the next run is due.
- **One platform anchor.** The support window is exactly `0.1.5-rc.2`; a new platform
  line needs a family migration (see the upstream checklist below).
- **`npm dist-tags.next` is stale** at `0.3.18` (a historical residual); `latest` is
  correct and is what `add` resolves.
- **Maintainer-side only:** the publish chain compares `packages/scripts/**` against a
  secondary checkout, so script changes are mirrored there before a release.

## Troubleshooting & FAQ

| Symptom / code | Meaning | Next step |
|---|---|---|
| startup: `invariants: package "…" is already registered` | two bundles or bundle+preset double-mount the same rows | keep ONE of evolution-all / evolution-host / evolution-preset |
| `E-301` | approval service not mounted | the evolution-approval row ships with host/all; run `/evolution doctor` |
| `E-302` | curator service not mounted | mount the evolution-curator row; run doctor |
| `E-303` | replay service not mounted | mount the evolution-replay row; run doctor |
| `E-306` | this deployment stages foreground writes, but `/evolution consolidate` / `restore` / `skill restore` (and, since 0.3.83, a session-less `restructure`) is not replayable through the skill runner | approve-and-execute directly, or set `stageForeground: false` deliberately |
| threat deny (memory/skill write) | the strict scan hit an instruction-like phrase | rephrase; or exempt a known-innocent label via `threatExemptLabels` |
| `/evolution doctor` reports `install form: none` | no bundle installed | `dsh plugin --profile web add @lmzhen/dsh-evolution-all` |

**Why has nothing been written yet?** The first review waits for the interval window
(`memoryInterval` / `skillInterval`, default 10 turns) and the substantive gate. A
one-line session is deliberately not worth a review.

**Why is `activity.json` empty?** Inject-mode reviews do not emit
`evolution/plan-applied` records. Switch to `reviewMode: 'subagent'` if you want that
ledger.

**How do I stop it writing?** Set `reviewEnabled: false` (no reviews at all),
`approval.enabled: true` (every write waits for you), or use M3 (no model tools).

**How do I check which version is actually running?** Compare
`profiles/<name>/pnpm-lock.yaml` with `npm view @lmzhen/dsh-evolution-all version`;
the profile is re-composed when the host restarts.

## Uninstall / rollback

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
```

Removing the row stops the loops but keeps your data: memory, skills, state, reports and
approval history stay under `$DSH_HOME` and are picked up again if you reinstall. The
skill tree is archived, never hard-deleted, so a rollback is a re-install plus `restore`.

## Documentation index

| Document | What it holds |
|---|---|
| [`INSTALL.md`](./INSTALL.md) | install forms and scopes, profile override examples, per-form status |
| [`packages/INSTALL.md`](./packages/INSTALL.md) | the install-FORM semantics and the per-platform verification matrix |
| [`packages/README.md`](./packages/README.md) | the rendered `/evolution` command reference and package-level mechanism details |
| [`CHANGELOG.md`](./CHANGELOG.md) | what changed in each version, with the reason and the evidence |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | where a fact is allowed to live, the 16-step gate, the house rules |

## Development

<details>
<summary><strong>Package map (29 published packages)</strong></summary>

| Package | Role |
|---|---|
| `evolution-core` | Shared pure stores/prompts/signals/constants; no main Cordis plugin entry and no `./invariant` companion |
| `evolution-io` / `evolution-io-node` | File-tree IO seam registry + atomic node:fs provider |
| `memory` / `memory-files` / `tool-memory` | Memory seam: registry, provider, model tool |
| `skill-usage` / `tool-skill-manage` / `evolution-skill-catalog` | Usage telemetry + `skill_manage` + native `ctx.skills` provider |
| `evolution-policy` | Immutable policy snapshot + native `tools.guard` denials |
| `evolution-plan-validator` | Deterministic validation for model-produced plans |
| `evolution-state-storage` / `-domain` / `-json` / `evolution-state` | State seam: provider registry, storage-domain KV, JSON fallback, consumer |
| `evolution-approval` | Hermes-style staged/pending writes over `evolutionState` |
| `evolution-threat` | `tools.guard` content threat guard |
| `evolution-review` | Signal gate → one-shot reviewer → validated plan execution |
| `evolution-curator` | Deterministic lifecycle + LLM nomination + run reports + min-idle gate |
| `evolution-activity` | Durable audit store for plan outcomes (`evolution/plan-applied`) |
| `evolution-feedback` | Durable feedback store; exposes `evolutionFeedback.record()` |
| `evolution-learning-graph` | Graph command over skills + memory |
| `evolution-replay` | A/B replay scoring + session-event driver |
| `evolution-commands` | The `/evolution` command surface |
| `evolution-maintenance` | Deterministic maintenance-scan surface (snapshot / drift signals / facts) |
| `evolution-host` | Host-plane infrastructure bundle (read-only `maintenance_probe` diagnostic) |
| `evolution-agent` | Agent preset: standard tools + the four model rows |
| `evolution-preset` | Compatibility one-click bundle |
| `evolution-all` | Full-functionality bundle — the DEFAULT install |

</details>

<details>
<summary><strong>The two layouts and their tsconfigs</strong></summary>

Authoring happens in the flat mirror (`packages/evolution-*`), which is also the
publication tree — the publish chain runs without its dev→mirror sync step, and nothing
copies a second tree over this one. The upstream checkout used for type-checking and tests
hosts the same sources under `packages/evolution/*` (CI builds that overlay from the
platform tag; the machine-local former dev tree is stale and marked
`AUTHORING-MOVED.md`). Those `packages/evolution/...` project references resolve only
in that checkout — a standalone flat mirror cannot run them.

`packages/scripts/**` is the one cross-tree obligation left: the publish chain's guard
compares it byte-for-byte against the secondary checkout's copy, so a script change is
mirrored there before a release.

</details>

<details>
<summary><strong>Upstream upgrade checklist (every platform bump)</strong></summary>

1. **Skill-provider shadow rank**: our provider registers `EVOLUTION_SKILL_RANK = 390`
   and relies on the upstream `USER_DSH_RANK` (400, re-verified on `0.1.5-rc.2`)
   sorting above it — the lower rank wins the `user-dsh` source shadow. Re-verify both
   sides on every bump.
2. **`@deepseek-ai` package-name collision**: inside the upstream monorepo the family
   occupies official-looking names, and the release tooling rewrites them to `@lmzhen` in
   every manifest, YAML and built `.js`/`.d.ts`. Check each new upstream release for
   names that collide with ours.
3. **ToolRuntime argument freeze**: `tool.execute` receives a `deepFreeze`d argument
   snapshot — build a NEW object instead of assigning onto `args`.
4. **Per-skill invocation frontmatter**: upstream parses `disable-model-invocation` /
   `user-invocable` per SKILL.md; our shadowing provider must keep parsing the same keys
   (its legacy-key postures are single-sourced in `evolution-skill-catalog/README.md`).
5. **Home-path semantics**: upstream `resolveDshHome` uses `trim()` only as the
   ADOPTION test, keeps the RAW env value, expands `~ `, and always resolves to an
   absolute path. `evolutionRoot` and `install-layered.mjs`'s `resolveHome` follow the
   same line; re-diff all three on upgrade.

</details>

<details>
<summary><strong>The gate, and where it runs</strong></summary>

Sixteen steps: type-check, lint and the full test suite run in the upstream checkout; the
family's own `verify-*` guards, the manifest and tsconfig checks and the mirror-parity
check run in the mirror. The executable table lives in `CONTRIBUTING.md` §The gate, and
a release is not a release until all sixteen are green.

</details>

## Community & contributing

- ⭐ **Like it?** Star the repo — it is the only signal this project gets:
  <https://github.com/lmzhen/dsh-evolution>
- 🧭 **Discover more plugins:** [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
  and the in-harness market (`dsh plugin --profile web add dshmarket`).
- 🐛 **Feedback / bugs:** open an issue on the repository. The family ships no telemetry,
  so a report with your `/evolution doctor` output is the fastest path.
- 🤝 **Contributing:** read `CONTRIBUTING.md` first — it defines the single-home rule for
  facts and the gate a change must pass.
- 📜 **Attribution:** the design is inspired by [Hermes Agent](https://github.com/NousResearch/hermes-agent)
  (MIT); this is an independent implementation, not affiliated with or endorsed by Nous
  Research or DeepSeek.

## License

MIT — see [LICENSE](./LICENSE).
