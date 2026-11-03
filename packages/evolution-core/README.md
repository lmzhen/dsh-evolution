# @lmzhen/dsh-evolution-core

> 家族底座：技能库、记忆库、事务、提示词、投影、事件和受限预设。

## 它做什么

提供 SkillLibrary（技能树/版本/保护/合并/抽取）、MemoryStore（记忆文件/预算/漂移/威胁/退避）、WriteKernel 与 UnitTransactions（CAS/回执/恢复）、会话投影与信号、事件日志、run registry、参数表、prompt bundle、subagent channel、preset 组装，以及唯一的 ./restrictor 插件行。

## 入口

无用户命令；由 commands/curator/merge/tool-memory/tool-skill-manage 等构造调用；./restrictor 由受限 preset 在运行时挂载。

## 依赖与默认

被几乎所有家族包依赖；需要 evolution-io 提供 IO。

## 边界

不提供 HTTP/UI；不是默认 Service；提交语义受 UnitTransaction/CAS 约束；写路径必须走 write-gates。

## 代码位置

`src/skill-store.ts, src/memory-store.ts, src/write-kernel.ts, src/unit-transaction.ts, src/session-projection.ts, src/restrictor.ts`

## Events (the family's own, process-local)

下表是家族自己的进程事件。事件名与 `@mode` 是契约；每个发射点都必须按这个模式使用。

| 事件 | the `@mode` | 用途 |
|---|---|---|
| `evolution/skill-mutated` | emit | 技能树写入后失效目录缓存 |
| `evolution/skills-refresh` | emit | `/evolution skills refresh` 显式刷新 |
| `evolution/review-scheduled` | emit | 审查已安排（公告） |
| `evolution/review-completed` | emit | branch 审查完成并带回结果 |
| `evolution/review-error` | emit | 审查流水线失败（公告） |
| `evolution/plan-applied` | emit | 计划执行结果 |
| `evolution/memory-applied` | emit | 记忆写入成功 |
| `evolution/memory-provider-registered` | emit | 记忆 provider 注册 |

## Preset ids (single source)

| Preset id | 用途 |
|---|---|
| `evolution` | standard base 的 Evolution 预设 |
| `evolution-ptc` | ptc base |
| `evolution-cordis` | cordis base，需要 dynamicCordisRunner |
| `evolution-minimal` | minimal base，unsupported |
| `evolution-reviewer-readonly` | 受限只读审阅预设 |
| `evolution-maintainer-readonly` | 受限只读维护预设 |
