# dsh-evolution 第八轮审计报告：`docs/cache-injection-notes.md` 内容审计

| 项 | 内容 |
|---|---|
| 审计对象 | `docs/cache-injection-notes.md`（HEAD `a5bb19b`，2026-09-01 版"上下文注入说明报告"） |
| 核对基准 | 插件 HEAD `a5bb19b`（v0.2.0-rc.2 之后，v7 审计 P1-1/P3-1/P3-2/P3-3 已修复）+ 上游 `dsh-upstream-0.1.1-rc.2` 运行时事实 |
| 审计方法 | ① 逐行核对文档每个断言与家族代码（全量 grep `systemPrompt.section/context`、`agent.inject`、`createUserMessage`）；② 上游机制实证：`system-prompt` 组装与渲染路径、`agent-loop` 请求装配、`runtime-context` 去重、`tool-skill` 目录发布；③ 文档未覆盖面的反向排查（注入点遗漏、快照刷新路径） |
| 约束 | 只读审计，未修改任何文件 |

**结论摘要**：文档的**注入点清单完整且逐项事实准确**（9 行中 7 行完全核验通过，家族内无遗漏注入面），但**核心结论方向性错误**：行 2 把 `evolution:memory-snapshot` 判为"前缀·动态、唯一异常"，而上游事实是 **`systemPrompt.context` 根本不进前缀**——它以 user 消息形式追加在当前 step 尾部，且平台自带"文本未变即零注入"的去重，与行 8 被赞为"正确姿势"的平台目录机制**是同一类**。因此"唯一异常"不存在，真实结论应为**家族 15+ 注入点全部合规（15/15）**。同时，文档因未核查刷新路径而**漏掉了真正的相邻缺陷**：记忆快照存在两条旁路写入（`/graph edit|delete` 与 review 直连 `memory.applyBatch`）导致快照内容对模型**过期**——这才是该注入面唯一需要修的地方，而文档引出的"修复批"（把快照改为后文注入）是在**重复实现平台已有机制**。

---

## 1. 逐行核验结果

| 文档行 | 断言 | 核验 | 证据 |
|---|---|---|---|
| 行 1 | `tool-memory` `systemPrompt.section('evolution:memory-guidance', order:150)` 固定文本 | ✅ | `tool-memory/src/index.ts:122-125`，`MEMORY_GUIDANCE` 为编译期常量，无变量插值 |
| 行 2 | `systemPrompt.context('evolution:memory-snapshot', order:150, () => snapshotText)`、"记忆写入后重求值" | ⚠️ 名称/order/闭包属实（`:127-131`、`:144`），**位置判定错误**（前缀）与**求值描述错误**（仅 tool-memory 路径刷新，见 §3） | 上游证据链见 §2 |
| 行 3 | `evolution-skills-guidance` order 900 固定文本 | ✅（"2 行"实为 3 行块：标题 + 两条 bullet，`prompts.ts:210-212`，可忽略） | `tool-skill-manage/src/index.ts:89` |
| 行 4 | 全部 `defineTool` 描述/schema 静态 | ✅ | memory/skill_manage 描述均为编译期常量拼接（含 `DSH_AUTHORING_STANDARDS`），无运行期插值 |
| 行 5 | review ×3 后文注入 | ✅ | 自动评审注入、完成评审注入、💾 结果通知注入，恰好 3 处（`evolution-review/src/index.ts:157/176/264` 附近），均 `createUserMessage` + `agent.inject` |
| 行 6 | commands learn 注入 | ✅ | rc.70 起经 `createUserMessage`（v7 F-2 修复后） |
| 行 7 | curator 提名独立通道 | ✅ | `llm.stream` 直接调用，不进会话消息 |
| 行 8 | 平台目录 = 后文消息 + digest 去重 | ✅ | `tool-skill/src/index.ts:218-251`：`agent/pre-step` 瀑布把目录 user 消息追加在 `decision.messages` 尾部；`visibleDigest` 未变 ⇒ 直接返回（零注入）；变化 ⇒ `renderCatalogUpdate` 追加一条 |
| 行 9 | 技能内容走工具结果（后文） | ✅ | `skill` 工具返回即 tool/result |

**清单完备性**：全仓 grep `systemPrompt.section|systemPrompt.context` 恰好 3 处注册（2+1），与文档一致；无遗漏的 `agent.inject`（review 3 + commands 1）与无遗漏的独立通道。**注入点清点这项工作本身是合格且可信赖的。**

---

## 2. 决定性上游证据链：`systemPrompt.context` 是后文注入，不是前缀

1. **前缀只含 sections**：`renderPrompt(assembly)` 仅拼接 `assembly.sections`（上游 `system-prompt/src/index.ts:212-214`）——memory-guidance、skills-guidance 进 system 消息（前缀）；**contexts 不在其中**。
2. **contexts 是"持久化 user 角色快照"**：`PromptContext` 的上游文档原文（`system-prompt/src/index.ts:77`）——*"Dynamic model context materialized as a durable **user-role** snapshot"*。
3. **落点在消息尾部**：`agent-loop/src/agent.ts:230-238`（`preStep`）——`const context = runtimeContext.project(...)`，随后 `messages: [...claimed, context]`：快照消息追加在**本 step 认领的消息之后**（当前对话尾部），并作为 `user/message` 事件照常落盘（`agent.ts:282-284`）。
4. **平台自带变更检测去重**：`runtime-context.ts:64-75`（`project()`）——`if (this.retained?.text === snapshot) return`：快照文本**逐字节未变 ⇒ 返回 undefined ⇒ 本 step 零注入**；变化 ⇒ 追加一条新快照消息。这与行 8 被文档赞为"正确姿势"的目录 digest 去重**是同一语义、同一消息形态**。

**推论**：
- 行 2 的"位置=前缀"为**事实错误**；"记忆变更⇒前缀字节变化⇒全链缓存作废"的因果链**不成立**——记忆变更只让**尾部**多一条新快照消息，前缀与既有历史不动。
- "唯一异常"不存在；§结论 1 应改为 **15+/15+ 全部合规**；§结论 2 与文末"修复批"（把快照搬去后文）建立在错误前提上——**平台已经在后文做这件事**，再实现一遍会造成同一记忆内容双重注入（平台快照消息 + 自建消息）。
- 文档第 4 行的教训句"只认逐字节不变"用错了对象：按该标准衡量，memory-snapshot 恰好合格（未变 = 零字节注入）。

---

## 3. 文档漏掉的真正缺陷（P2）：记忆快照的**刷新旁路**

文档行 2 的"每次记忆写入后重求值"只在**经 tool-memory 的写入**时成立（`tool-memory/src/index.ts:144`，`executeCore` 成功后重渲染）。全仓排查 `memory.applyBatch` 的直连调用方，发现两条**绕过刷新**的写入路径：

| 旁路 | 位置 | 场景 |
|---|---|---|
| `/graph edit|delete memory:…` | `evolution-learning-graph/src/index.ts:236`、`:254` | 学习图命令直接调 `memory.applyBatch`，快照不刷新 |
| review 内存写入（**默认部署**） | `evolution-review/src/index.ts:332`（approval 缺席）、`:378`（`runnerDirect`，approval **disabled**——host bundle 默认 `enabled:false`） | 后台评审的记忆操作直连 `memory.applyBatch`，快照不刷新 |

**后果**：默认 host bundle 部署下，后台评审写入的记忆与 `/graph` 编辑的记忆**不会出现在模型可见的快照里**，直到下一次前台 `memory` 工具调用成功才被重渲染追上——模型基于过期记忆行动。按修正后的缓存语义，修好它**零缓存代价**（快照文本变了 ⇒ 平台自动在尾部补一条；没变 ⇒ 零注入），因此这不是缓存问题而是**数据新鲜度 bug**，severity P2。

**建议修法**（文档"修复批"应改写为这个）：把快照刷新从 `tool-memory` 的写入回调上移到**记忆写入的唯一收口**——最优解是 `memory-files`/`MemoryStore.applyBatch` 完成后发出一条（已有先例：决策 C 把 skill 变更事件下沉到 `SkillLibrary`），`tool-memory` 监听后重渲染；或在 `MemoryRegistry` 上提供 `onApplied` 钩子供 tool-memory 订阅。两个旁路调用点无需各自修补。

---

## 4. 次要订正

1. 行 3 "2 行" → 实为 3 行块（`prompts.ts:210-212`）。
2. §结论 1 的算术"15+ 注入点中 14 个合规"无计数口径（表列 9 行，行 4 展开为多工具）；按修正后事实应表述为"全部合规、无异常"，算术问题随之消失。
3. 行 2 的"（每次记忆写入后重求值）"应改为"每次请求装配时求值；仅 tool-memory 路径的写入会改变其值"（见 §3）。
4. 文档前提"DSH 缓存按前缀逐字节命中"属 provider 层断言，本审计未验证（不影响上述结论——结论只依赖"快照不在前缀"这一上游事实）。

---

## 5. 总体评价

- **值得肯定**：注入面清点完整（家族 3 处 systemPrompt 注册 + 4 处 inject + 1 独立通道，一个不漏）；行 1/3/4/5/6/7/9 的事实与分类全部正确；"去重规则"一节的原则（新增注入默认后文、前缀必须安装定型）与平台机制方向一致。
- **核心错误**：作者把 `systemPrompt.context` 当成了 system-prompt 前缀的一部分（行 2"位置=前缀"），进而把平台**已经正确处理**的动态快照误判为"唯一异常"，并据此规划了一个会**重复实现平台机制**的修复批。根因是核验停留在注册 API 名称（`systemPrompt.context` 字面）而未追到上游渲染/装配路径（`renderPrompt` 只吃 sections；contexts 走 `preStep` 尾部消息 + retained 去重）。
- **漏报**：因未排查刷新路径，错过了真实的快照过期 bug（§3，P2）——它恰恰是该注入面上唯一值得立项的修复。

**建议**：① 撤回/重写 §结论 2 与"修复批"，改为 §3 的新鲜度修复；② 行 2 的分类更正为"后文 · 动态 · 平台去重（合规）"；③ 文档抬头补一行核验方法（"注入面按上游 assemble→render→preStep 链路核实"），避免后续读者复蹈同一误判。

**统计**：文档断言 9 行 + 结论 3 条 + 规则 2 条：核验通过 8 项、错误 2 项（行 2 位置判定、结论 2）、欠准确 3 项（行 2 求值描述、行 3 行数、结论 1 算术）；审计连带发现代码缺陷 1 项（P2，快照刷新旁路）。八轮累计 74 项发现 + 本轮文档 5 项更正。
