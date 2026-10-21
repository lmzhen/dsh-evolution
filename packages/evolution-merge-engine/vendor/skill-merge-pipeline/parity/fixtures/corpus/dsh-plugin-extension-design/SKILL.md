---
name: dsh-plugin-extension-design
description: Design DSH plugin seams that reuse host services.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [DSH, Plugin, Architecture, Extensibility]
    related_skills: [dsh-plugin-compatibility, dsh-context-visibility, codebase-inventory-survey]
---

# DSH 插件扩展点设计（设计期）

给 DSH 插件设计「什么归我、什么归宿主、扩展点长什么样」。这是**设计期**审计：在写第一行代码之前，把每个实体（代码、状态、清单、可见性、版本）指派给一个已有所有者，并证明这个插件比平台已有机制多提供了什么。它不判版本兼容（那归 `dsh-plugin-compatibility`），不判模型可见性怎么走（那归 `dsh-context-visibility`）。

## When to Use

- 「我要把它做成一个 X 系统／框架／管理器」——尤其当 X 已经是一个平台概念时（技能、插件、文档、工具集）。
- 「支持长期保存 + 随用随删」「支持多版本」「支持按场景自由选择子集」——这类需求同时出现时。
- 「这个接口是不是该做成 MCP」或「要不要自己存一份清单」。
- 给一个已经能用的插件加**新扩展点**（新工具、新技能、新后端）之前。

## Prerequisites

- 平台源码树：读接口与所有权，不读 README 的架构段。
- 宿主上**真正在跑**的那份实现：判定「平台已有什么」时以它为准。
- 最宽松的那一档配置（本机＝Creator 模式）到底给模型哪些工具——这条决定「模型能不能自己选」。

## How to Run

按顺序答。**先答第 1 条，答错它后面全废**：

1. **先分清「架构模式」与「实现外壳」。** 参考物是论文仓／实验仓时尤其如此：目录结构是被实验需求塑造的，架构是那份「core + 可扩展 + 子集选择」的骨架。两者分开审，答案常常相反（骨架成立、管理器不成立，或者反过来）。
2. **逐实体问：有几个消费者必须对同一事实达成一致？** 必须一致（多消费者读同一事实）⇒ 唯一真品，进 core，配机械闸（错误码表、地址派生、坐标系、准入映射）。只有一个消费者 ⇒ 共享模块即可，不做注册表、不做协议。
3. **逐实体问：这件事宿主是不是已经有所有者？** 一次问清五面——代码、状态、清单、可见性、版本。任一面宿主已有 ⇒ 用它的面，你只写自己那一层（加载与校验）。
4. **要「模型可调」的能力，先查宿主有没有现成的角色面**（例：运行期工具可见性＝`tools.restrict` 的作用域 restriction 面；文档生命周期＝技能层）。有面而没有手 ⇒ **先分清是「宿主没有那只手」还是「那只手只能在别的时刻握」**。本会话实测的陷阱：我曾建议「写一个插件工具去调 `tools.restrict`」——但工具体里的 `exec.agent` 是 bare Agent（公开 `Agent` 接口只有 `id`，`packages/core/agent/src/types.ts:15-18`），而 `restrict()` 无作用域直接抛（`packages/core/tools/src/index.ts:1097-1101`）。平台自己的做法是**在 per-agent 资源生命周期里造作用域**（`createScope(ctx, agent)`，`packages/core/scope/src/index.ts:137`；生产样例 `packages/experimental/browser-use-runtime/src/mcp.ts:117`），或在**内建的创建窗**落地（子 agent 的 `toolFilter`，`packages/subagent/subagent/src/child-agent.ts:218`）。⇒ **可见性归谁，取决于指令由谁握**：工具体里那只是**调用者自己的**作用域 ⇒ **子 agent 可以自选自己的可见子集**；
   父级"能否 deny 子作用域里的工具"只在**部署期两臂**那条路上才相关（父级此时还没见过子级自注册的名字），**不是关键问题**。
   两条随之而来的纪律：① 自选必须落在**回合边界**并保持稳定（一次选择＝系统提示前缀归一化一次）；② **别让选择器被自己的 restriction 吃掉**
   —— restriction 只过滤继承面，所以要么把选择器注册在作用域内（scope-local 不受过滤），要么在 allow 里显式带它（防"选窄之后自锁"）。
5. **扩展点的形态由「它是什么」决定：** 数据／算子型（进程内纯函数）＝文件系统 + 契约校验 + 注册；作用域型＝宿主的作用域 API；服务型（跨宿主、跨语言、要隔离）＝才轮到 MCP。**MCP 是边缘 provider 的形态，不是框架的身份。**
6. **查依赖方向**：core 绝不 import 具体扩展，扩展只依赖 core。这条坏了，架子会烂在第二个扩展上。
7. **只留下「需要用户拍的结构决定」**（通常一条），其余按最小实现最广适配自行取舍，不逐项请示。

## Quick Reference — 实体归属表（0.2.0-rc.2 实测）

| 实体 | 所有者 | 证据 |
|---|---|---|
| 代码（新工具／算子） | 文件系统（可选 git） | 约定目录 + manifest；插件只加载与校验 |
| 版本历史（**本地惯例，非平台契约**） | **第三方 evolution 层**在用户技能根下自建的账 | `$DSH_HOME/skills/.history/skills/<name>/index.json`（`{v,at,action,hash,chars,beforeHash?,path?}`）＋ `.history/blobs/<sha256>`（实测 1158 个）＋ `.usage.json` ＋ `.archive/`；★ 这些名字在**平台仓 `packages/`、`scripts/` 里零命中**——它们是**本机装的插件（`@lmzhen/dsh-evolution-*`）的私有约定**，不是 DSH 平台承诺。⇒ 引用前先问：这是平台契约，还是本机某个插件的行为？ |
| 技能撰写／管理 | evolution 层的 `skill_manage` | 动作＝`create/edit/update/patch/delete/write_file/remove_file/restructure/pin/unpin/review/list`；`.usage.json` 记 `state/pinned/archived_at/use_count/patch_count` |
| 删除 | **归档，不是物理删** | `delete` 把目录移进 `$DSH_HOME/skills/.archive/<name>/`，`.usage.json` 置 `state:"archived"`＋`archived_at`；**没有安装命令** ⇒ 「随用随删」＝直接 `fs` 删目录 |
| 修复／恢复 | 内容寻址的对象库 | 任一次变更的正文都在 `.history/blobs/<sha256>`，`.mutations.json` 给出 before/after 哈希 ⇒ 可按需恢复任意版本 |
| 清单（有哪些） | 从目录现算，不落盘 | 落盘＝第二真相源（本仓曾因缓存 id 列表随宿主重启变化，把 `viewFor` 整个删掉） |
| 工具可见性 | 宿主作用域 restriction；申请者只需**握有那个作用域**，而在工具体里握有的就是**调用者自己的** | `ToolRuntime.restrict({allow\|deny})`（`packages/core/tools/src/index.ts:1097`，无 scoped ctx 直接抛；**过滤的是继承面，作用域自身注册不受影响** `:1194-1208`）。`agent.ctx` **存在且是 agent-local**：`packages/core/agent/src/runtime-types.ts:174` `readonly ctx: Context`（原话：agent-scoped，disposal 时回卷、之后拒绝注册）；作用域键就是 agent id —— `ctx.agents.resolve(sessionId) → this.get(sessionId)`（`core/agent/src/index.ts:263`）与 `typert.contexts.registerHost('agent', … resolve: sessionId => this.get(sessionId)?.ctx)`（`:268`），与插件侧 `sessionIdOf(exec.agent) = agent.id`（`lib/session-rows.js:88-91`）**同一个键**。`[已闭环复核]`：源码树里那两个文件不在部分检出内，但**已安装的编译产物**给了同一结论 —— `dsh-tools/lib/index.js:1201` `agent: exec.agent`（工具执行体真的拿到 live agent）、`:1402` `registry.schemas(exec.agent)`（平台自己把它当 agent 用）、`dsh-agent-loop/lib/index.js:1889` `setup?.(prepared.agent.ctx, prepared.agent)`（**运行时 agent 确实带 `.ctx`**）、`dsh-tools/lib/index.js:2895-2910` 的 `restrict` 实现（`scopeOf(this.ctx)`／空 filter 抛／**`run_code` 一律拒**／名字须在 `restrictableNames`／经 `layers.effect` 返回 disposer）。⇒ 「工具体里 `exec.agent.ctx.tools` 可用」**有据**，不再是转述。**形态结论（本轮拍定）**：作用域是在**执行时**由 `scopeOf(this.ctx)` 取的 ⇒ **一个全局注册的工具，父与子共用同一个，谁在调就作用于谁** —— 不需要 `createScope`、不需要父级代选、不需要按角色各做一个 |
| 包／插件生命周期 | 宿主 plugin manager | 工具名 `plugin_manager`（`packages/boot/plugin-manager/src/tools.ts:20`），每次动作需 `danger-full-access` 或审批 |
| 技能发现 | 技能层的文件系统 provider | `packages/skill/skill-filesystem/src/index.ts:676-729`（`SKILL.md`），变更发 `skills/change` |
| 技能支持文件 | 技能包本身 | 正文旁 `references/` `scripts/` `templates/` `assets/`（`SUPPORT_DIRS`，由 evolution 层的 `evolution-core` 定义；平台仓里 grep 不到属正常） |
| 扩展点的身份 | 派生哈希 + 版本号进返回值 | 平台硬规矩 model-visible ⟺ logged：新可见面必须能从日志重建 |
| MCP | 边缘 provider（跨进程／跨语言／要隔离时） | MCP client 是配置行（`dsh-mcp-client`）；一个 server 的工具单独注册，故障互相隔离 |
| **技能层能承载什么** | 技能层＝文档／指令载体，**不是工具注册** | 模型侧的 `skill` 工具只**返回文本**（`packages/skill/tool-skill/src/index.ts:122-127,198`：`render: (_a,v) => [{type:'text', text: renderSkillContent(v)}]`，无 execute 步骤）⇒ 支持目录（`scripts/` 等）是**素材**，不是可执行技能。**别把 VISTA 的"skill（可执行工具集）"与 DSH 的"skill（SKILL.md）"当同一物**——这条同名异实会让"算子该不该做成技能"整题问错 |
| 工具集的**变化**本身 | 前缀缓存（平台账） | 注册／注销／限制变化都会 `emit(tools/change)`（`packages/core/tools/src/index.ts:201,208`，**UNFILTERED**），任何变化＝系统提示前缀归一化一次 ⇒ **扩展现能不能做成"会增减的工具"** |

## Pitfalls

- **问错层级是最贵的错。** 用户问「架构形态对不对」，你去审「它是不是一个管理器」⇒ 证据再对也是答非所问。落地法：动手查之前先用一句话写下你的判题，跟用户原话对一遍。
- **被参考物的目录结构牵着走。** 论文仓／实验仓的 `benchmarks/`、`profiles.py` 是实验外壳；按「层 + 子集选择」这个骨架看，别按目录看。
- **不要用「宿主已有那个生命周期」去否定参考物的架构。** 这两句可以同时成立：骨架照搬，管理器不必自建。
- **★★ 判「平台能不能做 X」之前，先跑一遍全量接口面，再下判词。** 本会话实测翻车：我据**一条子路径的类型面**（`@deepseek-ai/dsh-agent/types` 的 `Agent` 只有 `id`）判「插件拿不到调用者作用域」，并对用户说了这条结论；后来普查平台自动生成的接口目录（`packages/extensions/tool-cordis/src/api-catalog.ts`：91 服务／503 公开方法／81 事件）才发现在**包根的类型增补**里 `Agent` 另有 `readonly ctx: Context`。三条判据：①引用要走**包根**的面，不是某个子路径的再导出；②「做不到」这类否定必须跑完全量清单再写；③目录（catalog／README）只用于**发现候选**，结论必须回源码读实现——而**本机平台树可能是部分检出**（实测：`core/agent/src` 只有 9 个文件，别人引的 `tool-calls.ts`／`agent.ts` 不存在）⇒ 引用转述链时标 `[未逐行复核]`，并把「我独立复核的是哪两头」写出来。 进程内纯函数（图像算子、统计、格式转换）走 MCP 只是多一层进程边界与序列化；MCP 的正当理由是「要在别的宿主／语言里跑」。
- **别把「本机某个插件的私有账」当成平台契约。** 本会话实测翻车：`.history/blobs`、`.usage.json`、`.archive/` 被当成技能层的版本账与归档契约，实际上**平台仓里零命中**，它们是用户根下某个 evolution 插件的实现细节；平台的技能层只有 `SkillDefinition.content`（Markdown 正文）。**判据：宣称「平台已有 X」之前，先在平台仓里 grep 到它**；只在本机看到过它 ⇒ 那是本机环境事实，不是可依赖的契约。
- **别重建平台已有的记忆／文档／清单。** 动手前先问：文件系统能不能存？git 能不能留版本？技能层能不能带支持文件？三者皆能 ⇒ 你要写的只有加载、校验与那份契约。
- **给还没有第二个消费者的东西提前做注册表／协议**，代价是每个新扩展都要改三处。等第二个真实扩展出现再抽象。
- **写盘代理不要自动提交、不要替用户建仓。** 先给可逆路径（备份／分支／未提交），再给动作。
- **源码树读不动时，去读宿主上**已安装的编译产物**。** 部分检出／asar 打包会让人误判"平台没有这个"：先 `rg -l <符号>` 或按**文件名**在宿主 `node_modules/@deepseek-ai/**`（含 `.asar.unpacked` 与 npm 全局）里找 **`.js` 而不只是 `.ts`** —— 编译产物**剥掉了类型**，实现反而更直白。本会话靠它闭环了三处关键事实（`agent.ctx` 可否到达、`restrict` 的确切行为、工具执行体拿到的是 live agent），并在技能库里把 `[未逐行复核]` 改成 `[已闭环复核]`。**判据**：源码树里 grep 不到 ≠ 平台没有；换一棵树（检出／编译／已安装）再判，并把读的是哪一棵写进结论。
- **调用平台内建校验时，把它抛的文案当公共接口对待。** 例：`tools.restrict` 会替使用者报三类错 —— 无作用域（`requires a scoped context (agent.ctx)`）、空 filter（`is a no-op`）、保留名（`cannot name reserved PTC mode presentation transport "run_code"`），未知名还会把**已知全局名集合**一并列出来。自己不要另造同义错误文案；先试调、把平台的拒答当契约，能少写一套平行校验。
- **审批墙是前置事实，不是事故。** 凡「装包／改 profile／执行生成代码」的路径，先问它要不要审批、是否只在最宽松模式免批；不可逆动作要有回退路径。
- **改一个子系统的"表现"时，要连它的**执行面**一起改。** 加一个工具（或一个模块）会撞到的不是代码，而是一组互相交叉的校验面：装配点（注册 ＋ deps 注入）、出参**方言**（平台只收一个子集，写错＝整个插件不激活）、**错误码表**、契约测试的**覆盖面守卫**（"按磁盘推导、防静默漏检"）。**判据**：动手前先 grep 出全部钉住这一次改动的断言与闸（"5 个工具"这类数字最容易漏），改完让它们显式报红一次再放绿 —— 清单见 references/adding-a-tool-checklist.md。
- **`inject` 是硬闸，诊断量走可选访问。** `inject` 里列的服务缺席 ⇒ 插件**不加载**（cordis 的 required inject 无超时）⇒ 为了让一个**可选的诊断量**可用而把它加进 `inject`，等于把整个插件绑死在那个部署上。例：为了读"会话面"的 `contentGeneration` 而注入 `sessions`，会让没有该服务的部署**整个插件不加载**。正解＝装配点用 `ctx.get('<service>')?.<member>?.…` **逐层可选**，任一层缺席即 `undefined`，并在消费侧把它当 `unknown`（fail-open）。平台自己的 `ctx.attachments?.imageLimits` 就是这个形态。
- **公开面只有计数器时，就用计数器当"变了没有"的信号。** `SessionSurface` 只导出 `{nodes, replaceGeneration, contentGeneration}` —— **`projectedMessages` 不在公开面上** ⇒ 想查"某个块是不是已被投影替换"（如 `image/offload` 的占位符）就得自己去读会话日志并折叠，那是与平台重复的第二套机制。替代：平台的每次 `project` 都会让 `contentGeneration` 前进（`replace` 也前进，`append` 不前进）⇒ 把它当作**"面变没变"的粗粒度信号**：不同即重做，相同就用缓存结论。**代价是它会被无关变更推动**（偏保守、可能多做一次），但只要"重做"永远安全，这就是对的方向。

### 收窄参数的作用域比你想象的大：`allow` 是**整张面**的白名单（实测踩过，已发布缺陷）

- 症状：一个"只收窄自己命名空间"的选择器，发 `tools.restrict({ allow: [自己的名字…] })` ⇒ **调用者当场丢掉 preset 给的其它工具**（read／write／bash／MCP 全部变 `unknown tool`）。
- 机制：`allow` 的语义是 **keep only**，作用在**继承面（全局层＋祖先层）整张表**上，不是"与你给的名字取交集"；`deny` 才是外科式的（只摘点名的）。平台文档原话见 `Restrict **global** tools … allow (keep only)`；凭名字猜语义会猜反。
- **最快的判据是平台自带的测试**（不是注释）：`packages/core/tools/tests/scoped.spec.ts` 里正面断言 `restrict({ allow: ['read'] })` ⇒ `bash` 变 `Error: unknown tool "bash"`，而作用域内自注册的 `capture` **仍在**。凡"过滤参数"先找平台自己的测试，看它断言了什么被去掉。
- 修法与守门断言：改发 `deny`＝**自己命名空间内的补集**；再把 deny 与平台真值（`tools.schemas(agent)` 的当前名字）取交，避免未注册名让 `restrict` 抛 unknown。测试替身要**放一个别人的工具进去**，并断言"别人的工具一个都不许进 deny"——否则替身太干净，这类整面误伤永远不会红。

### 工具可见性的两半：注册可按 agent，收窄只认全局（0.2.0-rc.2 实测）

- `tools.register(definition)` 的文档原话：*Register globally or in the calling agent scope. Scoped tools shadow globals; duplicates within one layer and the reserved run_code name fail.* ⇒ **运行期造出来的工具可以按 agent 注册**（同名遮蔽全局），并返回精确的 disposer。
- `tools.restrict(filter)` 的文档原话：*Restrict **global** tools for the calling agent scope. … scope-local names … fail. Restrictions intersect; **scoped registrations remain visible**.* ⇒ **收窄是一张全局工具掩码，够不到 agent 作用域里的注册**。
- ⇒ 由此推出一条设计级取舍：要让模型"造工具"，注册层只能二选一 —— **全局注册**（可被收窄治理，但对所有 agent 可见）或 **按 agent 注册**（隔离正确，但模型的"多选"管不到它）。平台不提供第三条路；把这一点写进方案，别指望后面补一个开关。
- `run_code` 在两处都是保留名：注册不能用它（`tool name "run_code" is reserved …`）、收窄名单里也不许出现它。

## 把文案搬进字典 ≠ 改个名字：按"哪一层握着翻译器"分工（2026-08-13 实测）

- **症状**：为了"用户面文案必须来自字典"，直接把 `t('key')` 写进产生文案的那一层 —— 而那一层（控制器／状态机／纯逻辑）**根本没有 `t`**：它是模块作用域函数，翻译器只在组件渲染时才注入。结果是整块功能抛 `ReferenceError`，五条测试同时红。
- **机制**：翻译器是**渲染边界**才有的依赖（组件从 props／apply 作用域拿到 `t`），逻辑层拿不到也不该拿。
- **正确分工**：*模型层存**键**，边界层做**翻译***——`failed = { kind: 'transport', key: 'save.failedTransport' }`，渲染处 `t(failed.key)`。同理，kit 里的展示型函数要么**收 `t` 作为参数**（与"字段 spec 都带 `t`"的既有约定一致），要么由调用方在渲染时翻译；**不要让展示函数去闭包捕获一个它拿不到的 `t`**。
- **判据**：逻辑层的返回值里**不应出现面向用户的句子**（只有键、码、枚举）；渲染层**不应出现自然语言字面量**。两条都能机械检查：前者查"逻辑层字符串里有没有成句的中文/英文"，后者就是命名闸。

## Pluggable capabilities: declare as frozen data, bind the implementation separately (2026-10-13)

- **Split the declaration from the implementation.** The declaration is **serializable data** (`{id, api_version, summary, params, produces, effect, numeric}`), carries **no function reference**, and is returned **frozen**; the implementation is bound in a registry keyed by `id@api_version`. Why: only data can be printed, diffed, put in a return value or generate another artifact (an input schema, a description, a digest) — and "which implementation produced this reading" must be answerable from the value alone.
- **Validate strictly and loudly**: reject **unknown fields** (a declaration is a contract; every extra field is one more truth nobody checks), reject duplicate parameter names, require `enum` values to match the declared `type`, reject `min > max`, and keep enumerated vocabularies **closed** (a token outside the list is free text, not a declaration).
- **Registry guards worth copying** (they mirror what the host does for its own registries): refuse a declaration that **is not frozen** (otherwise a caller smuggles in an unvalidated object and the contract claim breaks), refuse a non-function implementation, and refuse a **duplicate key** (a duplicate means someone believes they changed the implementation when they did not). Keep enumeration order = registration order, so generated artifacts (enums, descriptions) do not jitter between runs.
- **Payoff**: with the contract layer in a directory that is *forbidden to import anything*, the whole layer becomes directly unit-testable with no doubles — contract errors go red before any consumer runs.

## A contractually import-free layer decides where shared data lives (2026-10-13)

- Symptom: a new `builtin.js` in the *pure* directory imported its sibling (`./spec.js`) for the validator ⇒ the repo's own absolute rule ("this directory imports nothing, ever") went red on the next check.
- Fix (and the only compliant shape): move the shared declarations **into the module that already owns the validator** and export them from there. Do not split "data" and "validation" across two files inside an import-free directory — the constraint is directory-wide, not per-file.
- Generalization: when a layer is declared import-free, every shared constant, default table or built-in declaration must live **inside one of that layer's own modules**; a new sibling file that imports anything is a violation by construction. Read the rule before choosing the file layout — the rule is stated in the checker, and it is cheaper to obey it than to argue with it.
- Second-order effect worth knowing: consumers in other layers (assembly, test doubles, tests that build their own dependency object) should all reference the **same exported object** rather than re-declaring it; duplicated declarations drift silently, and no test notices.

## A self-describing field whose reference does not exist yet must be deferred — on the record (2026-10-13)

- Situation: a return value is supposed to carry an implementation digest ("which build of this operator produced this reading"). For built-in operators the implementation is **spread across several modules**, so there is no single addressable source text to digest.
- The wrong move is to synthesize one anyway: a digest over *something adjacent* produces a precisely formatted value that cannot answer the question it exists for — worse than an absent field, because readers trust it.
- The right move: **defer the field, and write down where it becomes meaningful** (here: once operators exist as loaded source files, each with one addressable text). Record it as a deliberate deferral with its reason, in the same ledger as the delivered items — so a later reader can tell "not done yet, on purpose" apart from "forgotten".
- Companion: when the referent *does* exist, put the identity in the value **and** the key and assert their sameness in a test — two places deriving the same identity is exactly where silent divergence starts.

## Name a result field after what it is — a `code` slot becomes an error code downstream (2026-10-13)

- Symptom: a comparability verdict (`channel-mismatch`) was returned in a field named `code`. Semantically it is an **alignment value**, not an error: it means "these two cannot be compared", which the caller returns as `alignment`. But the repo's error-code gate scans every `code:` position and demanded the literal be registered in the error-code table — a false obligation created purely by the field name.
- Fix: rename the field to what it is (`alignment`). The gate noise disappears and the semantics stop lying; the caller composes `alignment: verdict.alignment`.
- Generalization: a field name is a **contract with the whole toolchain** — validators, tables, docs and gate rules key off names like `code`, `id`, `digest`, `version`. Putting a value in a slot whose name promises something else creates obligations (and false failures) far from the point of origin. Fix the name, not the checker.

## Split the shaping half from the calling half — and reuse vocabulary before coining it (2026-10-13)

- **Rule 1 (testability)**: a capability that both *shapes a declaration* and *calls the host* should be built as two pieces: a **pure** piece that produces the exact data the host will consume (tool name, description, parameter map, output schema/render), and a thin piece that performs the call and the post-call check. Reason: the shaping piece decides **what the model actually sees**, yet if it lives inside the calling function it can never be covered by fast unit tests — and it is where the interesting defects live (wrong wrapper shape, missing `render`, over-long name).
- **Rule 2 (vocabulary)**: before inventing a new identifier (error code, status literal, field name), search the existing vocabulary for one with the same meaning. Measured: a freshly coined `op_not_recomputable_scope` immediately triggered the repo's error-code ledger gate (every emitted code must be registered) *and* risked confusion with an existing **success-branch field** of similar name. Reusing the already-registered `no_session_scope` satisfied the gate, kept the vocabulary small, and read better. Coining an identifier is never free: it creates registration duties and collision risk at every downstream consumer.

## LLM 任务的载体选择：先问"证据筛选由谁做"（2026-10-16 实测）

给插件里的一段判断选载体时，真正的分岔**不是**"子智能体 vs 单次结构化调用"，而是**证据筛选归谁**：

- **单次结构化调用**擅长可比、可记录、可跨版本对照的判断，但它**不会自己找证据** —— 你得先把决定性那几段挑出来；
- **子智能体**擅长**导航**（自己决定读哪段、要不要翻 `references/`、逐条引 `path:line`），代价是 token/延迟不可预测、
  探索路径每次不同 ⇒ 同一输入在不同轮次可能给出不同判决，台账失去可比性。

实测（判一对技能是否该合并，44 个技能的库）：整篇正文中位 **26.6k tokens/对** → 头部抽取（description ＋ 引言段 ＋
"何时用" ＋ 边界）压到 **9%**（约 1k tokens/对）；头部与整篇的**排序相关性 0.668**，而**仅 description ≈ 0（-0.022）**。
⇒ 可用的形制是**三级级联 + 三选项 schema**（`1 需合并 / 0 信息不足 / -1 不需合并`）：L0 只喂名字+描述+各级分数
（早期退出；`1` 与 `0` 都上送，因为 L0 的 `1` 不足以定案）→ L1 喂头部抽取（**只有 `0` 上送**）→ L2 喂正文关键段或子智能体取证。
三级输出**同一 schema**，每条记 `level` 与 `trail` —— 否则无法区分"判决变化来自语料"还是"来自采样/探索路径"。
⇒ 周期性插件里的分配：**主力单次调用**（成本可预测、台账可比），**子智能体只做少数升级**（证据被截断、低置信、两向矛盾）。

## Verification

- 每条「归谁」都指到 `文件:行` 或实测读数；不写「平台应该没有」这类无证据的否定。
- 每个实体在归属表里有唯一所有者，且**没有两个所有者**（重复即缺陷）。
- 扩展点的外延价值单独说过一次：**没有新扩展点时，这个插件本身还值不值？** 说得出才算立项。
- 有边界句：明确列出「不做什么」，并说明每条不做会给谁省下什么。

## References

- [references/host-entity-ownership.md](references/host-entity-ownership.md) — 本轮实测的归属表细目（各面的入口文件、Creator 模式的三个工具名与审批要求、技能对象库的落盘形状、以及「平台已有 ≠ 模型可调」的判决样例）。
- [references/skill-artifact-lifecycle.md](references/skill-artifact-lifecycle.md) — 「新写的技能放哪／删是归档还是直删／归档能不能恢复／同一技能多版本路径怎么管」四问的实测记录（三个记账面、版本账的形状、以及"临时件"要自己清这条坑）
- [references/adding-a-tool-checklist.md](references/adding-a-tool-checklist.md) — **加一个新工具要过的那几关**：装配面（注册／两个 deps 装配点）、出参方言（`oneOf[...].required` 不被支持 ⇒ 逐属性 `required: true`）、错误码（snake_case ＋ `PASSTHROUGH_CODES` ＋ 连字符名对闸不可见）、契约测试的覆盖守卫、以及字符串转义类陷阱。
- [references/repo-dependency-boundary.md](references/repo-dependency-boundary.md) — 本仓的**解析边界**（裸导入只认 `node_modules/@deepseek-ai/` 里那 6 个包 ⇒ 未声明的平台包在测试里 `ERR_MODULE_NOT_FOUND`）＋「按 agent 分桶」的工具怎么用**假作用域**单测（含 disposer 序与 `makeDeps(...).deps` 两个易错点）。。
