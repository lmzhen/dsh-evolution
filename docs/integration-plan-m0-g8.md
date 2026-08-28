# 合并优化方案：平台接口线（M0-M4）+ 对齐线（G2-G8）整合计划（rc.41–rc.49）

> 两条审计线在 rc.40 之后合并为一张排期表。本版本已吸收
> `docs/integration-plan-m0-g8-review.md` 评审的全部 6 条修订（实体遗漏补排期、A1 论证更正、
> F-2 方向绑定 D2、高频文件管控、验收环境声明）。
>
> **A 线（平台接口，`AUDIT_REPORT.md` / `OPTIMIZATION_PLAN.md`）**：D↔上游 0.1.1-rc.2 接口冲突审计，
> 编号 P0/P1/P2/D/F，排期 M0-M4。审计对象镜像 `0.1.0-rc.1` 时间点——**本轮逐项验码确认
> P0-2/3/5/6 在当前 rc.40 工作树仍原样存在**（P0-3 在 rc.40 G1 调试中实际复现；P0-1 上游语义
> 经 `dsh-v0.1.1-rc.2` 源码复核成立）。
>
> **B 线（Hermes 对齐，`hermes-alignment-audit-rc39.md` / `-optimization-plan-rc39.md`）**：H↔D
> 语义对齐审计，编号 §4-A..I，排期 G1-G8。G1（review 直通 delete 回写 usage）已在 **rc.40 落地**；
> G2-G8 待作。
>
> 本文只做计划，不改代码。排序原则沿用 B 线计划（先状态一致性再控制面再共享纯函数再模型文本
> 再错误面/观测面再接缝），同时吸收 A 线 M0 的"P0 止血"前置纪律——**任何语义层改动之前，
> 先消除会写坏数据的平台接口冲突**。

---

## 0. 总览：一张表两条线

| 批次 | A 线内容 | B 线内容 | 层级 | 来源 |
|---|---|---|---|---|
| **rc.41** | P0-2/3/5/6（M0 余项）+ P0-4 | — | L3/L0/L4 | M0 止血 |
| **rc.42** | P0-1 事件通道裁决 + **P1-11 投影契约裁决** | — | L4→L5 | M0 止血（高严重度，独立批次） |
| **rc.43** | P1-1/2/3/7/10（P2-10 顺手删） | G2（paused 门+命令） | L0/L4 | M1 + G2 |
| **rc.44** | P1-6/P2-1/2-3/2-5/2-8（P1-4） | G3（图谱语义边+单源） | L0/L1 | M1 + G3 |
| **rc.45** | P1-8/P1-12/B 线证据权衡（降为文档决策）+ P2-11 + origin 统一 + create 记账 | G4（prompt bundle v3） | L2/L4 | M2 + G4 |
| **rc.46** | P1-5（只拍板决策 C，不实施）/P1-9/P2-9 核实 | G5（记忆错误面） | L3/L4 | M2/M3 + G5 |
| **rc.47** | 决策 C（下沉重构）+ P2-6 | G6（报告 keep20） | L3/L5 | M3 + G6 |
| **rc.48** | P2-2/4/7/12-14 | G7（isSymlink 探针） | L1/L0 | M1 + G7 |
| **rc.49** | 决策 D + M4 工程化（F-1..7/D-1..9/基线，D-9 二选一）+ 显式声明 M0-0.1 由 D2 取代 | G8（文档治理，随行） | L6 | M4 + G8 |

> **合并原则**：B 线（G2-G8）本身按架构分层排序，A 线 M0 的 P0 全清再插到最前（B 线计划
> G1 时已确立"先高 severity 止损"）；两条线在 rc.43 起的批次内**按同层合并**——同一层的两个
> 修复放同一 rc，减少发布轮次与回归面。A 线 M1 的结构性项（P2-2 跨进程事务锁）与 B 线
> 无同层对应者，仍独立成批（rc.48 附近的保险带）。

---

## 第一步（rc.41 · A线 M0 止血：P0-2/3/4/5/6 五项全清）

**目标**：A 线 P0 除 P0-1（需裁决，rc.42 独立）外全部关闭。五项均为 A 线验码确认仍存在的
实测问题，改动面小、无 B 线重叠。

| 步骤 | 层 | 来源 | 动作 | 验收 |
|---|---|---|---|---|
| 1.1 | L3 | P0-2 | `evolution-replay`：命令名 `'evolution replay'` → `'evolution-replay'`（或并入 `/evolution replay` 子命令，推荐后者减少命令数）；handler 返回 `{kind:'success', text}` | commands 注册不抛错；运行时返回形状过校验（对齐 rc.28 修复模式） |
| 1.2 | L1 | P0-3 | `skill-usage` root 改 `rawConfig.root || skillsRoot()`（与 tool-skill-manage/evolution-skill-catalog/evolution-state-json 四处写法对齐） | 未配置 root 时 sidecar 落 `~/.dsh/skills/.usage.json`；**加回归测试**：挂载不带 `{root}` → `registry.root === skillsRoot()`（rc.40 调试教训固化） |
| 1.3 | L0 | P0-4 | plan-validator 补 `@deepseek-ai/dsh-evolution-core` dependencies | 干净目录 `npm i` 可解析加载 |
| 1.4 | L0 | P0-5 | fuzzy patch 两道守卫：①`trimPatternBoundaries` 结果为空串 → 直接返回"未找到"；②`fuzzyReplace` 改循环 + 每轮进度断言（替换后必须不再匹配才继续），消除 `RangeError`。**顺带并入 A 线 M1-1.6 的 fuzz 属性测试**（old/new/content 随机组合断言：不异常、不丢内容、patched 与原文差异仅匹配段） | 空串/自包含 new_string 两类回归用例 + 1000 组随机用例；不再栈溢出 |
| 1.5 | L4 | P0-6 | curator `llm.stream` 移除 `purpose: 'evolution-curator'`（收敛到上游封闭联合 `'compaction' | 'session-title'`——插件无权扩展上游封闭联合，移除是唯一可执行项） | tsc 对 0.1.1-rc.2 类型零报错；无 purpose 后行为回归用例 |

**说明**：P0-3 的 rc.40 教训是双面的——它既是"测试要显式传 root"（已记录），也暴露了
**生产代码的源头缺陷**（`''` 穿透 nullish 合并）。rc.41 修源头后，测试层的显式 root 显式化
仍保留（测试独立性 vs 生产默认值是两个问题）。

---

## 第二步（rc.42 · A线 M0 止血：P0-1 事件通道裁决 + P1-11 投影契约裁决（评审修订 1））

**目标**：解决"review 调度/计划事件写坏会话日志"的数据可用性事故。**这是两条线的盲区
交叉点**：B 线 rc.39 审计把这些 append 当正常路径（未核上游白名单），A 线审计指出它们
违反 `assertEventsSupported`——rc.42 必须裁决。

**上游事实（已复核 `dsh-v0.1.1-rc.2`）**：
- `known-event-types.ts` 的 `KNOWN_SESSION_EVENT_TYPES` 为生成清单，不含 `evolution/*`；
  文件头注释明确"下游插件事件必然不在清单内，注册接口暂缓提供"。
- `session-persistence/coordinator.ts` `assertEventsSupported()`：未知类型且 `ignorable !== true`
  → 抛 `SessionFormatUnsupportedError` 拒绝解释整份日志。
- `Session.append` 无任何通道写入 `ignorable: true`（全仓库无写入点）。

**候选方案**：
- **A1（推荐）**：`evolution/review-scheduled`、`evolution/plan-applied` 从 `session.append`
  改为 **`ctx.emit` 进程内事件**（`evolution/skill-mutated` 已是此模式，有先例）。
- **A2**：等待上游"插件事件注册面"落地，落地后恢复 session.append + `ignorable`。

**A1 的因果链（评审修订后，与 P1-10 解耦）**：
- **不受影响的**：`turnStarts/cumulativeToolCalls/completionInjected` 由进程内 `turn/start`
  与 turn/end 维护，`foldTurn` 只读原生事件（tool/call、user/message、assistant/message）；
  `evolution/review-scheduled`、`evolution/plan-applied` **只写不读**——A1（append→emit）
  对 review 记数无影响（它们本就重启即失，是 rc.43 P1-10 的清理对象）。
- **真正被打断的两个消费方**（A1 必须随行裁决）：
  1. **evolution-activity 投影失去数据源**：session-projection 由宿主按会话事件流驱动
     （冷启动从 checkpoint 恢复）；事件不进会话日志后投影没有数据源。**需裁决**：
     投影退役（UI 经投影读 activity 的通道消失，给出替代读路径——evolution-state 活动表）
     还是改挂其他驱动源。**这直接决定 P1-11 命运**：A1 落地则双契约注册（
     `evolution-activity/src/index.ts:93,97` 同时提交 `schema`+`view` 与 `stateSchema`+`wire`）
     随之退役、P1-11 消解；维持 append（A2）则 P1-11 仍需修（上游 0.1.1-rc.2 的
     `ProjectionDefinition` 无 `schema`/顶层 `view` 字段）。
  2. **事件载荷缺 sessionId**：`EvolutionPlanAppliedEvent`（`evolution-core/src/events.ts:17-26`）
     无会话身份字段；`ctx.emit` 版本需要 payload v2（补 sessionId），否则 replay/activity
     无法按会话归组。
- **记数迁移降级**：review 记数迁 evolution-state 不再是 A1 的必要条件（见上），
  降级为**可选加固**，与 rc.43 的 P1-10（记数按会话清理/LRU 上限）一并处理。

**验收底线**：任何部署下，含 evolution 活动的会话必须可 resume（以 0.1.1-rc.2
`assertEventsSupported` 为判据）；已有会话日志包含 `evolution/*` 的提供迁移说明。
**新增验收物**：带持久化的 resume e2e（写到磁盘 → 重启进程 → 断言 resume 成功）——
现有 B 线五连（开发树 vitest/tsc/oxlint/CI）不覆盖此路径，rc.42 必须新增该测试。

**暴露窗口注明**：rc.41 与 rc.42 分批期间每个 review 触发继续产生不可 resume 的会话日志。
计划要求 rc.41/42 同周内连发；若调度不允许，改为给 rc.41 加临时止血（feature flag 关闭
session.append），宁可暂时无 review 事件也不续写坏日志。

---

## 第三步（rc.43 · A线 M1 核心 + B线 G2）

**A 线**：
- **P1-1** consolidate 两段提交：源归档循环 `if (!result.ok) return result` 改为进入 catch
  统一回滚（第 2 个源失败时第 1 个源已入 `.archive` 的中间态）。
- **P1-2** curator 调序：`scoreTree` → `computeLifecycleTransitions`（评分先行，转移用当轮质量分）。
- **P1-3** review `trySubagentReview` 用 try/finally 保证 `dispose()`（超时/异常也释放）。
- **P1-7** curator `stateService === undefined` 与 `persisted === null` 同一分支走首跑延迟。
- **P1-10**（评审修订 4：从 rc.46 提前到本批）review 的
  `turnStarts/cumulativeToolCalls/completionInjected` 记数清理——与 P1-3 同文件、
  同属"review 层生命周期收口"，避免 rc.42/43/46 反复回归同一文件。处置 = 会话结束清理
  或 LRU 上限（记数本就重启即失，见 rc.42 因果修订）。
- **P2-10**（评审修订 4：顺带）`evolution-review:241-243` 冗余自赋值
  （`validation.accepted.skillOps = acceptedSkillOps` 赋值同一数组引用，`filterUnreadSkillOps`
  已原地 splice）——与本批同文件顺手删。

**B 线 G2**（paused 门 + 命令面）：
- `runCore` 开头加 `persisted?.paused === true → skipped:'paused'`（对齐 H `should_run_now` 顺序）；
- `setPaused(paused)` setter + `/evolution curator pause|resume` 子命令；
- 可选：`curator status` 一行摘要、`curator run consolidate` 单次 LLM 覆盖。

**同层合并说明**：P1-1/2/7 都是 curator/状态机层，与 G2 同层（L4 控制面）；P1-3 是 review 编排层，
其 try/finally 与 G1（rc.40）的"直通 delete"修复在同一个文件，放此批顺理成章。

---

## 第四步（rc.44 · A线 M1 介质 + B线 G3）

**A 线**：
- **P1-6** `detectDrift` 将 `raw === ''`（纯空白）视为"从未写入"，不判漂移；
- **P2-1** `failureCount` 跨 turn 重置（或带时间窗）；
- **P2-3** `loadUsage`/`loadMutations` 字段级类型归一（数值字段非数值 → emptyRecord 兜底）；
- **P2-5** `SkillLibrary` 统一先 normalize name 再拼路径（抽 `private dirOf(name)`）；
- **P2-8**（评审修订 4：顺带）共享默认值单源化——`memory-files` 硬编码 2200/1375/3、
  `tool-memory:111` 的 200 写两处、`curator:100` 的 7 改引 `constants.ts` DEFAULT_*；
  与 B 线 G8 互补不冲突（G8 是文档声明，P2-8 是代码收敛，同批正好把两层一起收口）；
- **P1-4** state-domain `ensure()` 失败清空 `opening` + 指数退避重试。

**B 线 G3**（图谱语义边 + `related_skills` 单源化）：
- core 新增 `relatedSkillNames(content, exclude?)` helper（curator referenceCounts 与图谱共用）；
- 图谱 `related` 边从字母序占位 → `related_skills` 语义边（两端存在校验、去重、双向）；
- 可选 density 统计（edges_per_node / isolated_pct）。

**同层说明**：P1-6/P2-1/P2-3/P2-5 全在 L0 core（memory-store/skill-store/usage），与 G3 的
core helper 同层；P1-4 在 L1 state-domain 但小，顺带。此批是"core 正确性加固"的集中批次。
**顺带并入 A 线 M1-1.10 的契约测试**：state-json 与 state-domain 两 provider 跑同一套
claim/resolve 契约（10 分钟 claim 过期、exactly-once resolve），与 P1-4（state-domain
opening 修复）同批——防止两 provider 语义漂移。

---

## 第五步（rc.45 · A线 M2 决策 + B线 G4）

**A 线**：
- **P1-8** 控制面 `consolidate()` 接入 GateSet（含 referenced/suppressed）；
  **先拍板决策 B**（GateSet 统一模块）：lifecycleCandidate / gateConsolidations / 控制面
  consolidate / scope view 四消费方引用同一实例。
- **P1-12（评审修订 2：降为文档决策）**：前台（主 agent）创建的 skill 是否纳入 lifecycle。
  **关键输入**：B 线 rc.39 审计 §2.2 对同一行为判 **✅ 与 H 对齐**（H 仅 review 通道标记
  agent-created；前台=用户意图；开关差异"无场景"）——A 线视为"设计张力"，B 线视为"正确
  对齐"，**结论互斥**。在"H 对齐"作为项目目标的前提下，正确解 = **保持现状 + README 显式
  声明**（`tool-skill-manage:111` 仅非前台标记是与 H 一致的有意设计，归 G8 文档口径）；
  若要改行为，必须先修订 B 线对齐判定表，否则制造新的 F 类文档-代码漂移。
- **P2-11**（policy.json 幽灵特性，A 线 M2 丢失项）：实现或删除二选一——**推荐删除**
  （protectedPaths/受护路径拼装但全仓无读写方，YAGNI）；顺带清 policy.json 相关死路径。
- **origin 映射统一**（A 线 M2-2.3 横切项，评审补排期）：抽
  `resolveWriteOrigin(sessionHeader, channel): WriteOrigin` 单一映射函数，tool-memory /
  tool-skill-manage / review 三处复用（当前三处映射语义不一致，靠注释维持）。
- **M3-3.3 create 记账**：`create` 不再记 `patch_count`（新增 `create` 计数或独立字段），
  质量公式同步（新建 skill 首轮分数合理）。

**B 线 G4**（模型文本修正 + PROMPT_BUNDLE v3）：
- pinned 矛盾措辞修正（"Pinned skills may be patched but not archived" → 与实现一致）；
- inject 回退软约束（"Only update skills you loaded or read in THIS session"）；
- `PROMPT_BUNDLE_ID/VERSION` 升版（3）——**唯一有部署一致性含义的步骤**，发布说明须提示
  "升级需整批一致"（verifyPromptBundle fail-closed）。

**同层说明**：P1-8/P1-12 与 G4 都在 L2/L4 控制面层；G4 的 prompt 升版是语义性变更，
与 P1-12 的 README 同步同一批完成（避免"行为与文档矛盾"的 F 类漂移新增）。

---

## 第六步（rc.46 · A线 M2/M3 收尾 + B线 G5）

**A 线**：
- **P1-5**（catalog 失效事件覆盖缺口）：**评审修订 3——本批只拍板决策 C，不实施**。
  原因：rc.47 的决策 C 实施（发射点下沉 SkillLibrary + 删除手工 emit）会整体覆盖本批
  "临时补发 emit"的改法，先实施即返工。本批只定方向（决策 C 为终态），把 P1-5 的
  验收口径（"写→立刻 list 原生 ctx.skills 目录一致"）写进 rc.47 验收。
- **P1-9** approval `request()` 增加预检：kind 对应无已注册 runner → 拒绝 staging
  （消灭"永久不可批准的 pending"）。
- **P2-9** 以 0.1.1-rc.2 源码核实 `toolFilter` 形状 / `outputSchema.items.type:'json'` /
  `maxDepth:0` 语义，结论固化为类型/测试。**注意与 P1-11 拆分**：P2-9 是 subagent 契约
  （toolFilter/outputSchema/maxDepth），P1-11 是 projection 注册字段（`schema`/`view`）——
  两者已在 rc.42 分别裁决/核实，风险表相应拆分。

**B 线 G5**（记忆错误面可恢复性）：
- 包私有常量 `ERROR_PREVIEW_ENTRIES=5`、宽度 80；
- mutate 缺 old_text / 未命中 / 多义匹配 / applyBatch 失败消息附条目预览（有界）。

**同层说明**：P1-5/C 是 L3 写通道，G5 是 L0 错误面——不同层，但都是"把状态/错误
传达到正确出口"的收尾项；P2-9 的"上游核实"与 G4（rc.45 已升 prompt bundle）错开一批，
避免同一发布里"改了基线又核基线"。

---

## 第七步（rc.47 · A线 决策C 落地 + B线 G6）

**A 线**：
- **决策 C 实施**：写事件发射下沉 SkillLibrary，删除 tool-skill-manage 手工 emit；
  catalog `get()`/`list()` 共享一次 list 缓存（P2-6，大树下 get 不随 N 线性）；
- **P2-6** 快照并行拷贝 + N+1 IO 收敛（skill-store list 每技能 5 次 stat/read）。

**B 线 G6**（报告观测面）：
- 报告保留裁剪（keep 20，镜像 retainSnapshots 姿态）；
- 可选 REPORT.md human 层（`renderCuratorReportMarkdown`）。

**同层说明**：决策 C 是 L3 写通道事件化，G6 是 L4 报告——都属"可观测性收敛"批次。

---

## 第八步（rc.48 · A线 M1 保险带 + B线 G7）

**A 线**：
- **P2-2** 侧车读-改-写整体加锁（`io.transact(path, fn)` 事务语义，usage/mutations/suppressed
  三处迁入；单进程 chain 保留为第二层）——**A 线 M1 的结构性项**，独立成批；
- **P2-4** `nodeEvolutionIo.list` 区分 ENOENT（→[]）与 EACCES/EIO（→抛）；
- **P2-7** `session-query-sqlite` 覆盖行 env 回退改用上游 `dshHomePath` helper；
- **P2-12/13** feedback dispose flush 可等待 + record/restore 同一 mutate 队列串行；
- **P2-14**（评审修订 4：顺带）快照恢复对未知残留目录的容忍——restore 后清理
  "快照中存在但 manifest 未列"的残留（legacy 分支除外），依赖 manifest 完整性收口。

**B 线 G7**（IO 接缝符号链接防御）：
- `isSymlink?` 可选探针（沿用 `size?` 三件套模式：seam 声明 + adapter 透传 null + nodeIo 实现）；
- archive/restoreFromArchive rename 前探测，true 拒绝，null 放行（"守卫不适用"）。

**同层说明**：P2-2/P2-4/P2-7 都在 L1 介质/seam 层，与 G7 的 isSymlink 探针同层——**这一批
是接缝层的集中加固**，放最后避免动签名面影响前面的批次。

---

## 第九步（rc.49 · A线 M4 工程化 + B线 G8）

**A 线 M4**：
- **决策 D**：镜像构建布局二选一（D1 镜像内自成构建 / D2 声明"构建只在上下游树"）。
  **推荐 D2**（当前事实：构建/测试在上游 monorepo，镜像只承载发布）——与 B 线 rc.40
  "工作树 = 开发基地"的既定事实一致，D1 收益低于成本。**显式声明 M0-0.1 由 D2 取代**：
  OPTIMIZATION_PLAN 的"镜像内测试脚手架"（M0-0.1）随 D2 隐式取消——本计划必须写明这层
  取代关系，否则读者以为该步骤丢失。
- **F-2（评审修订 5：方向绑定 D2）**：F-2 本身是"审计镜像"视角的产物（README/INSTALL 写
  `packages/evolution/scripts/install-layered.mjs` 而镜像实际在 `packages/scripts/`）。
  **D2 之下以开发树为 canonical**——文档保持开发树口径（`packages/evolution/scripts/...`）；
  镜像 README 补一段布局说明（mirror 扁平布局 vs dev-tree 布局的运行差异），
  normalize-mirror/publish 脚本注释更新。**不得**把文档改成镜像路径（评审指出的内部矛盾）。
- **F-1/F-3** README 事实修正（reviewToolAllow 默认、测试数字 51 spec、minimal preset 场景表
  标注"上游行为"或删除）。
- **F-4**（"retired at rc.18" 版本注释失锚——版本号都是 0.1.0-rc.1，注释失去可追溯性）、
  **F-6**（minimal preset 场景表描述上游宿主行为、仓库无对应实现）、**F-7**（INSTALL
  vitest 路径）——评审补排期，全部并入本批文档清理。
- **D-9**（评审补排期：evolution-capability 挂载但零调用面）——补最小调用面
  （`/evolution capability submit|pending` 子命令）或从 host bundle 摘除、降级为可选包。
  推荐后者（保持 host 最小挂载面；能力面按需激活）。
- **§5.3** 版本基线单源化（UPSTREAM_VERSION 一处定义，三处引用同一来源）；
- **4.6** CI 增加"0.1.1-rc.2 类型比对 + 冒烟装载"job；
- **D-1/D-2/D-3** 死代码清理（JsonState 文件、MemoryStore.replace/remove、MemoryRegistry.snapshot）
  ——**注意 D-1 的两条线口径**：B 线 rc.30 审计把 `state-store.ts` 的 `mergeDeep` 当机制引用
  （§2.9"解析兜底=JsonState.mergeDeep ✅"），A 线指出它零调用属"退役未删"——本批删除后，
  **B 线审计 §2.9 该行失锚，G8 文档批必须顺带更新**（把"解析兜底"改为指向
  `evolution-state-json` 的实测路径）；
- **D-4**（`prepare-release.mjs` 的 `PUBLISH_EXCLUDE` 空集 + 已删 facade 长注释）——清空集的
  排除逻辑与失锚注释一并清理；**D-6**（io.ts 等生产注释的"facade stores"叙事——实际消费方
  全是原生包）——改写为原生包口径；
- **D-5/D-7/D-8** README 包表、tsdown entry、invariant 模板（低优先）。

**B 线 G8**：默认值差异显式声明（pruneBuiltins false vs H true）、报告路径口径统一
（`~/.dsh/evolution/reports/` 全仓）、已知差异登记册固化、旧审计标注"已被 rc39 取代"。
（G8 多数已在 rc.40 随文档同步时部分执行——本批收尾。）

---

## 高频改动文件与验收环境（评审修订 6）

**高频改动文件**（多批回归同一文件，须重点看 diff 与回归测试）：

| 文件 | 触碰批次 | 内容 |
|---|---|---|
| `evolution-review/src/index.ts` | rc.40 / rc.42 / rc.43 / rc.46 | G1（已落）、A1 事件通道、P1-3 dispose、P1-10 记数清理；rc.46 仅 P2-9 类型核实可能触文件（P1-5 已改为只拍板，不在此批实施） |
| `evolution-core/src/skill-store.ts` | rc.41 / rc.44 / rc.48 | P0-5 守卫、P2-5 dirOf + G3 core helper、G7 symlink |

> 缓解：rc.43 已把 P1-3/P1-10 与本批合并为"review 层专项"（同文件一次回归）；
> rc.46 已改为"只拍板决策 C 不实施"（避免 rc.46 补发 emit 被 rc.47 下沉重构覆盖）。
> 若发布节奏允许，rc.42/43 可连发（review 文件一个批次窗口内只变一次）。

**验收环境声明**：B 线五连（定向 vitest → `tsc -b tsconfig.host.json` → oxlint `--type-aware`
→ 全量 → CI）跑在 **deepseek-harness 开发树**；A 线三项验收需单独声明运行位置：
- P0-4（"干净目录 `npm i` 可解析加载"）→ 镜像内独立安装验证（非 hoisted workspace）；
- P0-6（"tsc 对 0.1.1-rc.2 类型零报错"）→ 在上游 `dsh-v0.1.1-rc.2` worktree 环境比对；
- P0-1（"含 evolution 活动的会话可 resume"）→ **带持久化的 resume e2e**（写盘→重启进程→
  断言 resume 成功），现有五连不覆盖此路径，rc.42 新增该验收物。

---

## 明确不做（两条线共同重申）

- B 线排期外项：cron 引用自动扫描（等 task-board 接口）、inject 走结构化 plan、全局 memory id 迁移、
  frozenSnapshot、LLM consolidate 降级——均维持"已裁定"；
- A 线 Scope 控制：不重写 fuzzy patch 为正则/差分（守卫修复已消除危害）、不引入新外部依赖、
  不做 UI/网关观测面板、不追查 provider/model 名上游有效性、**P0-6 不"与 llm 维护方确认扩展面"**
  ——插件无权扩展上游封闭联合（`packages/llm/llm/src/types.ts:376`），移除 `purpose` 是唯一
  可执行项（评审修订）。

---

## 风险与回滚

| 风险 | 影响批次 | 缓解 |
|---|---|---|
| 决策 A1 切换数据源后旧日志不可读 | rc.42 | 迁移说明 + 一次性清洗脚本方案（写入 decisions.md） |
| A1 落地后 activity 投影退役无替代读路径 | rc.42（与 P1-11 连带） | 裁决时一并定"evolution-state 活动表"为替代读源；暂缺替代则维持 append（A2） |
| **A2 分支（维持 append）下 P1-11 仍需修** | rc.42/46 | P1-11（双契约注册）修复 + 先运行时探测过渡（与 P2-9 拆分，各挂各自核实） |
| GateSet 收紧后既有"绕门"工作流被拒 | rc.45 | BREAK NOTE；`--force` 显式逃逸（仅 foreground 审计留痕） |
| prompt bundle v3 新旧混布 fail-closed | rc.45 | 发布说明提示"整批一致" |
| rc.41/42 分批期间 review 持续写坏会话日志 | rc.41/42 | 同周内连发；或 rc.41 加 feature flag 临时关闭 session.append |
| 构建布局切换影响发布流水线 | rc.49 | D2 兜底声明 |
| 前台创建纳入 lifecycle 改变用户行为 | rc.45（P1-12） | 已按 B 线证据降级为文档决策（保持现状+声明），无行为变更 |

---

## 落地后回归基准（下一轮审计校准）

| 域 | 修订后口径 |
|---|---|
| 平台接口 | P0-1~6 全清；会话日志 0 个 `evolution/*`；replay 命令可注册；skill-usage 默认落盘；fuzzy 无栈溢出；purpose 收敛到上游联合 |
| 控制面 | GateSet 单源；paused 门 + pause/resume；curator 评分先行；控制面 consolidate 门齐；**origin 映射单一函数（三处消费）**；**policy.json 幽灵特性已移除**；**前台创建生命周期条款已在 README 显式声明（与 H 对齐，非缺陷）** |
| 图谱 | related 边 = `related_skills` 语义边（单源 helper） |
| 复习 | dispose 全覆盖；写入事件下沉 SkillLibrary；记数按会话清理 |
| 记忆 | 0 字节不判漂移；失败消息附预览；跨 turn 失败计数重置；**create 不再记 patch_count** |
| 报告 | `~/.dsh/evolution/reports/` + keep 20 |
| 接缝 | `isSymlink?` 探针；跨进程事务锁；list 区分 ENOENT/EACCES |
| 工程化 | 基线单源；镜像构建 D2 定稿；死代码 F/D 全清；**evolution-capability 已定入/摘除（D-9 二选一裁决）** |

---

*输入：`AUDIT_REPORT.md`（A 线全量审计）、`OPTIMIZATION_PLAN.md`（A 线 M0-M4）、
`docs/hermes-alignment-audit-rc39.md`（B 线审计）、`docs/hermes-alignment-optimization-plan-rc39.md`
（B 线 G1-G8）。本计划与 B 线 G 计划的关系：G 计划保持其编号与节奏，本计划只是把 A 线
M0-M4 按"与 G 同层则合并、异层则插队"的原则嵌入——两线完全独立推进也可行，合并仅省发布轮次。*
