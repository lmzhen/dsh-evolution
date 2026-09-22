# dsh-evolution：给 DeepSeek Harness 的自进化记忆与技能

[English](./README.md) · 中文

[![npm](https://img.shields.io/npm/v/@lmzhen/dsh-evolution-all?style=flat-square&label=npm)](https://www.npmjs.com/package/@lmzhen/dsh-evolution-all)
[![release CI](https://github.com/lmzhen/dsh-evolution/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/lmzhen/dsh-evolution/actions/workflows/release.yml)
![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

**一次安装：Agent 会记下你项目的要点，并持续改进自己的技能。**

目录：[这是什么](#这是什么) · [你该装吗](#你该装吗) · [安装](#安装) ·
[选一种安装方式](#选一种安装方式m1m4) · [工作原理](#工作原理) · [日常使用](#日常使用) ·
[如何调低或关掉](#如何调低或关掉) · [安全边界](#安全与边界) · [已知限制](#已知限制) ·
[故障排查](#故障排查) · [文档索引](#文档索引)

> `@lmzhen` 下的社区发布包由 dsh-evolution 社区维护，**不是** DeepSeek 官方发布；
> 它们既不用 `@deepseek-ai/*` 包名，也不用 DeepSeek 品牌。

## 这是什么

30 个可组合的 Cordis 插件，给一套 DeepSeek Harness 装上自进化层：Agent 会回顾自己的对话，维护**记忆**、提出并修补**技能**，并让这个技能库随时间新陈代谢。模型只能写记忆和技能——策略、提示词、路由、状态和审计历史是它永远碰不到的控制面数据。

它不是模型，不是托管服务，也没有自己的 GUI：它带来的是模型工具、斜杠命令，以及你自己 `$DSH_HOME` 下的文件。

## 你该装吗

如果你已经烦透了每个新会话都要重新解释同一个项目，或者烦透了手工维护一堆永远不进步的技能，那就装它。装了之后：

- **事实留得下来。** 评审会把真正重要的东西写进记忆，之后的会话自动拿到这份注入。
- **技能会自己变好。** Agent 从真实发生过的事里修补自己的技能，计划先验证再执行——还有 curator 合并近重复、归档已经没人用的。
- **控制权始终在你手里。** 每一次写入都过威胁扫描和不可变策略；再加一个开关，每次写入都会先等你批准。技能销毁从来不是硬删除。
- **一切看得见。** 计数、运行报告和变更日志都是 `$DSH_HOME` 下的文件。没有遥测服务——除了你本来就在发的提示词，什么都不离开你的机器。

如果你想要一个完全撒手不管的黑盒，或者需要「按会话给工具、但不要 profile 级自动化」（那是安装形态 ①：各形态及其验证状态都在 `packages/INSTALL.md`），那就别装。

## 安装

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all   # 默认全量包
# 重启宿主让 profile 重新组合，然后在任意会话里：
/evolution doctor
```

你会看到装上了 29 个包（发布面 30 个；`@lmzhen/dsh-evolution-preset` 是 agent 预设形态，不进 `node_modules`）；重启之后，doctor 报告会说明它识别到的安装形态和找到的行。不用问模型就能验证：

```bash
dsh --profile web --dump-config | grep -c 'id: evolution-'   # 19 行
dsh --profile web --dump-config | grep -c 'id:'              # 209 个 id，全部互不相同
```

启动时不写任何东西：第一次评审要等间隔窗口。想让每次写入都先过你的批准，而不是全自动？加上 `approval.enabled: true`（也就是 M2）。

## 选一种安装方式（M1–M4）

M 编号在**本文件**定义；安装**形态**以及各形态在平台线上的验证状态，唯一出处是 `packages/INSTALL.md`。

| 形态 | 怎么做 | 你得到什么 |
|---|---|---|
| **M1 全自动（默认；0.3.54 起）** | `dsh plugin --profile web add @lmzhen/dsh-evolution-all` | 两条回路都跑、都写盘；每个会话都有模型工具 |
| **M2 人审把关** | M1 + `approval.enabled: true` | 每次写入都变成 `/evolution pending`，由你批准或拒绝 |
| **M3 只装底座** | `dsh plugin --profile web add @lmzhen/dsh-evolution-host` | 自动化照常跑，模型**拿不到**记忆/技能工具 |
| **M4 按会话启用（进阶）** | M3 + `/evolution preset install` | 只有选了 Evolution 预设的会话才有工具（与 M1、旧 one-click 预设互斥） |

这几种只能挂一种：几个 bundle 共享基础设施行，重复的 id 会让加载器在启动时直接中止。bundle 还把状态行钉在 `provider: json` 上，这样无关的 overlay 不会悄悄把你的状态挪到一个空域上。

## 兼容性

| | 取值 |
|---|---|
| 已验证的 DSH 平台线 | **`0.1.5-rc.2`**（`PLATFORM_VERSION`；`UPSTREAM_SHA=fb2c4b9e…`） |
| 声明的依赖窗口 | 每个 `@deepseek-ai/dsh-*` 依赖/peer 上都是 `^0.1.5-rc.2` |
| 家族版本 | `0.9.0`（npm `latest`；各形态状态见 `packages/INSTALL.md`） |
| Node | 22.19+ 或 24+（`engines`） |

预发布 range 只认**一个**锚点，而不是一整族：`^0.1.5-rc.2` 会拒绝更晚的预发布后继版，但接受稳定版 `0.1.5`。更早的预发布线在依赖解析阶段就失败——这是支持窗口，不是 bug。

## 工作原理

| 层 | 做什么 | 你能察觉到什么 |
|---|---|---|
| **Review** | 观察会话事件，应用 substantive 门，产出经过验证的计划（`evolution-review`、`evolution-plan-validator`） | 评审发生在对话边界，不会打断任务中途 |
| **记忆回路** | 写持久事实与用户画像，把指引注入新会话（`memory`、`memory-files`、`tool-memory`） | 新会话已经知道你的项目 |
| **技能回路** | 通过 `skill_manage` 工具提出、写入、修补技能；目录把它们暴露给模型（`tool-skill-manage`、`evolution-skill-catalog`） | 你不必自己写的技能 |
| **Curator** | 确定性的 stale/archive 生命周期 + LLM 提名，每次运行前先快照（`evolution-curator`） | 技能库保持小而整洁，重复的被合并 |
| **控制面** | 威胁扫描、不可变策略、可选带重放的分阶段审批（`evolution-threat`、`evolution-policy`、`evolution-approval`） | 被拒绝的写入会告诉你原因，破坏性动作绝不静默 |
| **管道** | IO 接缝、状态 provider、事件、activity、replay、学习图谱（`evolution-io*`、`evolution-state*`、`evolution-activity`、`evolution-replay`） | 一切都是你能读、能备份、能删除的文件 |

```text
$DSH_HOME/evolution/events.json     追加式的反馈/用量时间线
$DSH_HOME/evolution/review-state.json  每个会话的评审计数
$DSH_HOME/evolution/activity.json    计划执行结果        reports/  curator 运行报告
$DSH_HOME/skills/                    技能树（+ .usage.json）
$DSH_HOME/memories/                  MEMORY.md + USER.md
```

有两个默认值值得先知道。**评审在会话内跑**（`reviewMode: 'inject'`，0.3.74 起就是默认）——不会另起子代理，因此没有单独的评审账本；想要干净的父上下文或专用模型，`subagent` 是显式 opt-in。**跨会话消费者按会话生效：** review 与用量遥测只有在某个会话能解析出家族的模型工具时才作用于它——M1 下每个会话都成立，host-only 安装（M3）则永远不成立，插件会为此报告一次，而不是静默失败。

## 日常使用

- `/evolution doctor` 报告装了什么：安装形态、受作用域约束的行、服务、待办数量。
- `/evolution pending` + `approve` / `reject`：分阶段写入（M2）。
- `/evolution curator status`：上次运行与下次到期（curator 每小时 tick；默认每 168 h 到期一次，所以安静几周是正常的）。
- `/evolution preset install [--base <name>[,<name>...]]`：生成家族 agent 预设（M4）。
- `/evolution mutations` 是写入日志；`/graph` 把技能与记忆画成图谱。

完整的命令面只渲染一次，放在 `packages/README.md`（§Command reference）；环境变量与字段级旋钮的完整参考也在那里。

### 在界面里改参数

家族在浏览器里只有一处界面：设置栏 **「自进化」**。它把审查／记忆／策展／技能四个命名空间里**用户可改**
的参数列成可折叠卡片——每个字段带单位、当前值的来源（`部署` / `用户`）、按注册表类型渲染的控件
（开关／下拉／数字／文本），以及注册表自己的说明。改完按「保存」；「放弃修改」丢弃草稿；想让某个字段
回到部署值，按它自己的「恢复部署默认」。

写入落在 `~/.dsh/settings.yaml` 的对应命名空间下，**即时生效、不用重启**。同一个 store 也可以在会话里用
`/evolution policy set <id> <value>` 写，`/evolution params` 会把每条参数的档位、生效时机与当前来源打出来。
资源上限、provider、影响提示词身份这类**部署面**参数仍留在 `cordis.yml`／profile 的补丁层——卡片只列可改项，
doctor 的「参数面分歧」一节会报告两边不一致的地方。
## 如何调低或关掉

| 拨盘 | 取值 | 字段 |
|---|---|---|
| autonomy | auto / reviewed / observe | `approval.enabled`、`reviewEnabled` |
| scope | global / per-session | evolution-all vs host + agent 预设 |
| curatorBackground | on / off | `autoStart` / `curatorIntervalHours` / `minIdleHours` |
| memoryInjection | on / off | `memoryEnabled`（关掉 = 整行变 no-op） |
| threatStrictness | strict / 豁免清单 | `threatExemptLabels`（按配置点声明；清单唯一出处是 `evolution-threat/README.md`） |

三种调低方式，按安静程度递增：**加闸门**（`approval.enabled: true`）、**停止评审**（`reviewEnabled: false`）、**缩到 M3**（完全没有模型工具）。几个容易让人意外的默认值：`reviewEnabled: true`、`reviewMode: 'inject'`、`reviewMemoryInterval = reviewSkillInterval = 10` 轮，substantive 门 =「≥3 次工具调用 **或** ≥200 个用户字符 **或** ≥500 个 agent 字符」，curator 到期间隔 168 h。

<details>
<summary>环境变量（完整清单）</summary>

| 变量 | 在哪读 | 作用 |
|---|---|---|
| `DSH_EVOLUTION_SESSION_QUERY` | profile 配置 | `startup` / `first-search` / `never`（SQLite 索引 openAt）；非法值归一为 `startup` |
| `DSH_EVOLUTION_SESSION_QUERY_PATH` | profile 配置 | 持久索引路径；空串回退到 `$DSH_HOME/evolution/session-query.db` |
| `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS` | 插件代码 | `1` 把预设 delta 行冲突从 fail-loud 降为 warn + 双行保留 |
| `EVOLUTION_SCOPE` | 仅源码安装器 | 写进生成的 profile/preset 行的 scope；插件运行时不读它 |
| `DSH_EVOLUTION_DELTA_PATH` | 仅源码安装器 | 覆盖 layered 安装器合成时读取的 agent-preset delta 片段 |
| `DSH_AGENT_PRESET_ROOT` | 仅源码安装器 | 覆盖预设变体安装到的 `.agent-presets` 根目录；设置后该目录必须已存在 |
| `DSH_EVOLUTION_ARCH_STRICT` | 仅守卫脚本 | `1` 让架构重复守卫 fail-loud（等同 `--strict`） |
| `DSH_EVOLUTION_DECLARED_CONFIG_STRICT` | 仅守卫脚本 | `1` 让声明配置触达守卫 fail-loud（等同 `--strict`） |

</details>

## 安全与边界

1. **模型只能写记忆和技能**：其他一切都是控制面数据（能力包/动态插件同样不在写入面内：创建、审批与激活归平台 Creator 模式；0.3.66 起本家族的 capability 适配器已移除，见 `packages/INSTALL.md`）。
2. **每一次变更都有闸门**：`tools.guard` 的威胁扫描，打开审批时再加上分阶段审批；被批准的写入会经它注册时的同一个 runner 重放。
3. **没有任何东西被静默销毁**：技能归档移进 `.archive/`，而且每次 curator 运行前都会先给技能树做快照。
4. **离开会话、交给模型的文本会被脱敏**（PEM 块、URL 里的凭据、内联赋值、camelCase 凭据键）。
5. **没有遥测。** 计数和报告都是 `$DSH_HOME` 下的文件；本家族不发布 `./invariant` 伴生包，因为平台永远不会执行它。

## 已知限制

- `reviewMode` 默认是 `inject`：评审在会话内跑，不产生 `evolution/plan-applied` 账本，所以 activity 存储和 replay 视图会一直空着，直到你选择 `subagent` 评审。
- 会话作用域的消费者在 host-only 安装（M3）上永远匹配不上；在 M4 上只有选了 Evolution 预设的会话才匹配。
- 浏览器里只有一处界面：一个设置栏（**自进化**）。家族加的是斜杠命令、模型工具和那个参数面板，没有别的网页 UI。
- 只有一个平台锚点：换一条新的平台线需要一次家族迁移，而不是改个配置。
- `npm dist-tags.next` 停在 `0.3.18`（历史残留）；`latest` 是正确的，`add` 解析的也是它。

## 故障排查

**还什么都没写。** 第一次评审要等间隔窗口（`reviewMemoryInterval` / `reviewSkillInterval`，默认 10 轮）和 substantive 门——一行字的会话本来就不值得评审。

**`activity.json` 是空的。** 这是 inject 模式的行为，不是故障；见上面第一条已知限制。

**怎么确认正在跑哪个版本？** 拿 `profiles/<name>/pnpm-lock.yaml` 和 `npm view @lmzhen/dsh-evolution-all version` 对一下；宿主重启时 profile 才会重新组合。

**威胁扫描拒绝了一次写入。** 改写它，或者用 `threatExemptLabels` 豁免一个已知无害的 label。

<details>
<summary>错误码</summary>

| 编号 | 含义 | 下一步 |
|---|---|---|
| 启动报 `invariants: package "…" is already registered` | 两个 bundle 把同一批行挂了两次 | `evolution-all` / `evolution-host` / `evolution-preset` 只留一个 |
| `E-301` / `E-302` / `E-303` | approval / curator / replay 服务未挂载 | 挂上对应的行（它们随 host/all 提供），然后跑 doctor |
| `E-306` | 该部署对前台写入做 stage，但这条命令没法通过技能 runner 重放 | 直接 approve-and-execute，或者明确设成 `stageForeground: false` |
| `E-304` | 挂载的 approval 服务早于 release 能力（升级不完整/错位） | 改用 `reject` 处理该 pending 记录，不要 `release` |
| `E-305` | 本次调用没有携带 agent（脚本/headless 调用方走到了需要会话的分支） | 在 GUI 或 CLI 的会话里运行该命令 |
| `E-307` / `E-311` | 设置服务缺失或报不出 section（`/evolution params`、`/evolution policy set` 需要它） | 挂上设置行（随 host/all 提供），然后跑 doctor |
| `E-308` / `E-313` | 参数分组或参数 id 不存在 | 用 `/evolution params` 列出来：每个注册 id 的层级与 owner 都在里面 |
| `E-314` / `E-315` / `E-316` | 该 id 是部署参数、没有用户层，或它的 owner 没挂载 | 在 `cordis.yml` 里写，或挂上 owner 行 —— 报文里点名层级、owner 与命名空间 |
| `E-309` / `E-310` | 你的写入输给了并发修订，或设置服务拒绝了它（原因随报文给出） | 用 `/evolution params` 重读后重试 |
| doctor 报 `install form: none` | 没有装任何 bundle | `dsh plugin --profile web add @lmzhen/dsh-evolution-all` |

本表是「症状 → 下一步」对照；每条编号的原文只存一处（`evolution-core/src/errors.ts`，`E-301`–`E-316`），运行时按原文输出。

</details>

## 卸载

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
```

回路停了，数据不会：记忆、技能、状态、报告和审批历史都留在 `$DSH_HOME` 下，重装后会重新读回来。

## 文档索引

| 文档 | 里面有什么 |
|---|---|
| [`INSTALL.md`](./INSTALL.md) | 安装形态、scope、profile 覆盖示例 |
| [`packages/INSTALL.md`](./packages/INSTALL.md) | 安装形态的语义与逐平台验证矩阵 |
| [`packages/README.md`](./packages/README.md) | 命令参考、包地图、环境变量/旋钮参考、布局说明 |
| [`CHANGELOG.md`](./CHANGELOG.md) | 每个版本改了什么，连同原因和证据 |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 一个事实只能写在哪儿、十八步门禁、仓库约定 |

<details>
<summary>维护者：上游升级对照清单</summary>

1. **技能 provider 的影子 rank**：本家族的 provider 注册 `EVOLUTION_SKILL_RANK = 390`，依赖上游的 `USER_DSH_RANK`（`0.1.5-rc.2` 上是 400）排在它上面；两边都要复核。
2. **`@deepseek-ai` 包名撞名**：发布工具会把家族包名改写成 `@lmzhen`；每个上游版本都要检查有没有和我们撞名的包。
3. **ToolRuntime 参数冻结**：`tool.execute` 拿到的是 `deepFreeze` 过的快照：要新建对象，不要往 `args` 上赋值。
4. **逐技能调用的 frontmatter**：影子 provider 必须继续解析和上游一样的键；它对旧键的处理口径，唯一出处是 `evolution-skill-catalog/README.md`。
5. **Home 路径语义**：上游 `resolveDshHome` 只用 `trim()` 做 adoption 判定、保留原始 env 值、展开 `~` 并总是解析成绝对路径；`evolutionRoot` 与 `install-layered.mjs` 走的是同一条线。

</details>

## 许可与归属

MIT，见 [LICENSE](./LICENSE)。设计灵感来自 [Hermes Agent](https://github.com/NousResearch/hermes-agent)（MIT）；这是独立实现，与 Nous Research、DeepSeek 均无隶属或背书关系。欢迎到仓库提 issue 和反馈——本家族不带遥测，所以附上你的 `/evolution doctor` 输出是最快的路径。Anchored Standard 兼容 fixture 取自 [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)（MIT）。
