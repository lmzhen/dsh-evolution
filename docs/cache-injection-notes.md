# 上下文注入说明报告（@lmzhen/dsh-evolution，2026-09-01，v8 审计矫正版）

> 核验方法：注入面按上游 **assemble → render → preStep 链路**核实——`renderPrompt` 只拼接
> `assembly.sections`（system-prompt 前缀）；`systemPrompt.context` 是"持久化 user 角色快照"
> （上游文档原文），经 `agent-loop preStep` 追加到**本次 step 消息尾部**，平台自带
> "文本逐字节未变 ⇒ 本 step 零注入"的去重（`runtime-context.project` retained 比对）——
> 与平台技能目录的 digest 去重是**同一语义、同一消息形态**。结论经八轮审计（v8）逐行核验。

DSH 缓存按**前缀逐字节命中**：前缀 = system sections + 工具声明 + 历史消息；改动前缀任何一字节
⇒ 全链作废。**后文动态注入不破坏前缀**（前文不动，只冷新增段）。

## 注入点总表（15+ 面，15/15 全部合规）

### A. 宿主层（Host）

| # | 注入点 | 位置 | 内容 | 动态性 | 判定 |
|---|---|---|---|---|---|
| 1 | `tool-memory` `systemPrompt.section('evolution:memory-guidance', order:150)` | 前缀 | MEMORY_GUIDANCE 编译期常量（~4 行） | 静态 | ✅ 安装定型，无影响 |
| 2 | `tool-memory` `systemPrompt.context('evolution:memory-snapshot', order:150, () => snapshotText)` | **后文**（preStep 尾部 user 快照） | 记忆快照（动态） | 动态（每次请求装配时求值；**仅 tool-memory 路径的写入改变其值**——见 §3 旁路缺陷） | ✅ **合规**：快照不进前缀；未变=零注入（平台 retained 去重）；变=尾部追加一条 |
| 3 | `tool-skill-manage` `systemPrompt.section('evolution-skills-guidance', order:900)` | 前缀 | SKILLS_GUIDANCE 固定文本（3 行块：标题+两条 bullet） | 静态 | ✅ 固定 order，无影响 |
| 4 | 全部 `defineTool` 描述/schema | 前缀（工具声明区） | 描述+参数 schema（编译期常量拼接） | 静态（安装定型；版本升级才是变更点） | ✅ 运行态零变动 |
| 5 | `evolution-review` ×3 `agent.inject(createUserMessage(...))` | 后文 | 自动评审注入 / 完成评审注入 / 💾 结果通知（恰好 3 处） | 条件触发 | ✅ 后文追加 |
| 6 | `evolution-commands` `agent.inject(createUserMessage(...))` | 后文 | learn/学习提示 | 用户触发 | ✅ 同 5 |
| 7 | `evolution-curator` LLM 提名 | 独立通道 | curator 策略提示（`llm.stream` 直调，不进会话消息） | 仅 curator pass | ➖ 不在会话影响面 |

### B. 平台层（DSH 内置）

| # | 注入点 | 位置 | 动态性 | 判定 |
|---|---|---|---|---|
| 8 | 技能目录（`tool-skill` catalog） | 后文消息 + `visibleDigest` 去重 | 技能增删改 → 追加/更新一条 | ✅ 正确姿势 |
| 9 | 技能内容（`skill` 工具返回） | 工具结果（消息尾） | 每次读取 | ✅ 后文 |

## 结论（v8 矫正后）

1. **15/15 全部合规，无异常**——家族 3 处 systemPrompt 注册（2 section + 1 context）与 4 处
   inject + 1 独立通道，注入面清点完整；前缀仅 3 项静态（1/3/4），动态内容全部后文（2/5/6 + 平台 8/9）。
2. **`memory-snapshot` 不是待修项**快照在后文且平台自带去重——把它们"搬去后文"会是**重复实现
   平台已有机制**（造成同一记忆内容双重注入）。
3. **真实缺陷（P2，v8 连带发现）= 记忆快照刷新旁路**：见 §3。

## 记忆快照刷新旁路（P2，本报告唯一立项修复）

- **机制**：快照重渲染只发生在 **tool-memory 路径**的写入成功回调（`tool-memory:144`）；两条
  直连 `memory.applyBatch` 的写入**不触发刷新**：
  | 旁路 | 位置 | 场景 |
  |---|---|---|
  | `/graph edit\|delete memory:…` | `evolution-learning-graph:236/254` | 学习图命令直接写记忆 |
  | review 内存写入 | `evolution-review:332`（approval 缺席）/`:378`（runnerDirect，approval disabled——**host bundle 默认 `enabled:false`**） | 后台评审直连写记忆 |
- **后果**：默认部署下后台评审/学习图写入的记忆**不进模型可见快照**，直到下一次前台 `memory`
  工具成功才追上——模型基于过期记忆行动。
- **修法（零缓存代价）**：把刷新从 tool-memory 的写入回调**上移到记忆写入唯一收口**——最优为
  `memory-files`/`MemoryStore.applyBatch` 完成后发事件（决策 C 的先例：skill 变更事件下沉
  `SkillLibrary`），tool-memory 监听后重渲染；或在 `MemoryRegistry` 提供 `onApplied` 钩子。
  两个旁路调用点无需各自修补。

## 去重规则（未来注入面）

- 新注入默认走后文（消息尾部追加）；必须进前缀的 = 安装定型静态文本 + 固定 `order`，运行态绝不变动。
- 「体积瘦身」不是缓存优化——前缀命中只认"逐字节不变"；**但 `systemPrompt.context` 的动态
  快照天然合规**（未变零注入，变了尾部追加——不是前缀）。
- 机制结论以**上游装配链路**为准（assemble→render→preStep），勿按 API 名称字面推断。
