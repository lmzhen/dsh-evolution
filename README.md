# dsh-evolution

> Hermes-inspired agent self-evolution for DeepSeek Harness.
>
> 本项目模仿了 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 的
> **智能体自进化能力**（持久记忆、技能沉淀、后台审查、技能策展、使用遥测、
> 威胁扫描与写入门控），但 **不是简单移植**：所有机制都针对
> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
> 的 Cordis 插件/服务架构、session event、`ctx` seams、子代理系统和
> DeepSeek 缓存特性做了专项适配。

## What is this?

`dsh-evolution` is an open-source plugin family that gives a DeepSeek Harness
agent the ability to improve itself across sessions:

| Capability | Hermes concept | DSH-native implementation |
|---|---|---|
| Durable memory | `MEMORY.md` / `USER.md` + `memory` tool | `ctx.memory` seam + `ctx.evolutionIo` provider + `tool-memory` |
| Skill sedimentation | `skill_manage` | `ctx.evolutionIo` skill library + `tool-skill-manage` + `skill-usage` |
| Background review | post-turn forked review agent | `turn/end` signal gate + `ctx.subagents` one-shot review + deterministic plan validator |
| Skill curator | active → stale → archived | `evolution-curator` service + persistent state |
| Usage telemetry | `.usage.json` | `ctx.skillUsage` |
| Write approval | stage / approve / reject | `ctx.evolutionApproval` over pluggable `ctx.evolutionState` providers |
| Threat scanning | prompt-injection / exfiltration guard | `tools/pre-execute` guard |
| Learning graph | learned skills + memory nodes | pure graph builder over `ctx.skillUsage` / `ctx.memory` |

The key Hermes behaviors are preserved: bounded memory with dedup/ambiguity
checks, protected skills, pinned semantics, archive-not-delete, background
review evidence, and deterministic lifecycle thresholds. The execution model
is adapted to DSH: plugin seams instead of Python modules, session events
instead of daemon threads, subagents instead of forked AIAgent instances.

## Repository layout

```text
packages/
├── memory/ + memory-files/ + tool-memory/       # memory seam, provider, tool
├── skill-usage/ + tool-skill-manage/ + evolution-skill-catalog/  # telemetry + skill_manage + native catalog
├── evolution-io/ + evolution-io-node/           # file-tree IO seam + atomic node provider
├── evolution-policy/                            # immutable control plane + tools.guard
├── evolution-plan-validator/                    # deterministic plan validation
├── evolution-state-storage/ + -domain/ + -json/ # pluggable durable state providers
├── evolution-state/                             # state consumer
├── evolution-approval/                          # staged write approval service
├── evolution-threat/                            # tools/pre-execute threat guard
├── evolution-review/                            # signal gate + subagent review
├── evolution-curator/                           # lifecycle + LLM advisory + reports + min-idle
├── evolution-commands/ + evolution-learning-graph/
├── evolution-activity/ + evolution-feedback/ + evolution-replay/
├── evolution-preset/                            # cordis.yml + patch composition
└── dsh-evolution/                               # compatibility facade + shared modules
```

## Installation

This repository is designed to be mounted into a DeepSeek Harness checkout as
`packages/evolution`:

```bash
cd deepseek-harness/packages/evolution
git clone https://github.com/lmzhen/dsh-evolution.git .
```

or copy the packages into the monorepo. Then add the plugins to a DSH
composition:

```yaml
- id: dsh-evolution
  name: '@deepseek-ai/dsh-evolution-preset'
```

The standalone composition lives in
`packages/evolution-preset/cordis.yml`; the host overlay (recommended on a
standard DSH host, which already owns the storage/session/approval stack) is
`packages/evolution-preset/cordis.patch.yml`.

## DSH-specific adaptations

- **Seams over files**: memory, skills, telemetry, and state are independent
  plugins connected through `ctx` services (`ctx.memory`, `ctx.evolutionIo`,
  `ctx.evolutionStateStorage`). Native packages perform no node:fs IO of their
  own.
- **Event sourcing**: review scheduling and plan application emit durable
  session events.
- **Subagent review**: background review runs in an isolated one-shot
  subagent, never polluting the main conversation context.
- **Cache awareness**: memory is injected as a runtime-context snapshot;
  stable guidance lives in `systemPrompt.section`; review input uses the
  folded session surface. DeepSeek prefix-cache shape is preserved.
- **Policy pipeline**: threat policy sits in `tools/pre-execute`; immutable
  evolution policy is enforced by the monotonic `tools.guard`; approval is a
  staged, replayable service over the state seam.

## Attribution

Inspired by [Hermes Agent](https://github.com/NousResearch/hermes-agent)
(Nous Research, MIT). See `NOTICE`.

## License

MIT
