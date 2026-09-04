# dsh-evolution

[English](README.md) | 中文

> 受 Hermes Agent 启发的 DeepSeek Harness 自进化插件，完全按照 DSH 的插件、
> service、provider、session event 和 agent preset 架构重新实现，而不是
> 简单移植 Python 模块。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 目录

- [这是什么](#这是什么)
- [快速开始](#快速开始)
- [功能](#功能)
- [安装方式](#安装方式)
- [使用场景](#使用场景)
- [工作原理](#工作原理)
- [兼容性](#兼容性)
- [配置](#配置)
- [安全边界](#安全边界)
- [开发与测试](#开发与测试)

---

## 这是什么

`dsh-evolution` 让 DeepSeek Harness 的 Agent 跨会话自我改进，边界明确：

```text
模型可以写入的只有：

  memory  持久事实、偏好和纠正
  skills  可复用流程及其支持文件

其他都是控制面：

  policy、prompt、routing、approval、state、audit、snapshot
```

装上之前，每次新会话 Agent 都不记得你的纠正，已经走过的弯路还会再走一遍。装上之后：纠正会被记住，摸索出的流程会存成技能复用，技能库按计划被评审和治理——而这些变化，都走你配置的审批策略。

默认是保守的：后台评审只改本会话读过的技能，pinned 技能它无法触碰；想让它"写完先问我"，一行配置就能打开分阶段审批。所有变更都有日志。

## 快速开始

> 社区 npm 包只发布在 `@lmzhen` scope 下。

```bash
dsh plugin --profile web add \
  @lmzhen/dsh-evolution-host \
  @lmzhen/dsh-evolution-activity \
  @lmzhen/dsh-evolution-skill-catalog \
  @lmzhen/dsh-tool-memory \
  @lmzhen/dsh-tool-skill-manage
```

安装后重启 profile，并为需要自进化工具的会话选择 **Evolution** 预设。
Agent 即拥有：

```text
持久记忆
skill_manage
后台 review
curator
写入门控
威胁扫描
使用遥测
```

> [!WARNING]
> 插件会在你的本地权限下运行第三方代码。安装前请阅读源码，建议先在
> 不含生产凭据的 profile 中试用。

## 功能

| 能力 | 说明 |
|---|---|
| 持久记忆 | 带预算、去重、歧义保护和威胁过滤的 `MEMORY.md` / `USER.md` |
| 技能沉淀 | 创建、修改、patch、归档技能和支持文件，保护标记，快照恢复 |
| 后台 review | 信号门控、证据要求的 one-shot subagent 计划 |
| Skill curator | 确定性的 active → stale → archived 生命周期 + 可选 LLM 建议 |
| 分阶段审批 | 后台写入可 stage / approve / reject，保留审计历史 |
| 威胁扫描 | 写入前检测 prompt injection、泄露、密钥和混淆 |
| 使用遥测 | 每个技能的 use / view / patch sidecar |
| 可观测性 | session projection、replay/A-B、feedback 质量分、learning graph |
| Capability 治理 | 验证并暂存 Creator-mode capability 包，绝不自动执行模型代码 |

## 安装方式

两种受支持的安装方式，取决于你是安装发布包还是从源码 checkout 使用。
**发布安装是最终用户推荐路径。**

### 1. 发布安装（推荐）

```bash
dsh plugin --profile web add \
  @lmzhen/dsh-evolution-host \
  @lmzhen/dsh-evolution-activity \
  @lmzhen/dsh-evolution-skill-catalog \
  @lmzhen/dsh-tool-memory \
  @lmzhen/dsh-tool-skill-manage
```

安装效果：

```text
host 基础设施   review、curator、审批、审计、可观测性、威胁检查……
                 profile 内所有会话共享
模型工具        memory / skill_manage / 技能目录 —— 只有选择 Evolution
                 预设的会话才看得到
```

- `plugin add` 的 reconciler 会自动把完整依赖树（`@lmzhen` 家族其余包）装进 profile。
- 版本：省略 `@<version>` 安装最新稳定版；预发布线需显式 `@<version>-rc.x`（发布在 `next` tag）。
- 卸载：对同样五个包执行 `dsh plugin --profile web remove`（移除 rows 与包；记忆、技能、
  状态、报告和审批历史保留）。

之后给需要自进化工具的会话选择 **Evolution** 预设。其他预设仍获得 review、curator、
审批和观测能力，但不会暴露模型侧的自进化工具。

### 2. 源码安装（仅开发）

适用于 DeepSeek Harness 源码 checkout 或本仓库的扁平源码树——该安装器把本地包
拷贝进 profile，**不是**发布版 npm 安装：

```bash
node packages/scripts/install-layered.mjs \
  --profile web \
  --mode layered
```

模式：`oneclick`（兼容 `dsh-evolution-preset` bundle）、`layered`（host bundle +
Evolution agent preset，推荐）、`host`（仅基础设施，无模型工具）、`agent`（仅预设）。
`--mode layered --uninstall` 移除安装器添加的所有内容但保留记忆、技能、状态、报告和
审批历史。`EVOLUTION_SCOPE` 选择包 scope（源码树默认 `@deepseek-ai`；`@lmzhen` 需要
`prepare-release` 产出的 `.release-staging`）。

### 3. 配置

默认部署零配置即可运行。生产建议三件事：打开分阶段审批（后台写入先审后写）、调整
curator 节奏（`interval` / `minIdleHours`）、决定哪些会话选 Evolution 预设。完整
配置面见 [配置](#配置)。

完整说明见 [packages/INSTALL.md](packages/INSTALL.md)。

## 使用场景

| 场景 | 推荐安装 |
|---|---|
| 单 Agent 完整自进化 | one-click preset |
| 多会话共享自进化基础设施 | host bundle + Evolution preset |
| 只要自动化，不要模型工具 | host-only |
| Standard preset | host bundle；模型工具保持隐藏 |
| Anchored Standard preset | host bundle + `dev_tool_search` 解锁工具 |
| Minimal preset | 服务挂载，但 complete persona 抑制进化提示 |
| Creator mode | host bundle + capability 治理，代码手动激活 |

**典型用途：**

- **长期个人助手。** 你纠正一次——"路径写绝对路径""装软件前先问我"——之后的会话它会照做；它摸索出的流程（备份命令、你项目的坑）会存成技能，下次直接用，不用重新摸索。
- **多个会话共享一个技能库。** 大家一起用同一个 evolution host：谁把可复用工作流做成了技能，评审通过后进共享库，大家的会话都能找到。
- **无人值守的自动化任务。** 定时任务不挂模型工具；后台的用量统计和 curator 负责维持技能库健康，日常会话保持轻量。
- **审计与治理。** 能看它学了什么、打算改什么；分阶段写入可以批可以拒，可以回滚快照，全程有记录。

## 工作原理

### 记忆

模型通过 `memory` 工具进行 add / replace / remove 或一个原子 operations
batch。条目有字符预算，以 runtime snapshot 注入；稳定提示保持在
system-prompt section。

### 技能

`skill_manage` 支持 create / edit / update / patch / delete / write_file /
remove_file / list。delete 只归档到 `.archive/`，不会硬删除。curator
运行前会快照，支持恢复。`evolution-skill-catalog` 通过原生 `ctx.skills`
发布技能并在写入后立即失效缓存。

### 后台 review

```text
turn/end
  -> 确定性信号门控
  -> one-shot subagent 输出结构化计划
  -> validator 检查证据和禁止字段
  -> trusted executor 应用合法操作
  -> session event + projection 记录结果
```

### Curator

```text
usage telemetry
  -> 确定性的 30/90 天状态迁移
  -> 可选 LLM 建议
  -> 快照 + 归档
  -> JSON run report
```

### 治理

```text
tools/pre-execute   威胁扫描
tools.guard         不可变策略拒绝
evolution-approval  stage -> approve/reject -> 审计
evolution-capability 验证 + 暂存 Creator 包，绝不执行代码
```

## 兼容性

- 基于 DeepSeek Harness `0.1.1-rc.2` 兼容验证（CI 发布锚点双锚检查）。
- 与 standard / minimal / code / Creator preset 服务级兼容。
- 使用 Anchored Standard 真实插件代码测试：
  - bootstrap 阶段隐藏 evolution 工具；
  - promoted 阶段仍隐藏；
  - 只有 `dev_tool_search` 解锁后出现。
- review 子代理默认允许 `skill`、`skill_search`、`skill_load`。

## 配置

所有稳定 row id 都可通过 profile 覆盖：

```yaml
# 禁用后台 review
- id: evolution-review
  disabled: true

# 启用分阶段审批
- id: evolution-approval
  config:
    enabled: true
    stageForeground: true

# 强制使用 JSON state
- id: evolution-state
  config:
    provider: json
```

## 运行影响

- **会多出模型工具和提示内容。** Evolution preset 会加 `memory`、`skill_manage`、会话检索、技能目录四个工具，外加一小段引导文字。工具说明与系统章节位于提示前缀：**安装或升级插件会改变前缀——每次变更一次冷启动**。动态内容（记忆快照、技能目录、评审通知）由平台以消息尾部追加——未变不注入，变了追加一条，**不会使前缀失效**。
- **以本地用户权限运行。** 和其他 DSH 插件一样，evolution 的代码跑在宿主进程里——安装前先看一遍仓库；第一次试，建议用隔离 profile。
- **只写 memory 和 skills。** 循环写入只针对 `~/.dsh/`（可配置）下的 memory 与 skills；写入会过保护标记（pinned、预装技能后台改不了）、分阶段审批、快照和审计；它不会动平台的沙箱或权限模型。
- **默认保守。** 后台评审只改本会话读过的技能；curator 按你定的周期跑；分阶段审批默认关（和上游 Hermes 一致），一行配置可开。

## 安全边界

1. 模型只能修改 memory 和 skills。
2. policy、prompt、routing、approval、state 不是模型可写数据。
3. capability 包只验证和暂存，绝不自动执行。
4. 技能删除是归档；curator 先快照；审批写入通过精确 runner 重放。
5. 依赖缺失时优雅降级，例如没有 storage-domain 时使用 JSON provider。

## 开发与测试

```bash
tsc -b tsconfig.host.json --force
vitest run packages/evolution
```

当前状态：

```text
tsc     0 errors
vitest  45 files / 90 tests passing
```

## Attribution

灵感来自 [Hermes Agent](https://github.com/NousResearch/hermes-agent)。
Anchored Standard 兼容测试 fixture 来自
[xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)。

## License

MIT
