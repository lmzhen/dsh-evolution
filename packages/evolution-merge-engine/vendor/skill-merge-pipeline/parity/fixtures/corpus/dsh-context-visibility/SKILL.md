---
name: dsh-context-visibility
description: Decide what reaches a DSH model context and how to inject.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [DSH, Platform, Context, Session]
    related_skills: [dsh-session-forensics, dsh-evolution-maintenance]
---

# DSH 模型可见面：什么进上下文、怎么有意注入

回答「X 会不会进模型上下文」这类问题，并设计「有意让模型看到某样东西」的功能。做法只有一条：**读平台源码的投影层**，别靠文档措辞或直觉。本文给判定流程、四个注入原语的语义、以及把源码结论绑到"用户机器上真正在跑的那份实现"的核法。

## When to Use

- 「框里/日志里/事件里的 X 会进大模型可见上下文吗」「能不能直接读到」「模型知道刚才发生的事吗」。
- 要让模型看到某样东西：注入上下文、通知、交接（handoff）、"扫描完自动告诉模型"。
- 排查「命令/工具的输出模型为什么不知道」「上下文里为什么多了一段」。
- 给 DSH 插件加**模型可见**的输入（新工具/新命令/新注入）前的定性。

## Prerequisites

- 平台源码两份（都在本机，钉住的 0.2.0-rc.2 是桌面线与上游对齐的那份）：
  - `D:\\dsh\\dsh-upstream-0.2.0-rc.2-overlay\\packages`（完整平台树，**首选**）
  - `D:\\dsh\\deepseek-harness\\packages`（开发单体仓；客户端/会话侧实现同样可读）
- 用户机器上**真正在跑**的那份实现：桌面 app 的 `D:\\Apps\\DeepSeekHarness\\resources\\app.asar`（未压缩，可直接 grep）。
- 读法：`grep`／`read` 两个工具足够；grep 二进制 asar 用 `pwsh` 的 `Select-String -SimpleMatch`。

## How to Run

1. **先定事件类型**：那段内容在平台里对应哪种 session event？（命令回执＝`command/done`；工具输出＝`tool/result`；注入＝`user/message`；插件自有事件＝它自己声明的 key。）
2. **查投影**：它是否在 `SURFACE_EVENT_TYPES` 里、`deriveEventMessage()` 是否给它返回消息。不在 ⇒ **不进模型**（log-only）。
3. **若是插件自有事件**：查该插件有没有声明 `@messageProjection`——有则它能**改写已有消息**（如 compaction），但仍**不能**凭空新增一段模型可见文本。
4. **要注入**：按语义挑原语（下表），并遵守两条硬规矩——① 注入内容**必须落成一条会话事件**（平台硬约定）；② 只注入**指针**，正文让模型按需 `read`（`tool/result` 天然可见）。
5. **验证**：夹具断言注入被调用且文本逐字；真机核「模型下一轮上下文里确实出现了那段」。
6. **找同类工具（生态面）走三车道**：① GitHub search `topic:dsh-plugin`（会被蹭标签污染，交叉验证）② 生态目录仓（`bruc3van/awesome-dsh-plugin` 403★ 每日抓+人工剔除、`awesome-dsh-plugin/awesome-dsh-plugin` 18.4k★ 全量）——拉 README 后 grep 条目描述比接口搜索准 ③ 插件站 dshbase / dshplugin.store / dshmarket。每个候选按两轴判：**能不能装**（npm registry 的 latest 与 peer 区间是否覆盖目标版本；仓库版本常高于已发布版本）＋ **模型能不能调**（`tools.register` 命中的工具名）。star 只作热度、不作能力证据。读数与排除清单见 `references/capability-triggers.md` §6。
7. **问「模型能不能自己调 X」时先问可调用面**：模型可调工具只由**工具注册表**决定（本会话权威＝系统提示里那份工具清单；插件注册进 `packages/tool/*`，插件自带命令不算）。注册表里没有 ⇒ 再看引擎的服务签名：把该能力的**入口点**与**触发器类型**列出来（如压缩＝`compactIfNeeded(trigger:'pressure'|'context-overflow')` 与 `compactNow(agent, signal, sourceCommandId)`，第三个参数叫 `sourceCommandId` 即设计上只给人命令用），据此判它归哪一平面。判定法见 `references/capability-triggers.md`。

## Quick Reference

**进模型 ⟺ 五类消息事件之一**（`core/session/src/surface.ts:50-56` 的 `SURFACE_EVENT_TYPES`）：`system/message`、`developer/message`、`user/message`、`assistant/message`、`tool/result`。其余一切（含 `command/run`／`command/done`、`subagent/*`、插件记录事件）落 `deriveEventMessage()` 的 `default` ⇒ **返回 null**。

**四个注入原语**（`core/agent/src/runtime-types.ts`）：

| 原语 | 语义（契约原话） | 行 |
|---|---|---|
| `followup(message)` | 排一轮普通后续并**唤醒**；该条**独占它自己那一轮** | :222 |
| `inject(message)` | **不唤醒**，排给下一次 pre-step；空闲时一直挂着；**可能错过**已 claim 批次的请求 | :241 |
| `steer(message)` | 交给最近一步：运行中在下一个 step 边界消费，空闲则起一轮 | :231 |
| `send(message, target, wakeup)` | 路由到收件箱边界，**wakeup 自选** | :215 |

**压缩面四平面**（2026-10-11 读码；细节与行号见 `references/capability-triggers.md`）：模型可调工具＝**无**；平台自动＝`compaction-basic`（`agent/pre-step` 压力触发器，`thresholdRatio` 默认 0.8、`retainRatio` 0.16）、`tool-result-pruner`（≥8192 字符留头 4096／尾 1024）、`image-offload`（超图预算换占位符）；人＝`/compact`（仅 agent 空闲且无排队唤醒时可用，忙碌回「agent is not idle」）⇒ **模型没有「主动压缩上下文」的工具**。会话日志里 `compaction/start|summary|end` 是平台事务留痕，不是模型可见消息。

**★★ 装配面另有两个原语，别与上面四个混淆**（2026-10-13 读 `dsh-system-prompt/lib/types/index.d.ts` 实测）：

| 原语 | 落点 | 文本形态 |
|---|---|---|
| `systemPrompt.section({name, order, text})` | 进 **`system/message`**，是**系统提示前缀的一部分** | `text: string \| ((ctx: AssembleContext) => string)` —— **两种原语同构，都是一次注册、每次装配求值** |
| `systemPrompt.context({name, order, text})` | 落成**耐久 `user/message` 快照**（`source:"runtime-context"`） | 同上 |

`AssembleContext = { scope?: ScopeKey; signal?: AbortSignal }`（同文件 :37-45）—— **只有 `scope`，没有 `agent`／`session`**；它是 merge-extensible 的，别假定字段只有这两个。

**选哪个（判据是"这段文本变不变"）**：**不变的纪律文本 ⇒ `section()`**（注册一次就永变，不失效前缀）；**会变的索引/清单 ⇒ `context()`**（文本不变时 loop **自己跳过**，不追加消息、不进前缀）。把**会变的东西**塞进 `section()` 是最隐蔽的一种错：每次变化都改写提示前缀，长会话里 KV 命中率被拖累，**而没人能从代码看出来**（多份文档把它列为"非目标"，措辞是"前缀失效次数越多……而没人能看出这是为了常驻付的税"）。
⇒ 好消息是**换落点不损失可见性**：两种落点分别产 `system/message` 与 `user/message`，**都在 `SURFACE_EVENT_TYPES` 里**。
⇒ 而 `context()` 的 provider 既然拿到 `scope`，**就不必为了"按会话区分"去 `agent/created` 里重注册**（那会把"0 事件监听"变成 1）。

**★★ 更正与实测（2026-10-13，读一个真实插件的接线）：会话身份走 `assembly.agent`，不要走 `scope`。** 上面那句"先探 `scope` 暴不暴露会话"是**多余且在实测里不成立的一探** —— `ScopeKey` 是 `object`（`dsh-scope/lib/types/index.d.ts:11`），**不是会话身份**；把"平台当下恰好传了它"当成契约，就是拿巧合当判据。可用的路径是：平台的装配调用点 `assembleContextFor`（`dsh-agent/lib/index.js:291-297`）返回 `{ agent, scope: agent }`，所以 provider 的**回调体**里 `assembly.agent` 就是那个 agent，**会话身份＝`agent.id`** ⇒ 不需要在 `agent/created` 里重注册（那会把"0 事件监听"变成 1，是要如实记账的代价）。
实测接线（`dsh-pixel-loupe` 的 `index.js:216/247`，两个原语各就各位）：`section({name:'…:discipline', order:60, text: IMAGE_DISCIPLINE})` 放**字符串常量**（一个 id 都不含），`context({name:'…:index', order:60, text: (assembly) => …})` 放**变动索引**，回调体里 `liveRowsForSession(domain.images?.entries(), sessionIdOf(assembly))`，而 `sessionIdOf` 只认 `holder?.agent?.id`、**绝不回退 `scope.id`**。**判据**：代码里出现 `assembly.scope`／`ctx.scope` 取会话身份就是可疑写法；出现 `assembly.agent.id` 才对。

**家族现状**：`/evolution learn` 是家族**唯一**的模型可见注入（`evolution-core/src/learn-prompt.ts`，英文）；家族**没有**声明任何 `@messageProjection`；家族自己的持久事件写在 `~/.dsh/evolution/events.json`（`appendEvolutionEvent`），**根本不在会话日志里** ⇒ 永远不进模型。

## Procedure

1. 定位事件名：`grep` 平台 `packages/<group>/<pkg>/src`；命令相关看 `interaction/commands`，工具结果看 `core/agent-loop`，注入看 `context/*`。
2. 读投影实现（唯一权威）：`read` `packages/core/session/src/surface.ts`，看 `SURFACE_EVENT_TYPES` 与 `deriveEventMessage()` 的 switch 与 `default`。
3. 读注入契约：`read` `packages/core/agent/src/runtime-types.ts` 的 `send`／`followup`／`steer`／`inject` 四段 JSDoc。
4. 抄官方样例：`context/agent-instructions`（生产者自烘框架文本，如 `<system-reminder>`）、`context/session-reference`（把别的会话做成**有界只读快照**注入＝指针模式的官方实现）、`context/tmux-context`；另有 `todo`／`plan`／`goal`／`schedule`。
5. 把结论绑到在跑的字节：`pwsh` 里 `Select-String -Path <app.asar> -Pattern '<函数名/标记串>' -SimpleMatch` 计数；命中即证明 app 内嵌那份与源码树同实现（外部表现与源码结论可互证）。
6. 设计注入时写清：注入**什么**（只指针）、**何时**（唤醒 or 不唤醒）、**失败怎么办**（只 warn，不改被观测对象的终态）、**开关默认值**（有成本的默认关）。
7. **本机主的设计偏好（2026-10-10 明说）**：能用**提示词／注入协议**引导模型达成的，**别新建命令、别接审批机制**——「等用户确认」交给**汇报协议**（注入用 `followup` 唤醒一轮，模型汇报完即结束该轮，用户回复才继续；不轮询、不心跳）。硬闸只在出现「无人值守批量改动／多人要留痕／要不可抵赖」时才立项。

## Pitfalls

- **「Model-visible ⟺ logged」是单向的**（平台 `AGENTS.md`）：凡进模型必须能从日志重建；**不等于**凡进日志都会进模型。读反了会把整类 log-only 事件当成上下文。
- **命令面输出一律 log-only**：`interaction/commands` 的 `execute()` 写 `command/run`＋`command/done`（后者携带结果类型与原样文本），平台文档明确「两者都不进入模型历史」⇒ **用户敲的命令、命令回执都不在上下文里**，用户不贴、模型不读，模型就一无所知。
- **注入的文本是历史的一部分**：此后每次请求都在上下文（直到 compaction）⇒ 只注指针（≈几十 token），别注正文（KB 级）。
- **`inject` 不是「一定会看到」**：契约明说可能错过已 claim 的批次、cancel/dispose 可能丢弃或停泊 ⇒ 「必须执行」的内容放 `followup`／`steer`，别放 `inject`。
- **框架文本归生产者**：投影层**故意**不加统一外壳（`surface.ts` 注释点名禁止再引入 `<context>`），要加 `<system-reminder>` 之类就自己烘进 `content`。
- **别把「会话」当范围**：run/长跑这类对象的所有者常是**home 级**（跨面共用 `DSH_HOME`），记录里也未必有会话字段；设计"取本对话最近一条"前先确认字段存在，否则语义自相矛盾。
- **★★★ 删掉"零读者的死机制"时，会连它的\*职责\*一起删 —— 而没有任何闸会观测这件事。** 实测案例（2026-10-13）：一个插件原有一个"按会话取视图"的自家缓存，第二轮因**没有平台基座、成了零读者**被标为死机制，第三轮复核**正当删除**。删除没错；错在那个视图**承载的契约**（"注入给模型的清单只含本会话的记录"）随之消失，provider 转头去读**全局数据**，于是**别的会话的 id 进了系统提示** —— 而且**四轮独立复核全没抓到**，因为它们查的是"代码写得对不对"，**删掉的代码不在任何一张清单上**。
  ⇒ **判据**：删一个机制前先问 **"它有没有\*读者之外的职责\*"**（约束、范围、过滤、配额、剪裁）。有 ⇒ 那部分必须先有测试或闸守着，否则**删代码＝删契约**。
  ⇒ **修法不是复活它**：它当初正因为**没有平台基座**才沦为死机制。建到平台自己的 **`ctx.sessionProjections`** 上（`apply(state, event)` 纯同步、忽略的事件返回同一引用，见本技能 §五 的引用件）。
  ⇒ **而且要加一条观测\*发出物\*的闸**：跑真 `Context` ＋ 真 `apply()`，断言**往注入面注册了什么、注入了几条、含不含外来的 id**。**文本扫描类闸永远看不见这一类** —— 它们只证明"源码里有某段字"，证明不了"发出去的东西是对的"。
- **★★★ 会话日志里「段名」和「段正文」不在同一个地方 —— 搜 0 命中时先换搜法，再下结论。** 实测（2026-10-13）差点误判：验证注入落点时搜 `dsh-pixel-loupe:discipline`（**段名**）得 **0 命中**，几乎判成"注册没生效"。真相是**搜错了面**：

  | 面 | 装什么 | 有段名吗 |
  |---|---|---|
  | `system/message` | **渲染后的系统提示正文** | **没有** —— 段与段直接相接 |
  | `runtime-context` 快照（`form:"snapshot"`） | `sections: [{ name, text }, …]` | **有** —— **段名只在这里** |

  ⇒ **判据**：核"某段在不在提示里"要搜**正文**（`system/message`）；核"**哪个段**贡献了它、落在哪个面"要搜**段名**（`runtime-context.sections[]`）。**0 命中首先是关于你这条查询的陈述，不是关于系统的陈述** —— 换一个面、换一个字段名再问一次，再决定要不要下结论。
  ⇒ 配套：`context()` 产出的快照会把**同一次装配的所有段**（含别的插件贡献的 `sandbox:policy`／`approval:policy`／`evolution:memory-snapshot` 等）一起列出来 ⇒ **这是"某个座位到底有没有被占用"最省事的现场证据**，比自己造探针快。
- **别把「平台装了 X」读成「模型能调 X」**：压缩就是现成反例——平台装齐五个压缩包，模型侧零工具；人命令也只有 agent 空闲时可用。答「有没有 X 工具」时给四平面（模型可调／平台自动／人命令／模型无关的确定性裁剪），别只答「有」或「没有」。
- **软闸 ≠ 结构闸，代价要写在交付里**：提示词级「等确认」没有平台留痕（批准只在对话里），也无法阻止模型自行开工；把这条代价与「将来要硬闸的触发条件」一并写明，别把它当等价替代。要硬闸时先看平台既有审批通道（家族 `evolution-approval` 已带 pending 窗口与两个决定），别自造。
- **「有没有插件提供某能力」要按三层问**：模型可调工具（`inputSchema`／`tools.register`）、人命令（`commands.register`）、会话事件钩子（`ctx.on`）。插件清单＝`<DSH_HOME>/profiles/<profile>/package.json` 的 dependencies；只读 README 会把「提到」当成「提供」。两层核查法与 2026-10-11 桌面侧实测读数见 `references/capability-triggers.md` §4/§4.1。
- **别用通用 harness 经验判断"这层能不能碰"**：DSH 是 **all-plugin Cordis** harness——架构本身是一份组合清单（`packages/bundle/base/cordis.patch.yml`，94 个 row；后续 bundle 与用户的 `cordis.patch.yml` 按 row id 覆写，**row 顺序不承载加载语义**）。所以"平台没提供/插件碰不到"这类判断必须在**组合层**复核，而不是靠"插件只能加工具和界面"的直觉。**MCP 也不是另一种做法**：它是 configuration-only bundle（patch 插一行 `dsh-mcp-client`），真正的岔路是**薄形态（只贡献工具）vs 自持形态（参与上下文装配与生命周期）**——只贡献工具够不到装配面。落点、验证顺序与本机读码的坑见 `references/dsh-composition-and-injection-surfaces.md`。
- **不要靠包 README 的措辞下定论**（README 会说效果，不说投影规则）；判定只认 `surface.ts` 的 switch。同理，**改上下文/注入类需求先查活实例**（`cordis_inspect_query` 查 `Service`/`Event`，不需审批），而不是先猜 API 名字——平台自带技能 `cordis-plugin-development` 自己就写着 "the installed Harness is the authority"。
- **★★ 读码纠正要回写"本技能"，不能只改手头那份设计档**（2026-10-12 自查发现的真实缺口）：当一条**平台机制级**的更正出现在项目产物里（设计档/方案/代码注释），而本技能写着**同一个机制的旧说法**时，必须在同一步把技能也改掉。实例：`.volatile()` 的正确读法（`.get()`）当轮只写进了项目的设计档，技能里仍留着"在调用点读 `config.X`"的旧说法 ⇒ 下一个会话按技能做，照样会写出静默 NaN。**判据**：更正涉及的是"平台怎么工作"，还是"这个项目怎么决定"？前者回写技能（跨会话复用），- **插件的 config 旋钮要在调用点读，不许在 `apply` 里解构**（2026-10-12 读码，`cordis-plugin-loader/lib/index.js:380-420`）：schema 标了 `.volatile()` 的字段，运行期改动**不重跑 `apply`**——走的是 `equalExceptVolatile(...)` → `_commitVolatile()` → `volatileEntries(fiber.config)` 取**活 config 上的引用** → `updateVolatile(ref, source)` **原地 set** → emit `loader/volatile-update`。⇒ `const { maxTokens } = config` 这种写法在用户改完旋钮后**永久是旧值**，且不报错。
  ★★ **而且读法不是 `config.timeoutMs`，是 `config.timeoutMs.get()`**（2026-10-12 二次读码纠正，前一轮我写错过并留在了正文）：`.volatile()` 节点在运行时 config 上是**引用对象** `{get(), [write]}`——`schemastery` 的 `Schema.resolve` 对 `meta.volatile` 调 `createVolatile`（`schemastery/lib/index.mjs:265-277`），平台自己的读法就是 `.get()`（`dsh-bash-local/lib/index.js:52-57,90-120`、`dsh-llm-pi-ai/lib/index.js:2548`）。**照"直接读字段"实现会静默拿到一个对象**：比较恒假、算术得 NaN，**一个错都不报**——这是本项目 F11 成因②的真实形态。机械守卫：禁掉 `= config.<x>` 形态、要求 `.get()`。
  三条连带：① `volatile` **可嵌套对象子级**（按"最近的 volatile 祖先"递归）、**不可进数组**；② 非法候选由 `resolveConfig` 拦下后**只 warn 并保留旧引用**（界面不会红）⇒ 要用户可见的拒绝得自己把校验结果渲染出来；③ 需要**响应**变更（如热切换后端）才监听 `loader/volatile-update`（官方范式：`dsh-llm-deepseek:2269`、`dsh-llm-pi-ai:2628`），代价是"0 事件监听"口径 +1。
- **设置界面按槽位声明，不要自造页面**：`settings.plugins.tab`（`dsh-client-ui-settings/lib/types/client/contract/slots.d.ts:78-90`，kind `list`/scope `root`，选项 `id`/`order`/`label`；注释明写"让 inventory 与配置插件协作而不互相依赖"）与 `settings.section`（同文件 :73，一个列表项＝一个设置页）是平台留的协作点；域内范例是 `packages/evolution-settings-ui`（注册 `settings.section` 并声明 `keyed` 子容器）。**旋钮控件必须自绘** ★ 更正：`configForms.get(id)` 返回的是**数据＋写入面**（`{getSnapshot, subscribe, mutate, set, unset}`，`dsh-client-ui-settings/lib/types/client/config-form-types.d.ts:36-74`），**不是组件**；平台也**没有**通用表单渲染器——插件管理器只是把 `form` **传进插槽**，控件由插件自己画。平台的画法用 `dsh-client-ui-primitives` 的 `SettingsFormModel`，而第三方 plain-JS **被明令禁止 import 它** ⇒ **自绘 + 从平台 CSS 复制，只共享 `--dsw-alias-*` token**。动态客户端插件可用的替代支撑是 **`ctx.settingsSchema`**（`rehydrate`/`validate`/`nodeAtPath`），它是被**明确设计成给动态客户端插件用**的 Cordis 实体。
`get(id)` 的 `id` ＝ **profile loader 条目 id（row id），不是包名**（`dsh-settings/lib/index.js:426-442`；`ns: entry.options.id`）。
**`slots.register(options, component)` 是两参**，"单参形式"在字节里不存在（`dsh-client-ui-slots/lib/types/index.d.ts:789,802` 两处重载都要 component；运行时 `register(rawOptions, component)`）。容易误认成单参的是 `slots.inject(key, cb)` 与 `registerFactory`。**注册进别人声明的 children 容器时绝不能自带 `children`**（声明即占用，二次声明抛错，`dsh-client-ui-slots/lib/index.js:191-194`）；`only` 是**渲染方的**（`list.filter(item => item.id === opts.only)`，由容器拥有者传）。
**静默失败（必须进安装自检）**：`Config` 里若**没有** `.volatile()` 字段，该 ns 根本不进 `describe()` ⇒ `whileServed` 永不打开 ⇒ 表现为「**装好了但设置里没有这一页**」，**且不报错**。
**两处易错**：被拒的写**不会 reject**（客户端 scope 消化它并恢复快照）⇒ 判据是"下一份快照是否持有该值"，不是调用成功；座位要用 `ctx.get` 懒探 + `ctx.inject([...], cb)` 订阅到达，否则"本部署没有这个座位"会永久画在那里。
**口径限定**：客户端 tab **不引入 Cordis 事件监听**，但确实引入平台服务内部订阅（`slots.inject` 的声明订阅 + mirror）⇒ "0 事件监听"在 Cordis 事件意义上仍成立，写的时候要限定，别被读成"连槽声明订阅都没有"。
- **位图证据必须把归档指针写进占位符**：`dsh-compaction-image-offload` 只会永久丢弃**最老**的图片（`offloadOldestImages` 扫 `user/message` 与 `tool/result`，跳过 `assistant`，写 `image/offload`），被丢的图**平台上没有回程路径**——只知道"曾经有过一张图"，不知道它在哪。所以任何"视觉记忆"类插件，价值不在更好的视力，而在给模型一条**回看证据**的路；代价是注入的指针此后常驻上下文，必须控制条数。**先问是不是根本不需要这一轮**：当任务对象有结构化通道（DOM／无障碍树／CSS 计算值、OOXML、单元格坐标），位图是**更差的代理**，读它等于用推断代替精确值；位图只该用在"模型提出的问题在结构化面上无法表达"时（渲染观感、画布／WebGL、遮挡与层级、跨图对比、**PPT 这类绝对定位版式**）。
- **视觉记忆该做成"接收"层，不是"采集"层**：给模型做图片存档/回看，最小组件是 **ingest(任意图路径) → 稳定短 ID → 按 ID+区域查看（原图／裁剪放大／像素采样）→ 结果经 `tool/result` 回到模型**，**不自己截图、不认识场景**。截图与渲染早已被工具覆盖（平台 Cua 线、officecli、浏览器插件），再包一层采集＝重复开发；正因为不采集，它才能对浏览器／前端／Office 一视同仁。需要场景输入的那部分应是**投喂点**，不是一个场景一套工具。唯一的地址要求是**图片 ID 必须与"第几轮"或"第几个 moment"解耦**（内容哈希即可，天然去重），因为 DSH 没有 turn 语义。**唯一真正要定的岔路不是"MCP 还是插件"**：在 DSH 里 MCP 本身就是 configuration-only bundle，是插件的最薄形态；真正要定的是**薄形态（只贡献工具）vs 自持形态（参与上下文装配与生命周期）**——要"管理"（常驻索引、offload 时留回程指针、逐会话状态）就够不到薄形态，但它仍可**复用既有服务**（附件/存储已是被 inject 的服务），不必新造容器。
- **同属一个"场景"名的文件格式，适配度可能相反**：Office 里 Word/Excel 是**结构化通道更好**（python-docx 的 run 属性、单元格坐标给的是精确值，位图只会把它降级成推断），而 PPT 是**位图更好**——形状绝对定位，溢出／重叠／跑出画布在 `view text` 里根本不出现，渲染目检是唯一真值来源。所以按"office 场景"统一判断必错，**要按格式分**：判据是该格式的结构化通道对**你这个问题**是否无损。附带一条：`--grid` 接触表只给跨页概览，缩略图看不见版式缺陷，两者互补不互替。这条判据在立项前用，不要等实现完再发现选错了通道。

## Verification

- **静态**：能指出事件类型 → `SURFACE_EVENT_TYPES`／`deriveEventMessage` 的判定路径（给出文件:行）；插件自有事件则给出有无 `@messageProjection` 的 grep 结果。
- **绑定在跑字节**：对 `app.asar` grep 到同一实现标记（本例：`deriveEventMessage`\*\(57\)、`command/done`\*\(89\)、`log-only record`\*\(6\)）。
- **动态**：注入类改动要有夹具断言「原语被调用恰一次 + 文本逐字」，并在真机上用轨迹面／`session-query` 核对**模型下一轮确实看到了那段**；反向用例（开关关／无对象可注入）必须证明**没有**注入。
- **可调用面**（「模型能不能自己调 X」）：指令工具名在该会话系统提示的工具清单里出现，且插件包 `grep 'defineTool|registerTool'` 命中；只命中插件命令不算。反例：压缩面工具注册 0 命中 ⇒ 结论应为「无模型可调工具」。
- 细节锚点与本轮读数见 `references/source-anchors.md`（投影/命令/四原语/压缩面 + app.asar 与宿主包读取法）；可调用面判定法与四平面表见 `references/capability-triggers.md`。
