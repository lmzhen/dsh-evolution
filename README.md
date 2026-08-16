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
| Durable memory | `MEMORY.md` / `USER.md` + `memory` tool | `ctx.memory` seam + `memory-files` provider + `tool-memory` |
| Skill sedimentation | `skill_manage` | `ctx.skills` + `tool-skill-manage` + `skill-usage` |
| Background review | post-turn forked review agent | `turn/end` signal gate + `ctx.subagents` one-shot review + deterministic plan validator |
| Skill curator | active → stale → archived | `evolution-curator` service + persistent state |
| Usage telemetry | `.usage.json` | `ctx.skillUsage` |
| Write approval | stage / approve / reject | `ctx.evolutionApproval` + pending store |
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
├── memory/                  # ctx.memory service definition
├── memory-files/            # local memory provider
├── tool-memory/             # model-facing memory tool
├── skill-usage/             # ctx.skillUsage telemetry
├── tool-skill-manage/       # model-facing skill_manage tool
├── evolution-policy/        # immutable control-plane policy
├── evolution-plan-validator/# deterministic plan validation
├── evolution-review/        # review signal gate + subagent orchestration
├── evolution-threat/        # tools/pre-execute threat guard
├── evolution-curator/       # deterministic lifecycle + archive
├── evolution-approval/      # staged write approval service
├── evolution-commands/      # /evolution commands
├── evolution-learning-graph/# learning graph builder
└── dsh-evolution/           # compatibility facade + shared domain modules
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
- id: memory
  name: '@deepseek-ai/dsh-memory'
- id: memory-files
  name: '@deepseek-ai/dsh-memory-files'
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'
- id: skill-usage
  name: '@deepseek-ai/dsh-skill-usage'
- id: tool-skill-manage
  name: '@deepseek-ai/dsh-tool-skill-manage'
- id: evolution-approval
  name: '@deepseek-ai/dsh-evolution-approval'
- id: evolution-threat
  name: '@deepseek-ai/dsh-evolution-threat'
- id: evolution-review
  name: '@deepseek-ai/dsh-evolution-review'
- id: evolution-curator
  name: '@deepseek-ai/dsh-evolution-curator'
- id: evolution-commands
  name: '@deepseek-ai/dsh-evolution-commands'
```

## DSH-specific adaptations

- **Seams over files**: memory/skill/telemetry/approval are independent plugins
  connected through `ctx` services.
- **Event sourcing**: review scheduling and plan application emit durable
  session events.
- **Subagent review**: background review runs in an isolated one-shot
  subagent, never polluting the main conversation context.
- **Cache awareness**: memory is injected as a runtime-context snapshot;
  stable guidance lives in `systemPrompt.section`; review input uses the
  folded session surface. DeepSeek prefix-cache shape is preserved.
- **Policy pipeline**: threat and approval policy sit in `tools/pre-execute`,
  reusable by future evolution tools.

## Attribution

Inspired by [Hermes Agent](https://github.com/NousResearch/hermes-agent)
(Nous Research, MIT). See `NOTICE`.

## License

MIT
