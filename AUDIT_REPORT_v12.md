# dsh-evolution 第十二轮审计报告：011 设计落实情况终检

| 项 | 内容 |
|---|---|
| 审计对象 | `docs/design-review/011-maintenance-subagent-v2.md`（维护子代理设计）vs 实现落点 `0cbba88`（Phase 1-4 + v11 修复批全量） |
| 覆盖增量 | 前轮（v9/v10/v11）已核部分引用摘要；本轮新增：**011 模板文本 × core 常量逐字 diff**、quality_score 来源走查、v11 观察项核销 |
| 审计方法 | 逐节承诺矩阵核销 + 模板字节级对比 + 信号语义源头验证 |
| 结论 | **011 的 P1/P2 承诺全部闭环；残余 5 项全为 P3（文档同步/可选项）+ 1 项发布期验收（⏳）** |

---

## 1. 落实矩阵（011 §1-§15 承诺 → 实现状态，v12 终检）

### 已闭环（全部 P1/P2 级承诺）

| 011 承诺 | 状态 | 证据（本轮或前轮） |
|---|---|---|
| Phase 1 信号定义/阈值单源/恒在 | ✅ | `drift-signals.ts` 11 信号恒在（无结果=pass/none，未枚举=unknown）、阈值全部从属主模块导入 |
| Phase 1 redact 下沉 | ✅ | core `redact.ts` + review/probe/事实块三通道同管道 |
| Phase 2 bundle v10 + 模板 | ✅ | `MAINTAIN_PROMPT` 入 bundle（@10）+ prompts.spec 钉住 |
| Phase 2 maintain/restructure 命令 | ✅ | fail-closed、冷却窗 130s、restructure 内核桥接 + 端到端测试 |
| **富化钩子（v11 P1-1）** | ✅ | 4 钩子接齐（parseFrontmatter/listSupportFiles 新增/usage quality_score/usageObserved）；未枚举 → `[UNKNOWN]` 源头区分 |
| Phase 2 校验器拒绝矩阵 | ✅ | 引用闭合/no_issues⇒空/is_override/NaN 拒审/quality_low 强制门/patch 枚举 |
| 签名 + MISMATCH（v11 P2-1） | ✅ | 全模板+定义表签名、去 report 依赖；**维护链路 bundle verify 硬门**（补链） |
| `--plan` 回引（v11 P2-2） | ⚠️→✅ | restructure/consolidate 支持尾参 → 结果文本 `[audit] plan=<id>` 注记（浅实现，见 §2-3） |
| Phase 3 probe | ✅ | 单源计算器、输出过 redact、白名单 `['skill','maintenance_probe']` |
| Phase 4 四道自洽测试 | ✅ | self-consistency.spec（①词汇②无孤儿③示例可复算④引用闭合真实冒烟） |
| 发布面（v11 P2-3） | ✅ | publishGroups 已含 `evolution-maintenance`；host/commands 依赖声明齐 |
| 威胁模型四道防护 | ✅ | redact（事实块+probe）、plan 无执行权、用户挑选、confidence 可见化 |
| 验收口径 | ✅ | 011 §13 已改"fixture 精确 + 真实库触发"（v10 核销表该条为误判，已在前轮说明） |
| v8 P2（快照旁路） | ✅ | `evolution/memory-applied` 事件 + tool-memory 订阅（ctx.emit 通道——v1 P0-1 教训正确应用） |

### 本轮新发现（5 项，全 P3）

**P3-1 模板文档与常量存在占位符/格式漂移（文档同步滞后）**
- 011 §6 模板块 vs core `MAINTAIN_PROMPT`：**79 行逐字差异**，其中实质性差异 = ①文档 §6 环境信号行未占位符化（原文 `usage_observed、quality_low`，常量用 `{signal:usage_observed}` 等——渲染后语义一致但文本不同）；②中文引号空格风格差（`"事实相对阈值的位置"` 有无空格）。
- **判定**：语义等价（模型看到的是渲染后的常量文本）；风险在"下次手工改文档时对照失真"。
- **建议**：011 §6 模板块底部加一行"（以 core `MAINTAIN_PROMPT` 常量为实现基准，本文为语义基准；占位符渲染见 §7）"——文档一行消除未来漂移源。

**P3-2 quality_low 行文与实现语义差**
- 011 §4 描述"quality_low 六因子 + 窗口未开=unknown（A7 门）"；实现富化读侧车 `quality_score`（**六因子（curator run 重算，curator:634）与反馈分（feedback setQuality）双端写入的单一收口字段**）——**分缺失 → unknown 已满足保守**；分存在即用（不因窗口过期）。
- **判定**：功能合理（已落盘的分不因窗口作废），仅行文需补一句"实现读侧车 quality_score（六因子/反馈统一收口），窗口门语义=分缺失即 unknown"。

**P3-3 `--plan` 为浅实现**
- 011 §10 原文承诺"写入调用记录/事件"；实现为结果文本注记（`[audit] plan=<id>`）+ 无持久化——与 §10"最低限度事件载荷已达成"的既有裁决一致，但执行侧引用不在 mutate 审计记录中。
- **判定**：浅实现符合"不为 consolidate 建新持久面"的裁决；登记（若未来需要完整链，再接入 `SkillLibrary` audit 摘要）。

**P3-4 `--facts` 0-token 事实面未实现（v11 观察项核销）**
- 011 §12-1 答辩提到"`/evolution maintain --facts` 可只显示事实块"；实现精确匹配 `maintain`，`--facts` 落帮助分支。
- **判定**：功能缺失（低成本：`maintain --facts` = 渲染事实块返回无子代理调用）——**列修复候选**（与"0-token 事实面"的 A8 答辩价值一致，但不阻塞）。

**P3-5 probe 全局挂载的暴露面理由未在文档记录**
- v10 要求"暴露面决策记录"：实现以全局只读方式做成，但 011/README 未记理由行。
- **建议**：README Known Limitations 加一句"probe 全局可见但只读（与 skill 工具同级），维护子代理白名单限定"。

### ⏳ 发布期验收（非缺陷）

- 011 §15 验收 3：**probe 深挖改变 confidence（被语义层真实利用）**——需真实 LLM 运行——标注：0.3.0 后 `/evolution maintain` 真实冒烟时验证。

---

## 2. 审计自检（诚实披露）

- 本报告核对基准 = mirror HEAD `0cbba88`（与前轮约定一致的"实际核对 HEAD"）；报告正文若引设计基线用 v11 惯例标注（前三轮评审的 `a5bb19b` 基线写法仍为过时表述——不影响本报告结论，因为本报告以当前 HEAD 实测为准）。
- 模板 diff 按字节行对比（DOM 渲染与源码字符数差异已排除——doc 4054 vs 常量 3870 字符，差异解释为上述占位符/空格/换行风格，无缺失内容块）。

## 3. 统计与结论

- 011 承诺核销：**P1/P2 全部闭环（14 项 ✅）**；本轮新发现 **P3×5**（文档同步 2、浅实现/可选项 2、理由记录 1）；发布期验收 1 项待 0.3.0 冒烟。
- **结论：011 落实完成度 = 设计-实现一致（机械层零偏移）**——v11 修复批解决了"接线层"（此前唯一 P1 域），本轮终检未发现新的 P1/P2；残余 P3 均为文档同步或明确裁决过的浅实现/可选项。
- **后续动作建议**：① P3-1/P3-2/P3-5 三处文档一行级修订（随 0.3.0 发布批携带）；② P3-4 `--facts` 作为可选小特性列入 0.3.0 后候选；③ 0.3.0 发布程序可正式启动（发布面卡点已除）。
