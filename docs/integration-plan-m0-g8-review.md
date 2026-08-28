# integration-plan-m0-g8 评审（只读）

> 评估对象：`docs/integration-plan-m0-g8.md`（两条审计线的合并排期，rc.41–rc.49）。
> 输入：
> - **A 线**：`AUDIT_REPORT.md` / `OPTIMIZATION_PLAN.md`（平台接口线，P0/P1/P2/D/F 编号 + 决策 A–D）
> - **B 线**：`docs/hermes-alignment-audit-rc39.md` / `docs/hermes-alignment-optimization-plan-rc39.md`（H 对齐线，§4-A..I + G1–G8）
> 方法：两线问题清单全量并集 → 与整合计划批次逐项比对（覆盖性）；对计划的事实声称在
> rc.40 开发树（`deepseek-harness/packages/evolution`）抽查核码；架构层评估排序与合并逻辑。
> 本文件只做评审，不改任何代码；行号为本次读码快照。

---

## 0. 总评

**合并框架成立，事实基础可信，可执行；修订 6 处后可定稿。**

- 合并原则（"同层合并、异层插队"、先止血后语义、B 线保持编号节奏）与两条源计划的自排逻辑一致，rc.43 的 curator 同层合并是全文最强的示范批。
- B 线 9 项（含排期外与文档治理）**全覆盖**，无遗漏。
- A 线覆盖约 90%：P0 6/6、P1 11/12、P2 10/14、D 8/9、F 4/7、四个横切决策全在排期。遗漏集中在 **P1-11（实体）、P2-11、D-9** 与若干轻量项（§3）。
- 计划的验码声称经开发树抽查**全部属实**（§1）——这在此类合并文档中不多见，事实纪律值得肯定。
- 需要修正的四个架构级问题：rc.42 的 A1 论证因果写反且漏掉两个真硬依赖（§4.1）、P1-12 与 B 线对齐证据方向相反未标注（§4.2）、rc.49 的 F-2 与决策 D2 内部矛盾（§4.3）、高频改动文件无管控（§4.4）。

---

## 1. 事实基础核验（rc.40 开发树抽查）

对 `deepseek-harness/packages/evolution` 逐项 grep，整合计划头部与各批次的验码声称逐条属实：

| 计划声称 | 抽查结果 |
|---|---|
| G1（review 直通 delete 回写 usage）已在 rc.40 落地 | ✅ `evolution-review/src/index.ts:362-366` delete 分支已有 `markArchived` |
| P0-3 仍在 | ✅ `skill-usage/src/index.ts:37` 仍为 `config.root ?? skillsRoot()` |
| P0-2 仍在 | ✅ `evolution-replay/src/index.ts:146` 仍注册 `'evolution replay'` |
| P0-5 无守卫 | ✅ `evolution-core/src/skill-store.ts:229-230` 边界 trim 逻辑未变 |
| P0-6 仍在 | ✅ `evolution-curator/src/index.ts:248` 仍传 `purpose: 'evolution-curator'` |
| P0-1 仍在 | ✅ `session.append` 三处（`evolution-review:145/168/247`） |
| （计划未声称） | ⚠ **P1-11 双契约也仍在**（`evolution-activity/src/index.ts:93,97`），但不在任何批次——见 §3 |

---

## 2. 覆盖性核对

### 2.1 B 线（H 对齐）——完整

| B 线项 | 整合计划落点 | 判定 |
|---|---|---|
| §4-高 A（G1） | rc.40 已落地（开发树核码确认） | ✅ |
| §4-中 B（G2 paused 门+命令） | rc.43，与 P1-7 同批（同在 runCore 门控，合并正确） | ✅ |
| §4-中 C（G3 图谱语义边+单源） | rc.44 | ✅ |
| §4-低 D/E（G4 prompt bundle v3） | rc.45 | ✅ |
| §4-低 F（G5 记忆错误面） | rc.46 | ✅ |
| §4-低 G（G6 报告 keep 20） | rc.47 | ✅ |
| §4-低 H（G7 isSymlink 探针） | rc.48 | ✅ |
| §4-低 I + §5 文档治理（G8） | rc.49 | ✅ |
| 排期外（cron 引用/全局 id/frozenSnapshot 等） | "明确不做"重申 | ✅ |

### 2.2 A 线（平台接口）——约 90%，遗漏如下

已覆盖：P0-1..6（rc.41/42）、P1-1/2/3/7（rc.43）、P1-4/6 + P2-1/3/5（rc.44）、P1-8/12（rc.45）、P1-5/9/10 + P2-9（rc.46）、决策 C + P2-6（rc.47）、P2-2/4/7/12/13（rc.48）、决策 D + F-1/2/3/5 + D-1..8 + §5.3 + CI job（rc.49），决策 A/B/C/D 全部在排期。

| 档 | 遗漏项 | 处理建议 |
|---|---|---|
| **实体遗漏（必须补）** | **P1-11** 投影双契约注册 | 并入 rc.42 裁决范围（与决策 A 直接联动，见 §4.1）。风险表"投影契约若上游严格校验 \| rc.46（P2-9 核实后定）"把 P2-9（subagent 契约：toolFilter/outputSchema/maxDepth）与 P1-11（projection 注册的 `schema`/`view` 字段）**混为一谈**，需拆开 |
| | **P2-11** policy.json 幽灵特性（protectedPaths 拼装但全仓无读写方） | A 线 M2 有、整合计划无；建议 rc.45（L2 控制面批）顺带"实现或删除"二选一（推荐删） |
| | **D-9** evolution-capability 挂载但零调用面 | A 线 M3-3.7 丢失；补命令面（`/evolution capability submit\|pending`）或从 host bundle 摘除降级为可选包 |
| **顺带并入** | P2-8 共享默认值未单源（memory-files 硬编码 2200/1375/3 等） | → rc.44（core 批）。与 B 线 G8 互补不冲突：G8 是文档声明，P2-8 是代码收敛 |
| | P2-10 review 冗余自赋值（`validation.accepted.skillOps = acceptedSkillOps`） | → rc.43（P1-3 同文件顺手删） |
| | M2-2.3 origin 三态映射统一（`resolveWriteOrigin` 单一函数） | A 线横切项整批丢失；→ rc.45（决策批） |
| | M3-3.3 create 记 patch_count 扭曲质量分 | → rc.45（与 P1-12 同一决策面） |
| | P2-14 快照恢复对未知残留目录的容忍 | → rc.48（接缝批） |
| **显式声明即可** | M0-0.1 镜像内测试脚手架 | 被决策 D2 隐式取消，但计划未写"取代"关系——应显式声明，否则读者以为丢了 |
| | M1-1.6 fuzz 属性测试（降格为回归用例）、M1-1.10 state-json/domain 契约测试 | 并入 rc.41/rc.44 验收或记排期外 |
| | F-4（"retired at rc.18"版本注释失锚）、F-6（minimal preset 场景表）、F-7（INSTALL vitest 路径） | rc.49 文档批应显式列出（F-2 只覆盖了路径类） |

---

## 3. 架构层评估：四个需要修正的点

### 3.1 rc.42 的 A1 论证因果写反，且漏掉两个真正的硬依赖

计划称："若 review 记数依赖会话事件回放……A1 需同时把记数迁 evolution-state——**这是 A1 的完整形态**"。机制上不成立：

- `turnStarts/cumulativeToolCalls/completionInjected` 由进程内 `turn/start` 事件与 turn/end 维护（`evolution-review:107-143`），`foldTurn` 只读**原生**事件类型（tool/call、user/message、assistant/message）；`evolution/review-scheduled`、`evolution/plan-applied` **只写不读**。A1（append→emit）不影响 review 记数——它们本来就重启即失（那是 rc.46 P1-10 的清理对象）。"记数迁移"应从 A1 必要条件**降级为可选加固**，并与 P1-10 合并处理。

A1 真正打断的两个消费方，计划只写了一半：

1. **evolution-activity 投影无法存活**：session-projection 由宿主按会话事件流驱动（冷启动从 checkpoint 恢复）；事件不进会话日志后投影没有数据源。"订阅改为 ctx.on" 对 replay（纯内存，可行）成立，对投影**不成立**——必须随 A1 一并裁决：投影退役（UI 经由投影读 activity 的通道消失，需给出替代读路径）还是改挂到别的驱动源。这直接决定 **P1-11 的命运**：A1 落地则双契约注册随之退役，P1-11 消解；维持 append（A2）则 P1-11 仍需修。故 P1-11 必须并入 rc.42 裁决范围。
2. **事件载荷缺 sessionId**：`EvolutionPlanAppliedEvent`（`evolution-core/src/events.ts:17-26`）无会话身份字段；`ctx.emit` 版本需要 payload v2（补 sessionId），否则 replay/activity 无法按会话归组。计划未提。

### 3.2 P1-12 与 B 线对齐证据方向相反，计划未标注

- A 线（P1-12）：前台（主 agent）创建的 skill 不标 `created_by='agent'`，默认 `manageUnmanaged:false` 下逃出 curator 生命周期——视为待决策的设计张力。
- B 线（rc39 审计 §2.2）：同一行为判 **✅ 与 H 对齐**（H 仅 review 通道标记 agent-created；前台=用户意图；开关差异"无场景"）。

两条线在此点结论互斥。整合计划 rc.45 把 P1-12 当开放产品决策，却未引用 B 线证据。在"H 对齐"作为项目目标的前提下，正确解应偏向**保持现状 + README 显式声明**（P1-12 从行为决策降为文档项，归 G8 口径）；若仍要改行为，需同时修订 B 线对齐判定表，否则 rc.45 落地即制造一条新的文档-代码漂移（F 类）。

### 3.3 rc.49 内部自相矛盾（F-2 方向 vs 决策 D2）

rc.49 写"F-2/D-4 路径统一（`packages/evolution/scripts` → 实际路径）"，暗示把文档改成镜像的 `packages/scripts/`；但同批决策 D 推荐的 **D2 恰恰以开发树（`packages/evolution/...`）为 canonical**。两者不能同时成立。D2 之下 F-2 的正确形态是：**文档保持开发树口径**，镜像 README 补一段布局说明（mirror 扁平布局 vs dev-tree 布局），normalize-mirror/publish 脚本注释更新。A 线 F-2 本身是"审计镜像"视角的产物，在 dev-tree 视角下半数不成立——计划应把 F-2 的修复方向绑定到决策 D 的结论上，而不是预填一个方向。

### 3.4 高频改动文件无管控

| 文件 | 触碰批次 | 内容 |
|---|---|---|
| `evolution-review/src/index.ts` | rc.40 / rc.42 / rc.43 / rc.46 | G1、A1、P1-3(dispose)、P1-10(记数清理) |
| `evolution-core/src/skill-store.ts` | rc.41 / rc.44 / rc.48 | P0-5 守卫、P2-5(dirOf)+G3(core helper)、G7(symlink) |

建议：计划显式列出高频文件；或将 P1-3/P1-10 提前与 rc.42 合并为"review 层专项批"，减少四批反复回归同一文件的冲突面。同理 **rc.46 P1-5 的"临时补发 emit"会被 rc.47 决策 C 的下沉重构整体覆盖**——已知返工，建议 rc.46 只拍板决策 C 不实施（或 rc.46/47 合批）。

---

## 4. 小瑕疵

1. **rc.41 P0-6**："或与 llm 维护方确认扩展面"应删——插件无权扩展上游封闭联合（`packages/llm/llm/src/types.ts:376`），移除 `purpose` 是唯一可执行项，留选项只会拖批。
2. **验收环境未声明**：B 线五连（定向 vitest → `tsc -b tsconfig.host.json` → oxlint → 全量 → CI）跑在 deepseek-harness 开发树；A 线部分验收（"干净目录 `npm i` 可解析加载"（P0-4）、"tsc 对 0.1.1-rc.2 类型零报错"（P0-6）、resume e2e（P0-1））需要声明运行位置与 fixture——尤其 P0-1 的"任何部署下可 resume"需要**带持久化的 resume e2e**，现有五连未必覆盖，rc.42 应新增该验收物。
3. **P0-1 的暴露窗口**：rc.41 与 rc.42 分批期间每个 review 触发都在继续产生不可 resume 的会话日志。两批保持独立回滚粒度可以理解，但建议计划注明"rc.41/42 同周内连发"或给 rc.41 加临时止血（如 feature flag 关闭 session.append）。
4. **rc.49 对 D-1 的表述**已正确合并两线口径（B 线 rc.30 曾视 JsonState 为机制引用、A 线指出零调用未删）——但删除后 B 线审计 §2.9"解析兜底=JsonState.mergeDeep ✅"一行将失锚，G8 文档批应顺带更新该行。

---

## 5. 修订建议（6 条动作，对应批次）

| # | 批次 | 动作 |
|---|---|---|
| 1 | **rc.42 扩围** | 并入 P1-11 裁决；删除"记数迁 evolution-state 是 A1 必要条件"表述（降级为与 P1-10 合并的可选加固）；补事件 payload v2（sessionId）与 activity 投影退役/改道方案；新增"带持久化的 resume e2e"验收物 |
| 2 | **rc.45 调整** | P1-12 以 B 线 §2.2 H-对齐证据为输入降级为文档决策（默认"保持现状+声明"）；并入 origin 统一（A 线 M2-2.3）与 create 记账（M3-3.3）；顺带 P2-11（policy.json 删/实现二选一） |
| 3 | **rc.46 调整** | P1-5 改为"只拍板决策 C，不实施"；P1-10 scope 与 rc.42 结论联动复核；风险表 P2-9 与 P1-11 拆分 |
| 4 | **rc.43/44/48 顺带** | P2-10→rc.43；P2-8→rc.44；P2-14→rc.48 |
| 5 | **rc.49 修正** | F-2 方向绑定决策 D2（文档保持 dev-tree 口径 + 镜像布局说明）；补 D-9（capability 调用面二选一）、F-4/F-6/F-7；显式声明"M0-0.1 由决策 D2 取代"；更新 B 线审计 §2.9 JsonState 行 |
| 6 | **全文增补** | 高频改动文件清单（review/index.ts、skill-store.ts）+ 各批验收运行环境声明（五连在开发树；镜像仅发布）+ rc.41/42 连发或临时止血说明 |

---

## 6. 结论

整合计划完成了两线合并中最难的部分——**盲区交叉点的识别（rc.42 P0-1）与同层合并的排序**，事实纪律经抽查合格。修订上述 6 处后（其中 3 处是实体遗漏的补排期、3 处是论证/矛盾修正），本计划可作为 rc.41 起的唯一执行排期。评审未发现需要推翻合并框架本身的问题。
