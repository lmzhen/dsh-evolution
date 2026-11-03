# @lmzhen/dsh-evolution-core

> 内部引擎，支撑记忆、技能、历史、恢复和审批。

## 你会看到

没有直接入口；用户看到的是记忆、技能、历史和撤销。

## 什么时候会用到

每次 Agent 写记忆/技能、看历史、恢复时。

## 默认 / 前提

随 all/host/分层安装自动工作。

## 边界

普通用户不需要知道其中的事务/状态机。

## 维护者参考（用户可跳过）

## Events (the family's own, process-local)

| 事件 | the `@mode` | 用途 |
|---|---|---|
| `evolution/skill-mutated` | emit (one-way) | 技能树写入后失效目录缓存 |
| `evolution/skills-refresh` | emit (one-way) | `/evolution skills refresh` 显式刷新 |
| `evolution/review-scheduled` | emit (one-way) | 审查已安排 |
| `evolution/review-completed` | emit (one-way) | branch 审查完成 |
| `evolution/review-error` | emit (one-way) | 审查流水线失败 |
| `evolution/plan-applied` | emit (one-way) | 计划执行结果 |
| `evolution/memory-applied` | emit (one-way) | 记忆写入成功 |
| `evolution/memory-provider-registered` | emit (one-way) | 记忆 provider 注册 |

预设 id：`evolution`、`evolution-ptc`、`evolution-cordis`、`evolution-minimal`、`evolution-reviewer-readonly`、`evolution-maintainer-readonly`。
