# 上下文注入说明报告（@lmzhen/dsh-evolution，2026-09-01）

> DSH 缓存按**前缀逐字节命中**：前文改动任何一字节 ⇒ 从该点起全链作废。注入面分两类判定——
> **前缀常驻**（安装即定型，运行态必须零变动）与 **后文注入**（消息尾部追加：前文不动，只冷新增段）。
> 本报告列全家族全部注入面，并指认唯一异常。

## 注入点总表

### A. 宿主层（Host）

| # | 注入点 | 位置 | 内容 | 动态性 | 缓存判定 |
|---|---|---|---|---|---|
| 1 | `tool-memory` `systemPrompt.section('evolution:memory-guidance', order:150)` | 前缀 | MEMORY_GUIDANCE 固定文本（~4 行） | 静态 | ✅ 安装定型，无影响 |
| 2 | `tool-memory` `systemPrompt.context('evolution:memory-snapshot', order:150, () => snapshotText)` | 前缀 | **记忆快照（动态）** | 🔴 **动态**（每次记忆写入后重求值） | ❌ **唯一异常**：记忆变更⇒前缀字节变化⇒会话全链缓存作废 |
| 3 | `tool-skill-manage` `systemPrompt.section('evolution-skills-guidance', order:900)` | 前缀 | SKILLS_GUIDANCE 固定文本（2 行） | 静态 | ✅ 固定 order，无影响 |
| 4 | 全部 `defineTool` 工具说明/schema | 前缀（工具声明区） | 描述+参数 schema | 静态（安装定型；**版本升级才是变更点**） | ✅ 运行态零变动；升级 = 一次冷启动（不可避免） |
| 5 | `evolution-review` ×3 `agent.inject(createUserMessage(...))` | 后文 | 评审提示 / 完成提示 / 结果通知 | 条件触发 | ✅ 后文追加，前缀不动 |
| 6 | `evolution-commands` `agent.inject(createUserMessage(...))` | 后文 | learn/学习提示 | 用户触发 | ✅ 同 5 |
| 7 | `evolution-curator` LLM 提名 `createUserMessage(...)` | 独立通道 | curator 策略提示（发给 LLM provider，非会话对话上下文） | 仅 curator pass | ➖ 不在会话前缀影响面 |

### B. 平台层（DSH 内置，已验证的正确姿势）

| # | 注入点 | 位置 | 动态性 | 判定 |
|---|---|---|---|---|
| 8 | 技能目录（`tool-skill` catalog） | 后文消息 + **digest 指纹去重**（不变 = 零注入） | 技能增删改 → 追一条更新消息 | ✅ 正确：新增/修改技能只追加后文，前文不动 |
| 9 | 技能内容（`skill` 工具读取返回） | 工具结果（消息尾） | 每次读取 | ✅ 后文 |

## 结论

1. 家族 15+ 注入点中 14 个符合「前缀静态 + 后文动态」正确姿势；平台（技能目录/内容）与我们的 review/learn/引导 section 全部合规。
2. **唯一异常 = `evolution:memory-snapshot`**（前缀·动态）——修法：前缀 → 记忆变更后文注入一次（按需零注入），见本文档引出修复批。
3. 「新增/修改技能」不影响前缀（平台后文 + digest 去重）；工具/提示版本升级是唯一不可避免冷启动点（一次/版本）。

## 去重规则（未来注入面）

- 新注入默认走后文（消息尾部追加）；必须进前缀的 = 安装定型静态文本 + 固定 `order`，运行态绝不变动。
- 「体积瘦身」不是缓存优化——前缀体积与命中无关；**只认"逐字节不变"**。
