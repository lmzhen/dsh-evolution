{
  "level": "L1",
  "skill_a": {
    "id": "dsh-plugin-discovery",
    "description": "Rank DSH plugins from the live market catalog and GitHub.",
    "head": "Rank DSH plugins from the live market catalog and GitHub.\n\n# DSH Plugin Discovery & Ranking\n\nUse when the user wants to find, compare, or rank DSH community plugins by\ntopic, category, stars, downloads, or maintenance signals.\n\n# does not expose ./lib/* -> ERR_PACKAGE_PATH_NOT_EXPORTED. Import by file URL.\n### `gh api --jq` 的准确边界（比\"\\(...) 会被 mangled\"更精确）"
  },
  "skill_b": {
    "id": "dsh-plugin-extension-design",
    "description": "Design DSH plugin seams that reuse host services.",
    "head": "Design DSH plugin seams that reuse host services.\n\n# DSH 插件扩展点设计（设计期）\n\n给 DSH 插件设计「什么归我、什么归宿主、扩展点长什么样」。这是**设计期**审计：在写第一行代码之前，把每个实体（代码、状态、清单、可见性、版本）指派给一个已有所有者，并证明这个插件比平台已有机制多提供了什么。它不判版本兼容（那归 `dsh-plugin-compatibility`），不判模型可见性怎么走（那归 `dsh-context-visibility`）。\n\n- 「我要把它做成一个 X 系统／框架／管理器」——尤其当 X 已经是一个平台概念时（技能、插件、文档、工具集）。\n- 「支持长期保存 + 随用随删」「支持多版本」「支持按场景自由选择子集」——这类需求同时出现时。\n- 「这个接口是不是该做成 MCP」或「要不要自己存一份清单」。\n- 给一个已经能用的插件加**新扩展点**（新工具、新技能、新后端）之前。\n\n- 平台源码树：读接口与所有权，不读 README 的架构段。\n- 宿主上**真正在跑**的那份实现：判定「平台已有什么」时以它为准。\n- 最宽松的那一档配置（本机＝Creator 模式）到底给模型哪些工具——这条决定「模型能不能自己选」。\n\n按顺序答。**先答第 1 条，答错它后面全废**：\n\n1. **先分清「架构模式」与「实现外壳」。** 参考物是论文仓／实验仓时尤其如此：目录结构是被实验需求塑造的，架构是那份「core + 可扩展 + 子集选择」的骨架。两者分开审，答案常常相反（骨架成立、管理器不成立，或者反过来）。\n2. **逐实体问：有几个消费者必须对同一事实达成一致？** 必须一致（多消费者读同一事实）⇒ 唯一真品，进 core，配机械闸（错误码表、地址派生、坐标系、准入映射）。只有一个消费者 ⇒ 共享模块即可，不做注册表、不做协议。\n3. **逐实体问：这件事宿主是不是已经有所有者？** 一次问清五面——代码、状态、清单、可见性、版本。任一面宿主已有 ⇒ 用它的面，你只写自己那一层（加载与校验）。\n4. **要「模型可调」的能力，先查宿主有没有现成的角色面**（例：运行期工具可见性＝`tools.restrict` 的作用域 restriction 面；文档生命周期＝技能层）。有面而没有手 ⇒ **先分清是「宿主没有那只手」还是「那只手只能在别的时刻握」**。本会话实测的陷阱：我曾建议「写一个插件工具去调 `tools.restrict`」——但工具体里的 `exec.agent` 是 bare Agent（公开 `Agent` 接口只有 `id`，`packages/core/agent/src/types.ts:15-18`），而 `restrict()` 无作用域直接抛（`packages/core/tools/src/index.ts:1097-1101`）。平台自己的做法是**在 per-agent 资源生命周期里造作用域**（`createScope(ctx, agent)`，`packages/core/scope/src/index.ts:137`；生产样例 `packages/experimental/browser-use-runtime/src/mcp.ts:117`），或在**内建的创建窗**落地（子 agent 的 `toolFilter`，`packages/subagent/subagent/src/child-agent.ts:218`）。⇒ **可见性归谁，取决于指令由谁握**：工具体里那只是**调用者自己的**作用域 ⇒ **子 agent 可以自选自己的可见子集**；\n   父级\"能否 deny 子作用域里的工具\"只在**部署期两臂**那条路上才相关（父级此时还没见过子级自注册的名字），**不是关键问题**。\n   两条随之而来的纪律：① 自选必须落在**回合边界**并保持稳定（一次选择＝系统提示前缀归一化一次）；② **别让选择器被自己的 restriction 吃掉**\n   —— restriction 只过滤继承面，所以要么把选择器注册在作用域内（scope-local 不受过滤），要么在 allow 里显式带它（防\"选窄之后自锁\"）。\n5. **扩展点的形态由「它是什么」决定：** 数据／算子型（进程内纯函数）＝文件系统 + 契约校验 + 注册；作用域型＝宿主的作用域 API；服务型（跨宿主、跨语言、要隔离）＝才轮到 MCP。**MCP 是边缘 provider 的形态，不是框架的身份。**\n6. **查依赖方向**：core 绝不 import 具体扩展，扩展只依赖 core。这条坏了，架子会烂在第二个扩展上。\n7. **只留下「需要用户拍的结构决定」**（通常一条），其余按最小实现最广适配自行取舍，不逐项请示。\n\n两条随之而来的纪律：① 自选必须落在**回合边界**并保持稳定（一次选择＝系统提示前缀归一化一次）；② **别让选择器被自己的 restriction 吃掉**\n- **不要用「宿主已有那个生命周期」去否定参考物的架构。** 这两句可以同时成立：骨架照搬，管理器不必自建。\n- **★★ 判「平台能不能做 X」之前，先跑一遍全量接口面，再下判词。** 本会话实测翻车：我据**一条子路径的类型面**（`@deepseek-ai/dsh-agent/types` 的 `Agent` 只有 `id`）判「插件拿不到调用者作用域」，并对用户说了这条结论；后来普查平台自动生成的接口目录（`packages/extensions/tool-cordis/src/api-catalog.t"
  },
  "scores": {
    "jaccard_summary": 0.1053,
    "jaccard_body": 0.1132,
    "summary_cosine": 0.6708
  },
  "note": "这是两份技能的能力宣言段与触发条件；仍不足请回 0。",
  "schema": {
    "verdict": "1 | 0 | -1",
    "reason": "<one sentence, in Chinese>",
    "evidence": [
      {
        "path": "<file>",
        "line": "<n or -1>",
        "quote": "<short quote>"
      }
    ]
  }
}