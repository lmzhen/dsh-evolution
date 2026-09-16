# dsh-evolution · 给 DeepSeek Harness 的自进化记忆与技能

[English](./README.md) · **中文**

<p align="center">
  <a href="https://www.npmjs.com/package/@lmzhen/dsh-evolution-all"><img src="https://img.shields.io/npm/v/@lmzhen/dsh-evolution-all?style=flat-square&label=npm&color=4c6ef5" alt="npm version"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@lmzhen/dsh-evolution-all"><img src="https://img.shields.io/npm/dm/@lmzhen/dsh-evolution-all?style=flat-square&label=downloads%2Fmo" alt="npm downloads"></a>
  &nbsp;
  <a href="https://github.com/lmzhen/dsh-evolution/actions/workflows/release.yml"><img src="https://github.com/lmzhen/dsh-evolution/actions/workflows/release.yml/badge.svg?branch=main" alt="release CI"></a>
  &nbsp;
  <a href="https://github.com/lmzhen/dsh-evolution"><img src="https://img.shields.io/github/stars/lmzhen/dsh-evolution?style=flat-square&label=stars" alt="stars"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-0.1.5--rc.2-4c6ef5?style=flat-square" alt="已验证的平台线">
  &nbsp;
  <img src="https://img.shields.io/badge/node-22.19%2B%20%7C%2024%2B-339933?style=flat-square" alt="node">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT">
</p>

<p align="center">
  <strong>Hermes 风格的自进化，装进 DeepSeek Harness——一次安装，两条回路。</strong><br>
  <em>review · memory · skills · curator · 审批闸门 · 威胁扫描 · 审计轨迹</em>
</p>

<p align="center">
  <a href="#这是什么">这是什么</a> ·
  <a href="#为什么会有它">为什么</a> ·
  <a href="#60-秒装完">安装</a> ·
  <a href="#选一种安装方式m1m4">选型</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="#能力清单">能力清单</a> ·
  <a href="#可观测与验证">可观测</a> ·
  <a href="#配置">配置</a> ·
  <a href="#安全与边界">安全边界</a> ·
  <a href="#已知限制">已知限制</a> ·
  <a href="#故障排查与-faq">故障排查</a> ·
  <a href="#文档索引">文档索引</a>
</p>

> `@lmzhen` 下的社区发布包由 dsh-evolution 社区维护，**不是** DeepSeek 官方发布；
> 这些发布不使用 `@deepseek-ai/*` 包名，也不使用 DeepSeek 品牌。

## 这是什么

这是一个由 **29 个可组合的 Cordis 插件**组成的家族，给一套 DeepSeek Harness 装上自进化层：Agent 会回顾自己的对话，维护**记忆**、提出并修补**技能**，并让这个技能库随时间被治理——每一次写入都过策略/威胁/审批控制面。

模型能做的只有「提出并写入」**记忆**和**技能**两类内容。策略、提示词、路由、状态和审计历史属于控制面数据，模型永远写不进去。

它**不是**什么：不是模型，不是托管服务，也没有自带的 GUI——没有浏览器面板要装。它加进来的东西只有模型工具、斜杠命令，以及你自己 `$DSH_HOME` 下的文件。

## 为什么会有它

编程 Agent 会遗忘。每个新会话都在重新学同一套项目约定；它攒下的那些「技能」既不会变好，也不会合并，更不会退役。Hermes Agent 用两条回路解决了这件事；本家族把那套设计移植到 DeepSeek Harness 的插件模型上，并让每一次写入都可观测、可回滚：

```text
            对话事件
                │
   ┌────────────▼────────────┐        ┌───────────────────────┐
   │ 评审（闸门 + 计划）     │───────▶│ 记忆进化              │  <DSH_HOME>/memories
   │ 节奏 / 完成触发         │        │ 持久事实 · 用户画像   │  注入下一个会话
   └────────────┬────────────┘        └───────────────────────┘
                │
                │                     ┌───────────────────────┐
                └────────────────────▶│ 技能进化              │  <DSH_HOME>/skills
                                      │ 新建 · 修补 · 合并    │  目录对模型可见
                                      └───────────┬───────────┘
                                                  │ 用量 + 反馈
                                      ┌───────────▼───────────┐
                                      │ Curator（代谢）       │  合并 · 降级 · 归档
                                      └───────────────────────┘
    每一步都经过：威胁扫描 → 不可变策略 →（可选）审批闸门
```

## 原生 DSH 与本家族的差别

| 能力 | 原生 DeepSeek Harness | 装上本家族之后 |
|---|---|---|
| 跨会话记忆 | 手动记笔记 | 由评审写入的记忆 + 用户画像，注入新会话 |
| 技能库 | 自己手写的文件 | 模型提出写入/修补，计划先验证，目录带 60 字符上限 |
| 技能维护 | 无 | curator：合并近重复、降级、归档，每次运行前先快照 |
| 写入安全 | 无 | 有序守卫：威胁扫描 → 不可变策略 → 分阶段审批（可选开启） |
| 审计轨迹 | 无 | `/evolution mutations`、每次 curator 运行报告、activity 存储 |
| 用量洞察 | 无 | 每个技能的使用/查看/修补计数；低质量标记 |
| 对话评审 | 无 | 会话内按节奏/完成触发，或显式启用的 subagent 评审器 |
| 自我改进闭环 | 无 | 反馈 → 质量 → curator 决策 → 目录排序 |

## 60 秒装完

```bash
# 1. 默认全量包（基础设施 + 每个会话都有的模型工具）
dsh plugin --profile web add @lmzhen/dsh-evolution-all

# 2. 重启宿主，让 profile 重新组合
# 3. 然后在任意会话里问一句：
/evolution doctor
```

想要「写完先问我」而不是全自动？给那一行加上 `approval.enabled: true`（下面的 M2 形态）。其余都有合理默认：启动时不写任何东西，第一次自动评审要等间隔/用量窗口打开。

一次真实安装长这样（0.3.83，本项目自己的宿主）：

```text
$ dsh plugin --profile web add @lmzhen/dsh-evolution-all
+ @lmzhen/dsh-evolution-all 0.3.83   … 28 packages, Done in 8.3s

$ dsh --profile web --dump-config | wc -l
773                      # composed lines; 207 distinct row ids, 0 duplicates
```

> [!WARNING]
> 插件和别的 DSH 插件一样，在你的本地权限下运行第三方代码。安装前先翻一遍源码，第一次试建议放在不含生产凭据的 profile 里。

## 选一种安装方式（M1–M4）

M 编号在**本文件**定义；安装**形态**及各形态在平台线上的验证状态单源在 `packages/INSTALL.md`，layered 变体对会话层面的实际后果也在同一份文件（"Install forms" 一节）里只讲一次。

| 形态 | 怎么做 | 你得到什么 |
|---|---|---|
| **M1 全自动（默认）** | `dsh plugin --profile web add @lmzhen/dsh-evolution-all` | 两条回路都跑、都写盘；每个会话都有模型工具 |
| **M2 人审把关** | M1 + `approval.enabled: true` | 进化可以提出，但每次写入都变成 `/evolution pending`，由你批准或拒绝 |
| **M3 只装底座** | `dsh plugin --profile web add @lmzhen/dsh-evolution-host` | 自动化照常跑，模型**拿不到**记忆/技能工具 |
| **M4 按会话启用（进阶）** | M3 + `/evolution preset install` | 只有选了 Evolution 预设的会话才有工具（与 M1、旧 one-click 预设互斥） |

0.3.54 起 `evolution-all` 就是默认全量包；旧的 one-click 预设（`@lmzhen/dsh-evolution-preset`）则是 M1 的兼容写法。在 M1/M3 上，钉住状态介质的那一行很关键：bundle 钉了 `provider: json`，这样无关的 overlay 不会悄悄把你的状态挪到一个空域上。

## 兼容性

| | 取值 |
|---|---|
| 已验证的 DSH 平台线 | **`0.1.5-rc.2`**（`PLATFORM_VERSION`；`UPSTREAM_SHA=fb2c4b9e…`） |
| 声明的依赖窗口 | 每个 `@deepseek-ai/dsh-*` peer/依赖上都是 `^0.1.5-rc.2` |
| 家族版本 | `0.3.83`（`@lmzhen/dsh-evolution-all`，npm `latest`） |
| Node | 22.19+ 或 24+（`engines`） |
| 各形态状态 | `packages/INSTALL.md`——哪些形态在这条平台线上实测过，哪些只是源码级判定 |

预发布 range 只认**一个**锚点，而不是一族：`^0.1.5-rc.2` 会拒绝更晚的预发布后继版，但接受稳定版 `0.1.5`。更早的预发布线（`0.1.1-rc.2` 及以前）在依赖解析阶段就失败——这是支持窗口，不是 bug。拿不准就跑 `/evolution doctor`：它会报告检测到的安装形态和找到的行。

平台预设的兼容面（`standard` / `ptc` / `cordis` / `minimal`）与 `--base` 变体各自的前置条件，分别单源在 `packages/INSTALL.md`（§Platform mode × self-evolution）和 `evolution-agent/README.md`（§Preset variants）。

## 工作原理

| 层 | 做什么 | 住在哪 |
|---|---|---|
| Review | 观察会话事件，过 substantive 门，产出经过验证的计划 | `evolution-review`（+ `evolution-plan-validator`） |
| 记忆回路 | 写持久事实与用户画像；把指引注入新会话 | `memory` / `memory-files` / `tool-memory` |
| 技能回路 | 通过 `skill_manage` 工具提出/写入/修补技能；目录把它们展示给模型 | `tool-skill-manage` / `evolution-skill-catalog` |
| Curator | 确定性生命周期（stale/archive）+ LLM 提名，每次运行前先快照 | `evolution-curator` |
| 控制面 | 威胁扫描、不可变策略、可选带重放的分阶段审批 | `evolution-threat` / `evolution-policy` / `evolution-approval` |
| 管道 | IO 接缝、状态 provider（json/domain）、事件、activity、replay、学习图谱 | `evolution-io*` / `evolution-state*` / `evolution-activity` / `evolution-replay` |

你的数据落在哪——全部在你自己的 home 下，中间没有任何服务：

```text
$DSH_HOME/evolution/events.json          追加式的反馈/用量时间线
$DSH_HOME/evolution/review-state.json    每个会话的评审计数
$DSH_HOME/evolution/activity.json        自进化计划的执行结果
$DSH_HOME/evolution/reports/             curator 运行报告（json + md）
$DSH_HOME/skills/                        技能树（+ .usage.json 计数）
$DSH_HOME/memories/                      MEMORY.md + USER.md
```

**评审怎么投递。** `reviewMode` 从 0.3.74 起默认是 `inject`：评审在会话内、于对话边界执行，因此不会 spawn 任何东西，也不为第二个前缀花预算。`subagent` 是显式 opt-in，适合想让评审在干净的父上下文里读技能、或想用专用模型的部署；review watchdog 与 review-model 旋钮作用的正是这一模式。

**会话作用域。** 跨会话消费者（review、skill-usage）声明为 `sessionScoped`：只有某个会话能解析出本家族的模型工具时，它们才作用于该会话。用 `all` 包时模型行位于 profile root，所以每个会话都满足；host-only 安装（M3）则天然永远匹配不上——插件会为此打一条警告，而不是静默失败。

## 能力清单

| 能力 | 它为你改变什么 |
|---|---|
| **记得住的记忆** | 值得留下的事实由评审写入，并在之后的会话里注入——不用每次重新解释你的项目 |
| **会变好的技能** | Agent 从真实发生过的事里修补自己的技能，计划先验证再执行 |
| **代谢** | curator 合并近重复、降级没人用的技能并归档——每次运行前先快照，所以 `restore` 永远可行 |
| **你能控制的闸门** | 一个配置开关把每次写入变成 `/evolution pending` 条目，由你批准或拒绝；批准后经它注册时的同一个 runner 重放 |
| **带豁免清单的威胁守卫** | 写入记忆/技能时，指令式内容会被拒绝；已知无害的 label 可按配置点豁免 |
| **审计轨迹** | `/evolution mutations` 与每次 curator 运行报告，回答「是谁、什么时候改了我的技能」 |
| **用量驱动的决策** | 每个技能的使用/查看/修补计数、低质量标记，以及排好序的目录，让模型先看到好的 |
| **没有生产者的反馈通道** | `evolutionFeedback.record()` 是给自家宿主/命令用的公开接缝；家族自身不提供生产者 |
| **重放与图谱** | 针对技能改动的 A/B 重放打分，以及覆盖技能与记忆的学习图谱 |

## 可观测与验证

上手第一天，四条命令就够——完整的 `/evolution` 命令表只渲染一次、住在 `packages/README.md`（§Command reference，由注册表渲染，并被它的 spec 逐字节钉住）：

- `/evolution doctor` —— 装了什么：形态、作用域内的行、服务、待办数量。
- `/evolution pending` + `approve` / `reject` —— 分阶段写入（M2）。
- `/evolution curator status` —— 后台治理：上次运行、下次到期、计数。
- `/evolution preset install [--base <name>[,<name>...]]` —— 生成家族 agent 预设（M4）；每个指定的 base 一份变体，一次生成。

之后想要留痕的时候：`/evolution mutations`（每一次写入）、`/evolution release <id>`（回收一条僵死的 `executing` 记录）、`/evolution maintain --facts`（维护扫描）与 `/graph`（技能 + 记忆视图）。

**不用问模型就能验证一次安装：** 组合出来的 profile 不能有重复的行 id，家族的行必须都在。

```bash
dsh --profile web --dump-config | grep -c 'id: evolution-'   # 18 行
dsh --profile web --dump-config | grep -c 'id:'              # 207 个 id，全部互不相同
```

## 配置

五个语义拨盘；底层的每个字段都是普通的行配置，细粒度旋钮归入一个三级附录（**daily**——评审间隔、curator 节奏；**tuning**——健康阈值、质量权重；**high-risk**——`maxOpsPerPlan`、字符预算、评审/curator 的模型选择）。

| 拨盘 | 取值 | 背后字段 |
|---|---|---|
| autonomy | auto / reviewed / observe | `approval.enabled`（profile 行）、`reviewEnabled`（evolution-review）、`/evolution pending\|approve\|reject` |
| scope | global / per-session | 包选择——evolution-all（全局，默认）vs host + Evolution 预设（按会话） |
| curatorBackground | on / off | `autoStart` / `intervalHours` / `minIdleHours`（evolution-curator） |
| memoryInjection | on / off | `memoryEnabled`（tool-memory：关掉时整行是 no-op——既不注册 `memory` 工具，也不注入指引/快照） |
| threatStrictness | strict / 豁免清单 | `threatExemptLabels`——按配置点声明（守卫行、命令面、store 选项）；声明点的清单单源在 `evolution-threat/README.md` |

先说几个容易让人意外的默认值：`reviewEnabled: true`、`reviewMode: 'inject'`、`memoryInterval = skillInterval = 10` 轮，substantive 门 =「≥3 次工具调用 **或** ≥200 个用户字符 **或** ≥500 个 agent 字符」，curator 每小时 tick、到期判定间隔 `168 h`。

环境变量：

| 变量 | 在哪读 | 作用 |
|---|---|---|
| `DSH_EVOLUTION_SESSION_QUERY` | profile 配置（bundle patch 里的 `!!js`） | `startup` / `first-search` / `never`（SQLite 的 openAt）；非法值归一为 `startup` |
| `DSH_EVOLUTION_SESSION_QUERY_PATH` | profile 配置（bundle patch 里的 `!!js`） | 持久索引路径；空串回退到 `$DSH_HOME/evolution/session-query.db` |
| `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS` | 插件代码（core `env.ts`） | `1` 把预设 delta 行冲突从 fail-loud 降为 warn + 双行保留 |
| `EVOLUTION_SCOPE` | 仅源码安装器（`install-layered.mjs`、`test-support/row-contract.ts`） | 写进生成的 profile/preset 行的 scope；默认取包自身 scope。插件运行时不读它 |
| `DSH_EVOLUTION_DELTA_PATH` | 仅源码安装器（`install-layered.mjs`） | 覆盖 layered 安装器合成时读取的 agent-preset delta 片段（缺省是随包发布的 `evolution-agent/agent.cordis.yml`）；测试和一次性构建用它注入 fixture |
| `DSH_EVOLUTION_ARCH_STRICT` | 仅守卫脚本（`verify-arch-guards.mjs`） | `1` 让架构重复守卫从 warn 变为 fail-loud（等同 `--strict`）；插件运行时不读它 |
| `DSH_EVOLUTION_DECLARED_CONFIG_STRICT` | 仅守卫脚本（`verify-declared-config.mjs`） | `1` 让声明配置触达守卫从 warn 变为 fail-loud（等同 `--strict`）；插件运行时不读它 |

## 安全与边界

1. **模型只能写记忆和技能。** 策略、提示词、路由、状态和审计历史永远不是模型可写的；`evolution-policy` 装上一个单调的 `ctx.tools.guard`，`evolution-plan-validator` 拒绝禁止字段。
2. **每一次变更都过闸门。** `tools.guard` 的威胁扫描跑在 pre-execute 路径上；打开审批后，一次写入会先被 stage、由你复核，再经它注册时的同一个 runner 重放。
3. **技能销毁从来不是硬删除。** 归档会移进 `.archive/`，而且每次 curator 运行前都会先给技能树做快照（被活跃写锁占着的技能会跳过、记录在案，之后的 restore 会把它标为未回填）。
4. **评审计划需要证据。** 计划被会话的事件序列限界；非法的 op 会被丢掉，合法的照常应用。
5. **在边界上脱敏。** 任何离开会话、交给模型的文本都要过家族的密钥脱敏（PEM 块、URL 里的凭据、内联赋值和 camelCase 凭据键）。
6. **除了你本来就在发的提示词，什么都不离开你的机器。** 没有遥测服务：计数和报告都是 `$DSH_HOME` 下的文件。本家族不发布 `./invariant` 伴生包——平台不会自动装配任何东西，发了也永远不会被执行。

## 已知限制

- **`reviewMode` 默认是 `inject`。** 评审在会话内运行，而注入模式不产生 `evolution/plan-applied` 账本——activity 存储和 replay 视图会一直空着，直到你显式选择 `subagent` 评审。
- **会话作用域消费者。** 在 M3（host-only）下，review 与用量遥测永远匹配不上任何会话；在 M4 下，只有选了 Evolution 预设的会话才匹配。
- **没有 GUI 面板。** 家族加的是斜杠命令和模型工具，不是浏览器 UI。
- **curator 故意很慢。** 每小时 tick、默认 168 h 才到期——安静几周是正常的；`/evolution curator status` 会告诉你下次什么时候到期。
- **只有一个平台锚点。** 支持窗口正好是 `0.1.5-rc.2`；换一条新平台线需要一次家族迁移（见下面的上游升级对照清单）。
- **`npm dist-tags.next` 是陈旧的**，停在 `0.3.18`（历史残留）；`latest` 是正确的，`add` 解析的也是它。
- **仅维护者侧：** 发布链会把 `packages/scripts/**` 与第二份 checkout 比对，所以脚本改动要在发布前同步过去。
- **能力包（动态插件）不在家族的写入面内。** 创建、审批与激活归平台 Creator 模式；0.3.66 起本家族的 capability 适配器已移除——见 `packages/INSTALL.md` §Capability evolution (retired in 0.3.66)。

## 故障排查与 FAQ

| 症状 / 编号 | 含义 | 下一步 |
|---|---|---|
| 启动报 `invariants: package "…" is already registered` | 两个 bundle，或 bundle + 预设，把同一批行挂了两次 | `evolution-all` / `evolution-host` / `evolution-preset` 只留一个 |
| `E-301` | approval 服务未挂载 | evolution-approval 行随 host/all 提供；跑 `/evolution doctor` |
| `E-302` | curator 服务未挂载 | 挂上 evolution-curator 行；跑 doctor |
| `E-303` | replay 服务未挂载 | 挂上 evolution-replay 行；跑 doctor |
| `E-306` | 该部署对前台写入也做 stage，但 `/evolution consolidate` / `restore` / `skill restore`（以及 0.3.83 起无会话归因的 `restructure`）没法通过技能 runner 重放 | 直接 approve-and-execute，或有意把 `stageForeground: false` |
| 威胁扫描拒绝（记忆/技能写入） | strict 扫描命中了指令式短语 | 改写；或经 `threatExemptLabels` 豁免已知无害的 label |
| `/evolution doctor` 报 `install form: none` | 没有装任何 bundle | `dsh plugin --profile web add @lmzhen/dsh-evolution-all` |

**为什么到现在还什么都没写？** 第一次评审要等间隔窗口（`memoryInterval` / `skillInterval`，默认 10 轮）和 substantive 门。一行字的会话，故意不值得评审。

**为什么 `activity.json` 是空的？** 注入模式的评审不产生 `evolution/plan-applied` 记录。想要这本账，就切到 `reviewMode: 'subagent'`。

**怎么让它别写了？** 设 `reviewEnabled: false`（完全不评审）、`approval.enabled: true`（每次写入都等你），或者用 M3（不给模型工具）。

**怎么确认实际在跑哪个版本？** 拿 `profiles/<name>/pnpm-lock.yaml` 和 `npm view @lmzhen/dsh-evolution-all version` 对一下；宿主重启时 profile 才会重新组合。

## 卸载与回滚

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
```

移除这一行会停掉回路，但保留你的数据：记忆、技能、状态、报告和审批历史都留在 `$DSH_HOME` 下，重装即被再次接管。技能树只归档、从不硬删，所以回滚 = 重装 + `restore`。

## 文档索引

| 文档 | 里面有什么 |
|---|---|
| [`INSTALL.md`](./INSTALL.md) | 安装形态与 scope、profile 覆盖示例、各形态状态 |
| [`packages/INSTALL.md`](./packages/INSTALL.md) | 安装**形态**的语义，以及逐平台的验证矩阵 |
| [`packages/README.md`](./packages/README.md) | 渲染出来的 `/evolution` 命令参考与包级机制细节 |
| [`CHANGELOG.md`](./CHANGELOG.md) | 每个版本改了什么，连同原因和证据 |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 一个事实允许住在哪、十六步门禁、家规 |

## 开发

<details>
<summary><strong>包地图（29 个已发布包）</strong></summary>

| 包 | 角色 |
|---|---|
| `evolution-core` | 共享的纯 stores/prompts/signals/constants；没有主 Cordis 插件入口，也没有 `./invariant` 伴生包 |
| `evolution-io` / `evolution-io-node` | 文件树 IO 接缝注册表 + 原子 node:fs provider |
| `memory` / `memory-files` / `tool-memory` | 记忆接缝：注册表、provider、模型工具 |
| `skill-usage` / `tool-skill-manage` / `evolution-skill-catalog` | 用量遥测 + `skill_manage` + 原生 `ctx.skills` provider |
| `evolution-policy` | 不可变策略快照 + 原生 `tools.guard` 拒绝 |
| `evolution-plan-validator` | 对模型产出的计划做确定性验证 |
| `evolution-state-storage` / `-domain` / `-json` / `evolution-state` | 状态接缝：provider 注册表、storage-domain KV、JSON 兜底、消费者 |
| `evolution-approval` | 基于 `evolutionState` 的 Hermes 风格分阶段/待批写入 |
| `evolution-threat` | `tools.guard` 内容威胁守卫 |
| `evolution-review` | 信号门 → one-shot 评审器 → 已验证计划的执行 |
| `evolution-curator` | 确定性生命周期 + LLM 提名 + 运行报告 + min-idle 门 |
| `evolution-activity` | 计划结果的持久审计存储（`evolution/plan-applied`） |
| `evolution-feedback` | 持久反馈存储；暴露 `evolutionFeedback.record()` |
| `evolution-learning-graph` | 覆盖技能 + 记忆的图谱命令 |
| `evolution-replay` | A/B 重放打分 + 会话事件驱动 |
| `evolution-commands` | `/evolution` 命令面 |
| `evolution-maintenance` | 确定性维护扫描面（快照 / 漂移信号 / facts） |
| `evolution-host` | 宿主面基础设施 bundle（只读 `maintenance_probe` 诊断） |
| `evolution-agent` | Agent 预设：标准工具 + 四个模型行 |
| `evolution-preset` | 兼容性 one-click bundle |
| `evolution-all` | 全功能 bundle —— 默认安装 |

</details>

<details>
<summary><strong>两套布局与它们的 tsconfig</strong></summary>

撰写发生在扁平镜像（`packages/evolution-*`）里，它同时就是发布树——发布链不再跑它的 dev→mirror 同步步，也不会有第二棵树覆盖它。用于类型检查和测试的上游 checkout 把同一批源码放在 `packages/evolution/*` 下（CI 从平台 tag 构建那层 overlay；本机那棵旧 dev 树已经陈旧，根上有 `AUTHORING-MOVED.md` 标记）。那些 `packages/evolution/...` 项目引用只在那个 checkout 里解析得开——扁平的镜像单独跑不了它们。

`packages/scripts/**` 是唯一剩下的跨树义务：发布链的守卫把它和第二份 checkout 的副本逐字节比对，所以脚本改动要在发布前同步过去。

**保留的历史口径：**本镜像自 0.3.83 起才是撰写与发布树；那次守卫实测回灌 58 处（含一整棵缺失的 `checklists/**`），漂移会中止发布。tests 里约 30 组 `@deepseek-ai/*` 导入（I-03）**有意**未在 package.json 声明——它们只在上游合并布局下可解析，属已知取舍，不为测试补 devDependencies。

</details>

<details>
<summary><strong>上游升级对照清单（每次平台升级过一遍）</strong></summary>

1. **技能 provider 的影子 rank**：本家族注册 `EVOLUTION_SKILL_RANK = 390`，并依赖上游的 `USER_DSH_RANK`（400，在 `0.1.5-rc.2` 上复核过）排在它上面——更低的 rank 赢得 `user-dsh` source 的影子。每次升级都要复核两边。
2. **`@deepseek-ai` 包名撞名**：在上游 monorepo 内部，家族占用着看起来像官方的包名，发布工具会把每个 manifest、YAML 和构建产物 `.js`/`.d.ts` 里的名字改写成 `@lmzhen`。每个上游新版本都要检查有没有和我们撞名的包。
3. **ToolRuntime 参数冻结**：`tool.execute` 拿到的是 `deepFreeze` 过的参数快照——要新建一个对象，不要往 `args` 上赋值。
4. **逐技能调用的 frontmatter**：上游按 SKILL.md 解析 `disable-model-invocation` / `user-invocable`；我们的影子 provider 必须继续解析同样的键（旧键的处理口径单源在 `evolution-skill-catalog/README.md`）。
5. **Home 路径语义**：上游 `resolveDshHome` 只用 `trim()` 做 ADOPTION 判定、保留原始 env 值、展开 `~ `，并且总是解析成绝对路径。`evolutionRoot` 与 `install-layered.mjs` 的 `resolveHome` 走的是同一条线；升级时三处一起重新 diff。

</details>

<details>
<summary><strong>门禁，以及它在哪儿跑</strong></summary>

十六步：类型检查、lint 和完整测试套件在上游 checkout 里跑；家族自己的 `verify-*` 守卫、manifest 与 tsconfig 检查、镜像一致性检查在镜像里跑。可执行的表格住在 `CONTRIBUTING.md` §The gate；十六步全绿之前，发布不算发布。

</details>

## 社区与贡献

- ⭐ **觉得有用？** 给仓库点个 Star——这是本项目唯一能拿到的信号：
  <https://github.com/lmzhen/dsh-evolution>
- 🧭 **想找更多插件：** [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
  和宿主内的插件市场（`dsh plugin --profile web add dshmarket`）。
- 🐛 **反馈 / 报 bug：** 到仓库开 issue。本家族不带遥测，所以附上你的 `/evolution doctor` 输出是最快的路径。
- 🤝 **贡献：** 先读 `CONTRIBUTING.md`——它规定了一个事实的单一 home 规则，以及一次改动必须过的门禁。
- 📜 **归属：** 设计灵感来自 [Hermes Agent](https://github.com/NousResearch/hermes-agent)
  （MIT）；这是独立实现，与 Nous Research、DeepSeek 均无隶属或背书关系。
- 🧪 **兼容测试 fixture：** Anchored Standard 兼容 fixture 取自
  [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)（MIT）。

## 许可

MIT——见 [LICENSE](./LICENSE)。
