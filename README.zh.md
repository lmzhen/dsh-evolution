# dsh-evolution

[English](README.md) | 中文

> 受 Hermes Agent 启发的 DeepSeek Harness 自进化插件，完全按照 DSH 的插件、
> service、provider、session event 和 agent preset 架构重新实现，而不是
> 简单移植 Python 模块。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 目录

- [这是什么](#这是什么)
- [快速开始](#快速开始)
- [命令面](#命令面)
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
dsh plugin --profile web add @lmzhen/dsh-evolution-all
```

**0.3.54 起 `evolution-all` 是默认全量包**（无需第二步骤）：安装并重启后，
所有会话自动拥有两条进化回路 + 模型工具（memory / skill_manage /
session_search / 技能目录）+ SKILLS/MEMORY 指引注入。

安装完成后运行一次内置自检确认形态：

```bash
/evolution doctor [--json] # 人类可读自检（安装形态/冲突/env/服务清单 + 建议动作）；--json 供脚本消费
/evolution doctor --json   # 脚本友好
```

两条进化回路（共享引擎：**Review** 审阅出计划 + **Curator** 整并/降级/归档 +
**Governance** 威胁/策略/审批闸门）：

- **记忆进化**：观察对话 → 后台审阅 → 记忆计划 → 写入沉淀 → 新会话注入；
- **技能进化**：观察对话 → 后台审阅 → 技能计划 →（受闸门时）批准 → 写入/修补技能树
  → 目录对模型可见 → 模型自主增改 → 使用统计 → 整并/归档（代谢）。

安装模式（M1-M4）：

| 模式 | 一句话 | 构成 |
|---|---|---|
| M1 全自动（默认） | 后台自己积累记忆与技能 | `add @lmzhen/dsh-evolution-all` |
| M2 人审把关 | 进化可以，每步先给我看 | M1 + `approval.enabled: true`（`/evolution pending\|approve\|reject`） |
| M3 只装底座 | 去掉模型工具；后台自动化照常运行（把关写盘用 M2） | `add @lmzhen/dsh-evolution-host` |
| M4 按会话启用（进阶） | 只在指定会话生效 | host + `/evolution preset install`（与 M1 互斥） |

> [!WARNING]
> 插件会在你的本地权限下运行第三方代码。安装前请阅读源码，建议先在
> 不含生产凭据的 profile 中试用。

## 命令面

以 `/evolution` 内建 help 为准（最权威——升级后先跑一次裸 `/evolution` 对照）。以下为
`packages/evolution-commands/src/registry.ts` 注册表（hint / help / README 表格的单源）的
全量枚举，版本以 CHANGELOG head 为准（不在此处钉死版本号）：

`pending [--detail]` · `approve <id>` · `reject <id>` · `doctor [--json]` · `curator run` ·
`curator pause` · `curator resume` · `curator status` · `curator report` ·
`curator scope` · `mutations` · `restore`（快照恢复） ·
`consolidate <target> <sources...> [--plan <runId>]` · `skill restore <name>` ·
`skills health` · `skills refresh` · `learn [request]` ·
`maintain [--timeout=<ms> | --facts]` · `preset install` ·
`restructure <name> "<heading>" <to_file> [--plan <runId>]` · `replay`

（裸 `/evolution` 输出同一清单。）

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

## 安装方式

两种受支持的安装方式，取决于你是安装发布包还是从源码 checkout 使用。
**发布安装是最终用户推荐路径。**

### 1. 发布安装（推荐）

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
```

`dsh-evolution-all` 是**全量 bundle（默认安装，0.3.54）**：自带 `dsh.bundle.patch`
（行集 = `dsh-evolution-host` 的基础设施行 ∪ 四个模型工具行
`tool-memory` / `tool-skill-manage` / `tool-session-query` / `evolution-skill-catalog`），
全部挂在 profile **root** 级。依赖闭包同时 pull 上述包与
`dsh-evolution-agent-preset`（预设容器：layered 场景的 `/evolution preset install` 用它）。`plugin add`
自动识别声明的 `dsh.bundle.patch` 清单并把整个依赖树带进来——无需任何额外 flags。

安装效果（默认形态 = 最完善优先）：

```text
host 基础设施   review、curator、审批、审计、可观测性、威胁检查……
                  profile 内所有会话共享
模型工具        memory / skill_manage / session_search / 技能目录 +
                  SKILLS/MEMORY 指引注入 —— 默认对 profile 内**每一**个会话可见（root 级）
```

- 版本：省略 `@<version>` 安装最新稳定版；预发布线需显式 `@<version>-rc.x`（发布在 `next` tag）。
- 细粒度安装（仅 host、或按需挑选工具包）受支持——见下表。卸载：对同样包执行
  `dsh plugin --profile web remove`（移除 rows 与包；记忆、技能、状态、报告和审批历史保留）。

- 默认无第二步骤。若想按会话分级暴露模型工具，采用下面的 **layered** 形态：
  先装 `host`，再运行 `/evolution preset install`（一次性；从 agent-preset 注册表读运行时
  `standard` 组合，合并 `dsh-evolution-agent-preset` 携带的 delta，把组合后的
  `agent.cordis.yml`/`preset.yml` 写入 `$DSH_HOME/.agent-presets/evolution/`），
  再为需要自进化工具的会话选择 **Evolution** 预设。
  其他预设仍获得 review、curator、审批和观测能力，但不会暴露模型侧的自进化工具。
  **注意：`all` 与 layered 形态互斥**（两者都挂模型行，双装启动即 fail-loud）。

#### 选择安装方式（场景 → 操作 → 你得到什么）

| 想要 | 发布操作 | 你得到 | 注意 |
|---|---|---|---|
| **全量（默认）** | `add @lmzhen/dsh-evolution-all`（推荐） | review/curator/审批/审计/威胁检查 + memory/`skill_manage`/`session_search`/技能目录 + 指引注入（**全会话 root 级**） | 无需预设、无需会话选择；升级后旧 all 用户即全量 |
| **仅 host（精简）** | `add @lmzhen/dsh-evolution-host` | 后台自动化 + 审批 + 审计 + 威胁检查 | **模型无法自主写记忆/技能**——删减=从 all 换装 host |
| **按会话分级（layered）** | `add @lmzhen/dsh-evolution-host` + 生成/选择 Evolution 预设 | 后台全会话 + 模型工具仅 Evolution 预设会话 | 与 `all` 互斥，二选一 |
| **兼容旧包** | `add @lmzhen/dsh-evolution-preset` | 与旧单体 facade 等价的兼容包（会全会话暴露模型工具） | **仅 legacy 兼容**；新部署用第一行 |

业务视角的另一面见 [使用场景](#使用场景)。

### 2. 源码安装（仅开发）

适用于 DeepSeek Harness 源码 checkout 或本仓库的扁平源码树——该安装器把本地包
拷贝进 profile，**不是**发布版 npm 安装：

```bash
node packages/scripts/install-layered.mjs \
  --profile web \
  --mode layered
```

模式：`oneclick`（兼容 `dsh-evolution-preset` bundle）、`layered`（host bundle +
Evolution agent preset，推荐）、`host`（仅基础设施，无记忆/技能模型工具，自带只读
`maintenance_probe` 诊断）、`agent`（仅预设）。
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
| 只要自动化，不要记忆/技能模型工具（后台自动化照常运行） | host-only |
| Standard preset | host bundle；模型工具保持隐藏 |
| Anchored Standard preset | host bundle + `dev_tool_search` 解锁工具 |
| Minimal preset | 服务挂载，但 complete persona 抑制进化提示 |
| Creator mode | host bundle（能力包走平台 Creator 模式，见 0.3.66 退役说明） |

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
tools.guard   威胁扫描
tools.guard         不可变策略拒绝
evolution-approval  stage -> approve/reject -> 审计
```

## 兼容性

- 基于 DeepSeek Harness `0.1.1-rc.2` 兼容验证（CI 发布锚点双锚检查）。
- 与 standard / minimal / code / Creator preset 服务级兼容。
- 使用 Anchored Standard 真实插件代码测试：
  - bootstrap 阶段隐藏 evolution 工具；
  - promoted 阶段仍隐藏；
  - 只有 `dev_tool_search` 解锁后出现。
- review 子代理默认允许 `skill`（V6-07 修正：DSH 平台目录只存在 plain `skill`，`skill_search`/`skill_load` 不存在）。

## 配置

### 拨盘层（5 个语义拨盘——背后字段与 README(en) `Configuration dials` 一致，测试钉住）

| 拨盘 | 取值 | 背后字段 |
|---|---|---|
| autonomy | auto / reviewed / observe | `approval.enabled`（profile 行）、`reviewEnabled`（evolution-review）、`/evolution pending\|approve\|reject` |
| scope | global / per-session | 包选择：evolution-all（全局，默认）vs host + Evolution 预设（按会话） |
| curatorBackground | on / off | `autoStart` / `intervalHours` / `minIdleHours`（evolution-curator） |
| memoryInjection | on / off | `memoryEnabled`（tool-memory：关闭时整行为 no-op——不注册 `memory` 工具，也不注入指引/快照） |
| threatStrictness | strict / 豁免清单 | threat 配置 + `threatExemptLabels`（core SkillLibrary/MemoryStore 选项） |

细粒度旋钮分三档（日常 / 调优 / 高危——如 maxOpsPerPlan、chars 上限、review/curator 模型选择：直接影响花费与行为），见英文 README `Configuration dials` 下说明。

### 环境变量（DSH_EVOLUTION_*）

| 变量 | 读取层 | 作用 |
|---|---|---|
| `DSH_EVOLUTION_SESSION_QUERY` | profile 配置（bundle patch `!!js`） | `startup` / `first-search` / `never`；非法值归一为 `startup` |
| `DSH_EVOLUTION_SESSION_QUERY_PATH` | profile 配置（`!!js`） | 索引路径；空串回退 `$DSH_HOME/evolution/session-query.db` |
| `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS` | 插件代码（core `env.ts`） | `1` 将预设 delta 行冲突从 fail-loud 降为 warn+双行保留 |
| `EVOLUTION_SCOPE` | 仅源码安装器（`install-layered.mjs`、`test-support/row-contract.ts`） | 写入生成的 profile/preset 行的 scope；默认取包自身 scope。插件运行时不读取 |

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

## 常见问题

| 症状 / 编号 | 含义 | 下一步 |
|---|---|---|
| 启动报 `invariants: package "…" is already registered` | 两个 bundle 或 bundle+预设双挂相同行 | 只保留一个（evolution-all / evolution-host / evolution-preset / layered）；跑 `/evolution doctor` |
| `E-301` | approval 服务未挂载 | evolution-approval 行随 host/all 提供；跑 doctor |
| `E-302` | curator 服务未挂载 | 挂 evolution-curator 行；跑 doctor |
| `E-303` | replay 服务未挂载 | 挂 evolution-replay 行；跑 doctor |
| 威胁扫描拒绝（memory/skill 写入） | strict 命中指令式短语 | 改写；或经 `threatExemptLabels` 豁免已知无害 label（见拨盘表） |
| doctor 报 `install form: none` | 未装任何 bundle | `dsh plugin --profile web add @lmzhen/dsh-evolution-all` |

## 安全边界

1. 模型只能修改 memory 和 skills。
2. policy、prompt、routing、approval、state 不是模型可写数据。
3. 动态插件（能力包）不在本家族的写入面内：创建、审批与激活归平台 Creator 模式；0.3.66 起本家族的 capability 适配器已移除。
4. 技能删除是归档；curator 先快照；审批写入通过精确 runner 重放。
5. 依赖缺失时优雅降级，例如没有 storage-domain 时使用 JSON provider。

## 开发与测试

以下命令在**合并/上游树**（`packages/evolution/<pkg>`）中运行；扁平镜像内没有该布局，
且每包 `tsconfig.json` 的 `extends`/`references` 只在合并树可解析（见「两种布局与 tsconfig」一节）：

```bash
tsc -b tsconfig.host.json --force
vitest run packages/evolution
```

当前状态：持续由 CI 校验（baseline 锚点 + 已发布上游兼容检查）；测试/检查数字以 CI 日志为准，不在此固定。

**测试导入取舍（I-03）**：tests 中约 30 组 `@deepseek-ai/*` 导入**有意未**在 package.json
声明——这些导入只在上游合并布局下可解析（与 tsconfig paths 的 G5.5 双布局规则同理，
详见英文 README"Development"一节），属已知取舍；**不为测试补 devDependencies**（合并树
是测试唯一可运行路径，补声明只会增加一块需持续同步的漂移面）。

**上游升级对照清单（I-02，每次升级过一遍）**：

1. **技能 provider 影子 rank**：本插件 `evolution-skill-catalog` 以
   `EVOLUTION_SKILL_RANK=390` shadow 上游 `USER_DSH_RANK`（0.1.1-rc.2 为 400，低 rank
   胜出、抢占 `user-dsh` source）。两侧常量互为私有：上游改动任一数值或比较语义，本侧
   会**静默**失去 shadow——升级时两侧复核。
2. **`@deepseek-ai` 包名撞名检查**：本家族在官方 `@deepseek-ai` scope 下发布自有包名
   （`dsh-memory`、`dsh-tool-memory`、`dsh-skill-usage`、`dsh-memory-files`、
   `dsh-tool-skill-manage` 等）。采纳上游版本前对照其包清单，新包名与本侧撞名即解析歧义。

## Attribution

灵感来自 [Hermes Agent](https://github.com/NousResearch/hermes-agent)。
Anchored Standard 兼容测试 fixture 来自
[xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)。

## License

MIT
