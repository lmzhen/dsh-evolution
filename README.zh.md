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

**10 秒版：** 你的 Agent 会**长久记住你**（偏好、纠正、事实），在干活中**沉淀可复用流程**（技能），并让**后台评审持续改进自己的技能库**——全部在控制边界内：模型只能写 memory 与 skills，其余（策略、审批、审计、快照）都握在你手里。

**装完会改变什么：** 上周你纠正过的偏好，新会话它已经知道；它发现的技巧会被沉淀为技能复用；技能库会被定期评审与治理。你始终可控——后台写入可改为"等待你批准"，一切都有日志。

**听起来自主性太强？** 默认是安全的：后台评审只改写本会话真正读过的技能、pinned 技能对它只读、写入门控与审批默认保守（对齐上游 Hermes），想要"批准后才写"只需一行配置。

`dsh-evolution` 让 DeepSeek Harness Agent 跨会话自我改进，并保持严格边界：

```text
模型可以写入的只有：

  memory  持久事实、偏好和纠正
  skills  可复用流程及其支持文件

其他都是控制面：

  policy、prompt、routing、approval、state、audit、snapshot
```

## 快速开始

在 DeepSeek Harness 源码目录中：

```bash
node packages/evolution/scripts/install-layered.mjs \
  --profile web \
  --mode oneclick
```

安装后重启 profile，Agent 即拥有：

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

### 一键兼容安装

```bash
node packages/evolution/scripts/install-layered.mjs \
  --profile web \
  --mode oneclick
```

适合快速体验：一次安装全部 host 服务和模型工具。

### 分层安装（推荐）

```bash
node packages/evolution/scripts/install-layered.mjs \
  --profile web \
  --mode layered
```

安装内容：

```text
profile bundle
  @deepseek-ai/dsh-evolution-host   共享基础设施，无模型工具

agent preset
  ~/.dsh/.agent-presets/evolution   标准工具 + memory + skill_manage
```

之后只给需要自进化工具的会话选择 **Evolution** preset。

### 仅安装基础设施

```bash
node packages/evolution/scripts/install-layered.mjs \
  --profile web \
  --mode host
```

适合只需要后台自动化、审批和审计，但不希望模型看到工具的场景。

### 卸载

```bash
node packages/evolution/scripts/install-layered.mjs \
  --profile web \
  --mode layered \
  --uninstall
```

卸载会移除 profile rows、复制的包和 agent preset，但保留记忆、技能、状态、
报告和审批历史。

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

**日常使用是什么样：**
- **长期个人助手**——你纠正一次（"用绝对路径""装工具前先问"），下一次会话它已经记住；它发现的流程（备份配方、你技术栈的坑）会沉淀成技能，下次直接复用。
- **团队共享技能库**——多个会话共享一个 evolution host：有人修复了可复用工作流，评审把它收进共享库，大家后续的会话都能找到。
- **自动化无人值守**——定时任务不挂模型工具；服务（用量遥测、事件日志、curator）在后台保持库健康。
- **审计与治理**——你能看到 Agent 学了什么、准备改什么；批准/拒绝待审写入；回滚快照——信任它之前先看得见。

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

## 运行影响（坦诚告知）

- **会新增模型工具与提示段。** Evolution preset 增加 `memory`、`skill_manage`、session-query 与 catalog 四个工具及少量引导文本。每个工具说明都位于提示前缀——**KV 缓存前缀会变化**，安装/变更工具后的首轮是冷启动；工具密集型会话请用按会话 profile/preset 隔离。
- **以你的本地权限运行。** 与任何 DSH 插件一样，evolution 代码在宿主进程执行——装前请审阅仓库，首次试用建议用隔离 profile。
- **只写你允许它写的地方。** 循环写入目标为 `~/.dsh/` 下的 memory 与 skills（可配置）；写入经过原点门（pinned/bundled 技能对后台评审只读）、分阶段审批、快照与审计；**不触碰平台沙箱/权限模型**。
- **默认保守。** 后台评审只读本会话读过的技能；curator 按你配置的周期运行；分阶段审批默认关闭（对齐上游 Hermes），一行配置即可开启。

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
