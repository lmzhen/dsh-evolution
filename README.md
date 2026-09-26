# dsh-evolution — self-evolving memory & skills for DeepSeek Harness

[English](./README.md) · [中文](./README.zh.md)

[![npm](https://img.shields.io/npm/v/@lmzhen/dsh-evolution-all?style=flat-square&label=npm)](https://www.npmjs.com/package/@lmzhen/dsh-evolution-all)
[![release CI](https://github.com/lmzhen/dsh-evolution/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/lmzhen/dsh-evolution/actions/workflows/release.yml)
![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

**One install. The agent keeps notes about your project, and improves its own skills.**

Contents: [What it is](#what-it-is) · [Should you install it](#should-you-install-it) · [Install](#install) ·
[Choose your install](#choose-your-install-m1m4) · [How it works](#how-it-works) · [Day to day](#day-to-day) ·
[Turn it down or off](#turn-it-down-or-off) · [Boundaries](#security--boundaries) ·
[Limits](#known-limitations) · [Troubleshooting](#troubleshooting) · [Docs](#documentation-index)

> Community-published packages under `@lmzhen` are maintained by the dsh-evolution community and are **not**
> official DeepSeek releases; they use neither the `@deepseek-ai/*` package names nor DeepSeek branding.

## What it is

30 composable Cordis plugins that give a DeepSeek Harness install a self-evolution layer: the agent reviews its
own conversations, keeps **memory**, proposes and patches **skills**, and curates that skill library over time.
The model may only write memory and skills — policy, prompts, routing, state and audit history are control-plane
data it can never touch.

It is not a model, not a hosted service, and not a GUI of its own: what it adds is model tools, slash commands,
and files under your own `$DSH_HOME`.

## Should you install it

Install it if you are tired of re-explaining the same project to a fresh session, or of hand-maintaining a pile
of skills that never improve. Then:

- **Facts survive.** A review writes what mattered into memory; later sessions get it injected automatically.
- **Skills improve themselves.** The agent patches its own skills from what actually happened, with plans
  validated before execution — and a curator that merges near-duplicates and archives what stopped being used.
- **You stay in control.** Every write passes a threat scan and an immutable policy; with one flag, every write
  also waits for your approval. Skill destruction is never a hard delete.
- **You can see everything.** Counters, run reports and a mutation log live in files under `$DSH_HOME`. No
  telemetry service, nothing leaves your machine except the prompts you already send.

Skip it if you want a fully hands-off black box, or if you need per-session tools without profile-wide
automation (that is install form ①: `packages/INSTALL.md` has the forms and their verified status).

## Install

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all   # the DEFAULT full bundle
# restart dsh so the profile is recomposed, then in any session:
/evolution doctor
```

You should see 29 packages installed (the published list is 30; `@lmzhen/dsh-evolution-preset` ships as an agent preset, not as a `node_modules` plugin), and after the restart a doctor report naming your install form and the
rows it found. Verify without asking the model anything:

```bash
dsh --profile web --dump-config | grep -c 'id: evolution-'   # 19 rows
dsh --profile web --dump-config | grep -c 'id:'              # 209 ids, all distinct
```

Nothing writes on boot: the first review waits for the interval window. Want every write gated by your approval
instead of full-auto? Add `approval.enabled: true` (that is mode M2).

## Choose your install (M1–M4)

The M numbers are defined HERE; the install **forms** and their per-platform status are single-sourced in
`packages/INSTALL.md`.

| Mode | How | What you get |
|---|---|---|
| **M1 Full-auto (DEFAULT)** | `dsh plugin --profile web add @lmzhen/dsh-evolution-all` | Both loops run and write; model tools in every session |
| **M2 Human gated** | M1 + `approval.enabled: true` | Every write appears as `/evolution pending` for you to approve or reject |
| **M3 Infrastructure only** | `dsh plugin --profile web add @lmzhen/dsh-evolution-host` | Automation runs, the model gets **no** memory/skill tools |
| **M4 Per-session (advanced)** | M3 + `/evolution preset install` | Tools only in sessions that select the Evolution preset (exclusive with M1 and the legacy one-click preset) |

Mount exactly one of these: the bundles share infrastructure rows, and the loader aborts at startup on duplicate
ids. The bundle also pins `provider: json` on the state row, so an unrelated overlay cannot silently move your
state onto an empty domain.

## Compatibility

| | Value |
|---|---|
| Validated DSH platform line | **`0.1.5-rc.2`** (`PLATFORM_VERSION`; `UPSTREAM_SHA=fb2c4b9e…`) |
| Declared dependency window | `^0.1.5-rc.2` on every `@deepseek-ai/dsh-*` dependency/peer |
| Family version | `0.9.0` (npm `latest`; per-form status in `packages/INSTALL.md`) |
| Node | 22.19+ or 24+ (`engines`) |

A prerelease range admits **one** anchor, not a family of them: `^0.1.5-rc.2` rejects later prerelease
successors while admitting stable `0.1.5`. Earlier prerelease lines fail at dependency resolution — that is
the support window, not a bug.

## How it works

| Layer | What it does | What you notice |
|---|---|---|
| **Review** | watches session events, applies the substantive gate, produces a validated plan (`evolution-review`, `evolution-plan-validator`) | reviews happen at conversation boundaries, not mid-task |
| **Memory loop** | writes durable facts and a user profile, injects guidance into new sessions (`memory`, `memory-files`, `tool-memory`) | new sessions already know your project |
| **Skill loop** | proposes, writes and patches skills through the `skill_manage` tool; the catalog exposes them to the model (`tool-skill-manage`, `evolution-skill-catalog`) | skills you did not have to write yourself |
| **Curator** (the **技能整理 / Skill tidy-up** card in the settings section) | deterministic stale/archive lifecycle plus LLM nomination, with a snapshot before every run (`evolution-curator`) | the library stays small and merges duplicates |
| **Control plane** | threat scan, immutable policy, optional staged approval with replay (`evolution-threat`, `evolution-policy`, `evolution-approval`) | a refused write tells you why, and nothing destructive is silent |
| **Plumbing** | IO seam, state providers, events, activity, replay, learning graph (`evolution-io*`, `evolution-state*`, `evolution-activity`, `evolution-replay`) | everything is a file you can read, back up or delete |

```text
$DSH_HOME/evolution/events.json      append-only feedback/usage timeline
$DSH_HOME/evolution/review-state.json  per-session review counters
$DSH_HOME/evolution/activity.json    plan outcomes          reports/  curator run reports
$DSH_HOME/skills/                    the skill tree (+ .usage.json)
$DSH_HOME/memories/                  MEMORY.md + USER.md
```

Two defaults worth knowing up front. **Reviews run in-session** (`reviewMode: 'inject'`, the default since
0.3.74) — nothing is spawned, so there is no separate review ledger; `subagent` is an explicit opt-in for a
clean parent context or a dedicated model. **Cross-session consumers are session-scoped:** review and usage
telemetry act on a session only if that session can resolve the family's model tools — true for every session
under M1, never true for a host-only install (M3), which the plugin reports once instead of failing silently.

## Day to day

- `/evolution doctor` reports what is installed: form, scoped rows, services, pending count.
- `/evolution pending` + `approve` / `reject` handle the staged writes (M2).
- `/evolution curator status` shows the last run and the next due time (the curator ticks hourly; a run is due every 168 h by
  default, so quiet weeks are normal).
- `/evolution preset install [--base <name>[,<name>...]]` generates the family agent preset (M4).
- `/evolution mutations` (the write log) and `/graph` (skills and memory as a graph).

The full command surface is rendered once in `packages/README.md` (§Command reference); the complete
environment-variable and field-level knob reference lives there too.

### Changing parameters from the GUI

The family ships exactly one browser surface: a settings section named **自进化**. It lists the
user-writable parameters as five collapsible cards — **会话回顾** (Session review), **长期记忆**
(Long-term memory), **记忆写入** (Writing memory), **技能整理** (Skill tidy-up) and **技能写入规则**
(Skill write rules); the card titles and every field's Chinese label and explanation come from the
parameter registry. Each field carries its unit, where the current value comes from (**我改过**
edited by you / **默认** the deployment default), a control typed from the registry (switch,
dropdown, number, text) and that explanation. Edit and press 保存; 放弃修改 drops the draft, and
恢复默认值 removes your override for one field. A dropdown's options are named in Chinese while the
stored value stays the raw one (the registry's optional `valueLabels`).

Writes land in `~/.dsh/settings.yaml`, in the owning plugin's section, and take effect live, without a
restart. The same store is writable from a session with `/evolution policy set <id> <value>`, and
`/evolution params` prints every registered parameter — the human-readable table is Chinese
(参数／分组／档位／生效／来源／当前值 plus a tier legend), while `--json` keeps the raw field names and
values for scripts.
Deployment-side knobs (resource limits, provider choice, prompt-affecting identity) stay in
`cordis.yml` / the profile patch layer — the section lists only what a user may change, and the
doctor's divergence section reports the two sides disagreeing.
## Turn it down or off

| Dial | Values | Field |
|---|---|---|
| autonomy | auto / reviewed / observe | `approval.enabled`, `reviewEnabled` |
| scope | global / per-session | evolution-all vs host + agent preset |
| curatorBackground | on / off | `autoStart` / `curatorIntervalHours` / `minIdleHours` |
| memoryInjection | on / off | `memoryEnabled` (off = the whole row is a no-op) |
| threatStrictness | strict / exempt-list | `threatExemptLabels` (declared per config site; the owning list is single-sourced in `evolution-threat/README.md`) |

Three ways down, in increasing order of silence: **gate it** (`approval.enabled: true`), **stop reviewing**
(`reviewEnabled: false`), or **shrink to M3** (no model tools at all). Defaults that surprise people:
`reviewEnabled: true`, `reviewMode: 'inject'`, `reviewMemoryInterval = reviewSkillInterval = 10` turns, substantive
gate = "≥3 tool calls **or** ≥200 user characters **or** ≥500 agent characters", curator due-ness 168 h.

<details>
<summary>Environment variables (complete list)</summary>

| Variable | Where read | Effect |
|---|---|---|
| `DSH_EVOLUTION_SESSION_QUERY` | profile config | `startup` / `first-search` / `never` (SQLite index openAt); invalid values normalize to `startup` |
| `DSH_EVOLUTION_SESSION_QUERY_PATH` | profile config | durable index path; empty falls back to `$DSH_HOME/evolution/session-query.db` |
| `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS` | plugin code | `1` downgrades a preset delta-row collision from fail-loud to warn+keep-both |
| `EVOLUTION_SCOPE` | source installers only | scope written into generated profile/preset rows; the plugin runtime never reads it |
| `DSH_EVOLUTION_DELTA_PATH` | source installers only | overrides the agent-preset delta fragment the layered installer composes from |
| `DSH_AGENT_PRESET_ROOT` | source installers only | overrides the `.agent-presets` root the preset variants install into; must exist when set |
| `DSH_EVOLUTION_ARCH_STRICT` | guard scripts only | `1` makes the architecture-duplication guard fail loud (same as `--strict`) |
| `DSH_EVOLUTION_DECLARED_CONFIG_STRICT` | guard scripts only | `1` makes the declared-config-reach guard fail loud (same as `--strict`) |

</details>

## Security & boundaries

1. **The model writes memory and skills only**. Everything else is control-plane data.
2. **Every mutation is gated** by the `tools.guard` threat scan, and by staged approval when enabled;
   an approved write replays through the exact runner it registered with.
3. **Nothing is destroyed silently**. Skill archival moves to `.archive/`, and every curator run snapshots
   the skill tree first.
4. **Text leaving the session for a model is redacted** (PEM blocks, URL credentials, inline assignments,
   camelCase credential keys).
5. **No telemetry.** Counters and reports are files under `$DSH_HOME`; the family publishes no
   `./invariant` companion, because the platform would never execute one.

## Known limitations

- `reviewMode` defaults to `inject`: reviews run in-session and produce no `evolution/plan-applied` ledger,
  so the activity store and replay views stay empty until you opt into `subagent` reviews.
- Session-scoped consumers never match on a host-only install (M3), and on M4 only sessions on the Evolution
  preset match.
- The only GUI surface is one settings section (**自进化**): the family adds slash commands, model tools and that parameter panel — nothing else in the browser UI.
- One platform anchor: a new platform line needs a family migration, not a config bump.
- `npm dist-tags.next` is stale at `0.3.18` (historical residual); `latest` is correct and is what `add`
  resolves.

## Troubleshooting

**Nothing has been written yet.** The first review waits for the interval window (`memoryInterval` /
`reviewSkillInterval`, default 10 turns) and the substantive gate — a one-line session is deliberately not worth a
review.

**`activity.json` is empty.** That is inject-mode behavior, not a failure; see the first limitation above.

**How do I check the running version?** Compare `profiles/<name>/pnpm-lock.yaml` with
`npm view @lmzhen/dsh-evolution-all version`; the profile is recomposed when dsh restarts.

**A threat scan refused a write.** Rephrase it, or exempt a known-innocent label via `threatExemptLabels`.

<details>
<summary>Error codes</summary>

| Code | Meaning | Next step |
|---|---|---|
| startup `invariants: package "…" is already registered` | two bundles double-mount the same rows | keep ONE of evolution-all / evolution-host / evolution-preset |
| `E-301` / `E-302` / `E-303` | approval / curator / replay service not mounted | mount the row (they ship with host/all), then run doctor |
| `E-306` | this deployment stages foreground writes, but the named command is not replayable through the skill runner | approve-and-execute it directly, or set `stageForeground: false` deliberately |
| `E-304` | the mounted approval service predates the release capability (a skewed/partial upgrade) | `reject` the pending record instead of `release` |
| `E-305` | the invocation carries no agent (a script/headless caller reached a session-backed branch) | run the command from a session in the GUI or the CLI |
| `E-307` / `E-311` | the settings service is missing or cannot report its sections (`/evolution params`, `/evolution policy set`) | mount the settings row (ships with host/all), then run doctor |
| `E-308` / `E-313` | unknown parameter group or id | list them: `/evolution params` shows every registered id with its tier and owner |
| `E-314` / `E-315` / `E-316` | the id is a deployment parameter, has no user layer, or its owner is not mounted | write it in `cordis.yml`, or mount the owner row — the message names tier, owner and namespace |
| `E-309` / `E-310` | your write lost a revision race, or the settings service refused it (the reason is included) | re-read with `/evolution params` and retry |
| `E-317` | you declined the confirmation the tool asked before creating or deleting a skill (a foreground create or bare delete asks once) | nothing was written; repeat the call if you do want it |
| `E-318` | a write without a read: the session never loaded that skill, so the write is refused (skills only; the foreground operator session is exempt) | load it with the `skill` tool, then repeat the write |
| doctor says `install form: none` | no bundle installed | `dsh plugin --profile web add @lmzhen/dsh-evolution-all` |

Symptom → next step; the exact text of every code (`E-301`–`E-318`) is stored once in
`evolution-core/src/errors.ts` and printed verbatim.

</details>

## Uninstall

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
```

The loops stop, your data does not: memory, skills, state, reports and approval history stay under
`$DSH_HOME` and are picked up again on reinstall.

## Documentation index

| Document | What it holds |
|---|---|
| [`INSTALL.md`](./INSTALL.md) | install forms, scopes, profile override examples |
| [`packages/INSTALL.md`](./packages/INSTALL.md) | install-form semantics and the per-platform verification matrix |
| [`packages/README.md`](./packages/README.md) | command reference, package map, environment/knob reference, layout notes |
| [`CHANGELOG.md`](./CHANGELOG.md) | what changed in each version, with reasons and evidence |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | where a fact may live, the 21-step gate, house rules |

<details>
<summary>For maintainers: upstream upgrade checklist</summary>

1. **Skill-provider shadow rank**. Our provider registers `EVOLUTION_SKILL_RANK = 390` and relies on the
   upstream `USER_DSH_RANK` (400 on `0.1.5-rc.2`) sorting above it; re-verify both sides.
2. **`@deepseek-ai` name collisions**. The release tooling rewrites family names to `@lmzhen`; check each
   upstream release for names that collide with ours.
3. **ToolRuntime argument freeze**. `tool.execute` gets a `deepFreeze`d snapshot: build a new object rather
   than assigning onto `args`.
4. **Per-skill invocation frontmatter**. Our shadowing provider must keep parsing the same keys as upstream;
   its legacy-key posture is single-sourced in `evolution-skill-catalog/README.md`.
5. **Home-path semantics**. Upstream `resolveDshHome` trims only as the adoption test, keeps the RAW env
   value, expands `~ ` and always resolves; `evolutionRoot` and `install-layered.mjs` follow the same line.

</details>

## License and attribution

MIT — see [LICENSE](./LICENSE). The design is inspired by
[Hermes Agent](https://github.com/NousResearch/hermes-agent) (MIT); this is an independent implementation, not
affiliated with or endorsed by Nous Research or DeepSeek. Issues and feedback are welcome on the repository —
since the family ships no telemetry, a report that includes your `/evolution doctor` output is the fastest
path.
