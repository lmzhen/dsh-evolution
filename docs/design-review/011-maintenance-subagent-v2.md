# 011 — 维护子代理（v9 评审修订版；取代 010）

> 状态：设计稿修订版（本次修订回应第九轮审计的 4 阻塞 + 4 应改 + 3 应答；审计报告已从仓库归档至维护者文档）
> 日期：2026-09-02
> 前置：010（初版，已归档）、第九轮审计（评审，已归档）；000-009 设计稿族
> 修订原则：每项评审意见给出**裁决 + 理由**；本稿独立完整（含修订后模板 M 全文），无需对照 010 拼接

## 0. 修订记录（v9 → 本稿变更对照）

| 评审项 | 裁决 | 本稿落点 |
|---|---|---|
| F-1 执行映射缺口 | **采纳，分层处理**：B3 走 patch 指引、B2/B4/B5 走 patch 指引、补 restructure 用户命令面 | §9 |
| A1 signals 归属冲突 | **采纳**：落 core、改名 `drift-signals`（与 review 门 `signals.ts` 显式区分） | §4、§12-D1 |
| F-2 工具面错误 | **采纳**：`['skill','maintenance_probe']` | §6、§12 |
| F-4 prefix_cluster 阈值 | **裁决：采用 ≥2（与实现对齐），不引入新参数**——信号定义镜像实现语义，参数化反而制造分叉 | §4 |
| A5 信任边界 | **采纳**：威胁模型小节 + `redact` 下沉 core 供事实块/probe 使用 | §8 |
| A4 plan 短暂性 | **裁决：事件载荷存摘要 + runId 回引；不建 state 表**（见 §10 理由） | §10 |
| A6 并发/超时 | **采纳**：照抄 curator `running` 门 + review `timeoutMs` 先例 | §7 |
| A7 root/quality_low | **采纳**：扫描根入对齐故事；quality_low 接观测窗口门（窗口未开=unknown） | §4、§7 |
| A2 评估面总表 | **采纳** | §5 |
| A3 bundle 演进 | **裁决：维持 core bundle（不实现贡献式 entry），记录取舍**——理由见 §11 | §11 |
| A8 备选论证 | **采纳**（三备选逐一裁决） | §12 |
| F-3/F-5/F-6 | **采纳**：口径/措辞/隔离带裁定 | §1、§6、§9、§14 |

## 1. 背景与问题

技能库长期演化出现两类结构退化：**域漂移**（类级伞形碎裂为窄技能/近重复组未合并/孤立新域）与**层漂移**（正文 log 化/实录未沉淀/模式沉底/支持文件无指针/同事实多处表述）。

**实测测量契约（F-5 口径，评审/维护一律以此为准；计数一律注明范围）**：
- **单技能锚**（`dsh-evolution-maintenance/SKILL.md`，2026-09-02 实测）：105,367B；rc 引用 **168**（`rc\.\d+` 全量口径——`rc\.[0-9]{2,}`=153 会漏掉 rc.1-9 一位数，**凡引用 rc 计数必须用 `\d+` 全量口径**）；日期 40；双份 `## 已知 bug 模式`（29-30 行）；3 行长行（6889/2131/1672 字符）。
- **库级参考**（同刻实测）：6 个 SKILL.md 合计 131,578B、rc 174；25 个 .md 合计 rc 491；全部文件 41 个，**排除 `.backups/`（13 个文件）后 28 个**——文件计数默认排除归档区（`.archive/`/`.backups/`）。
- **漂移事实**：单技能 rc 计数在 010→011 之间已从 153（旧口径）→168（全量口径）——**任何验收不得钉死活数字**（契约锚用于口径一致性，验收用 fixture 精确断言 + 真实库触发断言，见 §13/§15）。

## 2. 元层面归因（方案设计依据，同 010）

P1 评判标准缺失→代理指标替代；P2 机制/提示错置→执行率≈0；P3 审查者效用错位→局部增量>系统健康；P4 溯源与验证缺口。
**机械层铁律**：机械=契约完整性（守门），不=语义正确性（裁决）；冲突→flag+升人审，不拒绝；`over≠违规`、`unknown≠pass`、事实只读、阈值=证据门非判据。
（A8 论证，见 §12 备选考量。）

## 3. 方案总览（修订后数据流）

```
/evolution maintain [scope]
  └─ ② drift-scan：只读、单次快照、信号级隔离、root 对齐、观测窗口门
      └─ 渲染 MECHANICAL_FACTS 块（redact 脱敏 + 联合签名）
          └─ 子代理（① 模板 M + 事实块；工具面 ['skill','maintenance_probe']，无写工具）
              └─ plan(JSON) → 校验器（引用闭合/写保护/必填矩阵）
                  └─ 事件记录（type:'maintain'，载荷=摘要 + runId） + 展示
                      └─ 用户挑选 → 现有/新增命令执行（§9 映射表；命令可带 --plan <runId> 回引）
```

| 部分 | 形态 | 角色 |
|---|---|---|
| ① 操作指引（模板 M） | core bundle 内 LLM 文本 | 语义条款 + 边界示例——"应该怎么处理" |
| ② 机械事实注入 | 确定性扫描聚合 → 事实块 | "有什么不合规"（事实契约，可测） |
| ③ 可选机械脚本 | `maintenance_probe` 只读工具 | "怎么确认细节"（按需深挖，只增强上限） |

分工红线不变：② 只出事实；③ 只出数据；结论由 ① 出；执行走命令/审批。

## 4. 信号定义（修订：drift-signals）

**命名与归属（A1 采纳）**：新模块 `evolution-core/src/drift-signals.ts`——与 core 既有 `src/signals.ts`（review 节奏信号门：`observeEvent/advanceReview/foldTurn/TurnSignals`，语义完全不同）**显式区分**；信号定义（纯函数 + 阈值表）落 core（与 quality.ts/skill-health.ts 同层），`evolution-maintenance` 只做 scan/render/validate/probe 编排——D1 依赖单向（commands→maintenance→core）与 D4 共享（curator/review 从 core 导入）同时成立。

| id | 源 | 复用/新写 | 阈值（修订） | 归属 |
|---|---|---|---|---|
| `dedup_group` | `computeDedupGroups`（core:175 `group.length > 1`） | 复用 | 组 ≥2 → over | A |
| `prefix_cluster` | `computePrefixClusters`（core:197 `members.length >= 2`） | 复用 | **簇 ≥2 → over**（F-4 裁决：镜像实现，不引入 ≥3 新参数） | A |
| `narrow_name` | 命名正则 | 新写 | 正则命中 → over | A |
| `stamp_density` | SkillHealth（`stampDensityPerKb: 2` + `MIN_STAMP_BODY_CHARS=2_000`，skill-health.ts:27/40） | 复用 | >2.0/KB 且 body≥2000 → over | B |
| `body_size` | SkillHealth（`softBodyChars: 40_000`） | 复用 | >40KB → over | B |
| `dup_heading` | 标题重复检测 | 新写 | count≥2 → over | B |
| `overlong_line` | 行长检测 | 新写 | 行 >1500 → over | B |
| `pointer_missing` | SUPPORT_DIRS 存在而正文无引用 | 新写 | 存在支持文件且正文 0 引用 → over | B |
| `description_chars` | `authoringFeedback`（`AUTHORING_DESCRIPTION_BAR=60`） | 复用 | >60 → over | B |
| `usage_observed` | usage 服务（`usageObserved`，usage.ts:236） | 复用 | 窗口未开 → pass（事实） | 环境 |
| `quality_low` | 侧车 `quality_score`（六因子（curator run 重算）与反馈分统一收口字段）；分缺失=unknown（窗口门语义：未落盘=不可信） | 复用 | <0.3 → over | 环境 |

**归 LLM 语义层**：`pattern_sunk`、`dup_fact`（contextual 证据，confidence≤0.4 + needs_human）。
**信号集开放**：事实块含、条款未列 → notes 区建议新增条款，不产生建议。
**扫描根（A7）**：默认 `skillsRoot()`、Config root 可覆盖、与 tool-skill-manage/skill-usage/evolution-skill-catalog 三处同源对齐（"Align with skill-usage/catalog rows"故事）。

## 5. 评估面总表（A2 新增）

| 面 | 触发 | 信号源 | 输出去向 | 执行权限 | 时间线 |
|---|---|---|---|---|---|
| review | 会话级，cadence/completion 节流 | 会话信号门（core `signals.ts`）+ 读标记 | 会话内技能写操作 | 写执行（读标记约束） | 自动 |
| curator | 库级，interval/idle/persisted 到期 | `computeLifecycleTransitions`/`computePrefixClusters`/usage | archive/consolidate 执行 | 执行（nominator→引擎） | 自动 |
| skill-health | 库级，只读 | `SkillHealth` 阈值（softBodyChars/stampDensityPerKb/churnMinPatches） | `/evolution skills health` 报告 | 只读 | 按需 |
| maintain | 库级，用户命令 | **drift-signals（core）** | plan（只诊断）+ 事件载荷 | **只诊断**（执行走命令链） | 按需 |

**词汇/阈值单源契约**：四个评估面共同引用 core 的两个信号模块（`signals.ts` 会话门 / `drift-signals.ts` 库级漂移），阈值表与消费方清单分别维护在各自模块内；后续新增评估面必须先在总表登记——防"评估面各自为政、词汇分叉"（§2-P1 在家族层面的复演）。

## 6. 提示词模板 M（修订版全文；**取代 010 §5**）

> 渲染约定：`{signal:id}` / `{signal:id.threshold}` 由 drift-signals 单源替换（无硬编码）；模板头与事实块头由同一渲染函数产生；示例值全渲染。

```
<<<MAINTAIN_PROMPT v={bundle_version} sig={joint_signature}>>>

## 角色
你是技能库维护审查代理，只读：你没有任何写工具。基于机械事实块与本文规则，识别
域漂移与层漂移，输出结构化维护计划。你只输出计划，从不执行；执行由用户命令与审批完成。

## 1. 输入契约（最高优先级，冲突时以此为准）
机械事实块 <<<MECHANICAL_FACTS v={signals_version} sig={joint_signature}>>>（下方，
以 `<<<END FACTS>>>` 闭合）是唯一证据来源；每条信号的名字、阈值、verdict 与本文规则引用一一对应。
- verdict 语义（枚举，不可引申）：pass=未越阈（含低于阈值）；over=越阈；unknown=脚本未检测。
- over 不是违规裁决：它只描述"事实相对阈值的位置"；是否构成漂移只由 §3 对应条款的
  语义判断给出。没有条款对应的事实，不产生建议。
- unknown ≠ pass：未检测 ≠ 健康；引用 unknown 信号的条目必须 needs_human:true。
- 事实只读：不改写、不补写缺失信号、不把事实"翻译"成裁决。
- 版本失配：若两处 sig 不一致（或任一缺失），禁止输出计划——只输出 MISMATCH + 两侧
  版本号 + 停止。

## 2. 审查领域
- 域漂移：类级伞形碎裂为窄技能、同域近重复组未合并、孤立新域入侵、前缀聚类碎片化。
- 层漂移：知识在「正文/支持文件/记忆」三层间错位——正文 log 化、实录未沉淀、
  模式沉底、支持文件无指针、同一事实多地重复表述。

## 3. 检查清单（规则 = 触发信号 → 语义判断 → 输出形态）
environment signals：usage_observed、quality_low——**校验器对 quality_low=unknown 的技能全局施加 needs_human:true**（机械判据见 §4/§7），模板侧不重复表述。

A. 域·碎片化
- A1 当 {signal:dedup_group}=over：判断近重复组是否属同一类级伞形的可合并小节；
  是 → relationship-level consolidate 建议；否 → 不输出。
- A2 当 {signal:narrow_name}=over：结合 description/正文语义判窄名是否"仅对今日任务成立"；
  成立 → skill-level 改名/归档建议；若实为用户内部代号（格式合规语义窄）→ contextual
  证据、confidence≤0.4、needs_human:true。
- A3 当 {signal:prefix_cluster}=over：判簇内技能是否同伞；非同伞 → notes 区提出域划分
  观察，不强制建伞。

B. 层·分层错位
- B1 当 {signal:stamp_density}=over 或 {signal:body_size}=over：逐技能判时间戳/编号为
  追溯锚（跨文档检索锚）还是日志残留（过程叙事/状态快照）；
  锚 → 允许保留，semantic_reasoning 列明判据，needs_human:true；
  残留 → restructure 建议（movable headings 逐字引用）。over 是开关，不是结论。
- B2 当 {signal:pointer_missing}=over：检查支持文件内容形态——可复用模式 → 建议上移
  正文；会话专属实录 → 建议保留并补正文指针。输出为 patch 指引（§9 执行形态）。
- B3 当 {signal:dup_heading}=over：建议删除多余标题行（保留一份），输出为 patch 指引。
- B4 当 {signal:overlong_line}=over：建议拆行，输出为 patch 指引。
- B5 当 {signal:description_chars}=over：建议缩短 description 到 ≤60，输出为 patch 指引；
  不得建议改动正文其他部分。

D. 库·整合纪律（计划形态约束，不是信号）
- D1 同类问题多处出现 → 合成一条 relationship-level 建议，不逐项输出。
- D2 结构类问题优先级高于内容类；影响面 library-level > relationship-level > skill-level。

可选工具：maintenance_probe（只读）——按需深挖信号详情（单技能全文密度分布、簇完整
成员、指针明细）；探针输出仅用于补充判断（影响 confidence/semantic_reasoning），
不得引入事实块之外的新证据 id。

## 4. 输出契约（校验器机械执行）
{verdict: "issues" | "no_issues",
 plan: [{ kind: "skill-level"|"relationship-level"|"library-level",
   names: [str], rule: "A1"|"B2"|...,
   evidence: [{signal, value}],  // 必须逐字来自事实块；禁止引用事实块外信号
   finding: "<一句事实描述：引用信号 id 与值；零裁决动词>",
   recommendation: "<唯一允许的'应'句：建议动作与理由；并写明执行形态（命令/patch 指引）>",
   semantic_reasoning: "<语义判据；含 LLM 推断时 confidence≤0.4>",
   impact: "better|worse|neutral", impact_reason: "<相对'不动'的净影响>",
   reversibility: "archive|restructure|patch|rename|none", undo_path: "<一步撤销方式>",
   confidence: float,  // 判据见下
   needs_human: bool, is_override: bool, override_reason: "<仅 is_override>" }],
 notes: [str]}
- confidence 判据（F-6 裁定，消除隔离带空洞）：机器证据项 ∈ [0.6, 0.9]；contextual 项 ≤0.4；
  **无第三区间**——needs_human = (confidence < 0.6) OR (不可逆) OR (is_override) OR
  (引用 unknown 信号)。
- verdict=no_issues ⇒ plan=[]（机械判定，不允许空 plan 之外的"无问题"表述）。
- 校验器拒绝：无 evidence 项 / 引用事实块外信号 / 无 impact / 无 semantic_reasoning /
  任何 mutation 字段 / is_override 无 override_reason / verdict=no_issues 但 plan 非空 /
  needs_human 与 confidence 判据冲突。
  被拒是契约问题，不是语义失败——修正形态而非删除理由。
- 语言：finding/recommendation/notes 用与库一致的正文语言（中文）；字段名/信号 id/枚举
  保留英文。

## 5. 裁决纪律
- 禁用："根据注入事实 X，该技能应当 Y"——事实段没有"应当"权限。
- 锚 vs 残留示例：✅ 当 {signal:stamp_density}=over（{signal:stamp_density.threshold} 阈）
  且时间戳为跨文档检索锚 → B1：不迁，needs_human，semantic_reasoning=锚判据。
  ❌ 当 {signal:stamp_density}=over → "该技能日志化，应 restructure"（over 是开关不是结论）。
- 申诉：机械阈值与语义判断冲突 → is_override:true + override_reason + needs_human:true；
  不得静默绕过阈值。
- 不动作合法：verdict=no_issues 是合法输出，不是失败；连续空报告 = 信号定义问题，
  不是"更积极"的信号。
- 错误成本：不可逆动作（rename）必须 needs_human:true；可逆动作（archive/restructure
  两阶段）可 needs_human:false 但 undo_path 必填。
- 不做：不建议删除（只建议 archive）；不提升内容质量（结构审查只 flag 位置/归属/分层）；
  protected 集（bundled/hub 安装/pinned）内 0 建议。

## 6. 泛化注意事项
- 信号集开放：事实块含、§3 未列的信号 → notes 区提出"该信号值得新增条款"，禁止
  解释为"已知问题"。
- 条款同构扩展：新增检查 = drift-signals 加定义 + §3 加一条"信号→语义→输出"条款。
- 库规模无关：判据是事实与条款，不是库体量印象。
- 信号机制疑问（阈值、检测原理）→ 写 needs_human，不猜测机制。
```
（**以 core `MAINTAIN_PROMPT` 常量为实现基准**；本文为语义基准，占位符渲染见 §7）

模板变更点（vs 010 §5）：角色加"只读：无任何写工具"；quality_low=unknown 时默认人审；B2-B5 输出形态明确为 patch 指引；confidence 三区间归并为两区间+needs_human 判据；recommendation 要求写明执行形态。

## 7. 机械层实现要点（修订）

- **drift-scan.ts**：只读单次全库快照；信号级 try/catch（单信号失败→`[ERROR]` 行，不拖垮）；未知结构 fail-safe `unknown`；纯函数主体；**root 对齐**（默认 `skillsRoot()`、Config 覆盖、三处同源注释）。
- **render-facts.ts**：事实块与模板头同源产生联合签名 `sig = sha256(模板原文 + drift-signals 定义序列化)`；**渲染前过 `redact`**（A5，见 §8）；`signals_version` 信号集变更递增。
- **validate-plan.ts**：zod schema + §6 模板拒绝矩阵（含 confidence/needs_human 一致性）；引用闭合（evidence.signal ⊆ 事实块信号集）；**quality_low 全局施加**（读事实块环境信号，quality_low=unknown 的技能所有结构建议机械置 needs_human:true——与"未知必人审"判据同源，校验器实现，不依赖模型自觉）；拒绝→结构化失败报告（哪项/哪字段/为何拒）。
- **probe 工具（tools.ts）**：只读；复用 scan 详情函数（单源）；输出 JSON；同样过 `redact`；子代理白名单 `['skill','maintenance_probe']`（无任何写工具）。
- **编排器（service.ts）**：`maintainTimeoutMs`（默认 600_000（0.3.10：真实全库扫描需 4-8 分钟，旧默认 120_000 会中途掐断——13:38 成功 run 用 `--timeout 600000`），`AbortSignal.timeout`）；**富化钩子为命令侧必接项（v11 P1-1 修订）**：descriptions（`parseFrontmatter`）、supportFiles（`SkillLibrary.listSupportFiles`）、quality（skill-usage `report()` 的 `quality_score`）、usageObserved（`usageObserved()`）——四个钩子全部现成 API；**任一服务缺失 → 对应信号 `unknown`（绝不伪造 pass）**——`supportFiles` 未枚举与枚举为空必须区分（前者 `[UNKNOWN]`，后者才允许 pass/over）。
**追加裁决（2026-09-03）**：`maintainRunning` 重入门**不实现**——maintain 是只读诊断（无写操作重入损坏风险，与 curator 的 rc.38 重复归档事故不同），并发最坏 = 双倍 token + 重复建议；用户手动命令并发面趋零。**替代方案已落地：冷却窗**（`Config.maintainCooldownMs` 默认 30s，进程内瞬态）——短时间内的连点/重发（误触场景）在窗口内被拦截（返回上次 runId + 剩余秒），**覆盖连点场景；并行/in-flight 场景不由冷却窗承担**（窗口从 run settle 后才计时——v11 所记"≥超时 120s 才无重叠窗口"论据为注释 bug，80ec941 已把 130s 降为 30s），由 0.3.11 单飞标志 `maintainInFlightSince` 覆盖（0.3.14 P2-1：设置点提前到首个 await 之前）；成功与失败都更新时间戳（防连续失败刷屏）；扫描仍可随时手动重跑（窗口默认 30s）。
**0.3.14 P3-1 数值更正**：本节数值以 code 常量为准——`maintainTimeoutMs` 默认 **600_000**、`maintainCooldownMs` 默认 **30_000**。

## 8. 信任边界与威胁模型（A5 新增）

**外送面**：事实块与 probe JSON 均出会话边界（子代理=独立 LLM 调用）；`skill` 工具使子代理可读任意技能正文。

**现实威胁**：技能正文是模型自写内容（历史上可被注入污染）——子代理读入后可能产出被偏置的建议（如推荐 archive 特定技能）。

**防护链（写明，防"新面成为例外"）**：
1. **脱敏**：`redact` 从 evolution-review 的 `redact.ts` **下沉至 evolution-core**（纯函数迁移；review 改 import，同版发布）；事实块渲染与 probe 输出均过 `redact`——与 review 通道 `redactReviewSecrets`（evolution-review:214）同构；
2. plan 无执行权（D2）——偏置最坏是错误"建议"；
3. 用户挑选 + 执行命令过既有审批/威胁链（approval/threat 已有防线）；
4. probe 影响 confidence/semantic_reasoning 的通道需在 plan 中可见（confidence≤0.4 即人审——偏置无法静默执行）。

**测试矩阵**：redact 后事实块/probe 输出不含密钥形态（复用 review redact 测试模式）；子代理工具面无写工具断言。

## 9. 执行通道映射表（F-1 新增：规则 → 执行命令 → 可逆性）

| 规则 | 建议动作 | 执行通道 | 可逆性 | 说明 |
|---|---|---|---|---|
| A1 | consolidate | `/evolution consolidate <target> <source...>`（既有） | archive 可逆 | ✅ 既有 |
| A2 改名 | rename | 无命令；**降级为仅报告**（用户手工/会话 agent 改名） | 不可逆（标记 needs_human） | 改名无既有命令面，不为它建新命令 |
| A2 归档 | archive | `skill_manage delete`（会话 agent 调工具，定向归档；`/evolution curator run` 仅"阈值命中时"间接触发，不做定向通道） | .archive 可逆 | ✅ 既有 |
| B1 残留 | restructure | **新增 `/evolution restructure <name> <heading> <to_file>`**（桥接既有 `SkillLibrary.restructure`：两阶段回滚 + origin gate + H2 锚点语义，仅暴露 20-30 行命令分支；**一次一条 move，多 move 多次调用叠加**——内核 append 语义兼容） | 两阶段可逆 | F-1 补面 |
| B3 重复标题 | 删多余标题 | **patch 指引**（`skill_manage action=patch`，用户/会话 agent 执行；推荐=会话内由 agent 调 skill_manage——机械生成 patch 的精确 old/new 不可靠，不做自动生成） | **patch 可逆**（reversibility 枚举已含 `patch`；有备份） | 裁决：不扩展 restructure 去重形态（ambiguous anchor 拒绝是语义保护的既有行为，不为它松绑） |
| B2/B4/B5 | 补指针/拆行/缩 description | **patch 指引**（同上；recommendation 写明"目标：<文件>；形态：patch/update"） | patch 可逆 | 同上裁决 |
| — | 所有执行 | 可带 `--plan <runId>` 回引（审计线索，见 §10） | — | 一致性 |

**裁决说明（平衡可维护性与落地）**：唯一新增的执行面 = restructure 用户命令（复用既有内核，成本极低）；B2-B5 全部走 patch 指引（不机械化生成 patch——fuzzy 补丁链的前科说明"机器生成精确 patch"不可靠；语义判断交给用户/会话 agent），B3 不碰 restructure 的 ambiguous 保护。

## 10. 计划状态与审计（A4：裁决=事件载荷，不建表）

- **裁决**：plan 摘要（runId、verdict、每条建议的 rule/kind/names/impact 摘要、confidence、needs_human 数）落 `type:'maintain'` 事件载荷（`appendEvolutionEvent` 既有通道，learn 先例）；**不建 state 表**——维护计划是瞬态审查产物，新建表=新持久化面+新迁移/恢复逻辑，而审计需求（"哪个建议导致这次操作"）只需 runId 回引即可满足；plan 全文可通过 `-v` 重跑或 `--plan <runId>` 回查事件载荷摘要链。
- **执行命令回引**：consolidate/restructure（新增）接受可选 `--plan <runId>`，写入调用记录/事件——审计断链闭合（§2-P4 反制）。**边界（诚实标注）**：事件日志有保留窗（007：10 归档 + 4000 active）——低频命令下实际无虞，但"审计链"承诺以保留窗为界；`--plan` 回查得到的是**摘要链**，plan 全文需重跑再生（凭 runId 从事件载荷摘要定位后重跑，或直接重跑命令）。
  **v12 修订（裁决出处化）**：`--plan` 当前实现为 **L2 人读闭合**（结果文本 `[audit] plan=<id>` 注记；`recordInput:false` 但经会话事件落盘）。**L3 机器链**（runId 写入 mutation 审计记录）在两条路径上**均零新持久化面**（`plan.auditSummary` 字段——TreeChangePlan 宿主——restructure:1089/consolidate:1001 已填 summary，仅需把 runId 拼入）——**裁决为优先级选择而非架构限制**：L1（事件载荷）+L2 已满足当前真实需求（无程序化查询消费者），L3 推迟至出现真实需求时一行接入（restructure/consolidate 同法）。
- **B2-B5 的 patch 指引**（无命令通道的建议）同样有 runId 回引栖身处（载荷摘要含条目），不落地也不丢失线索。

## 11. 自洽方案与 bundle 演进（A3 记录）

四道编译期测试不变（词汇断言 / 无孤儿无悬空 / 示例可复算 / plan 引用闭合）+ 签名捆绑（`sig = sha256(模板原文 + drift-signals 定义)` + bundle_version + signals_version）。

**A3 取舍裁定（KEEP 现状，记录判定）**：
- 备选① 包级贡献式 entry（bundle 命名空间分段 digest）：**不采纳**——现有 `verifyPromptBundle` 是全部 worker（review/curator/completion/plan 变体）的单一校验契约，改分段需改写所有校验路径，触面=全部消费方；收益仅"维护功能可独立发版"，而本项目发布惯例=全家桶同版发布（0.2.x 5 包同版本先例），无真实独立发版场景。
- 备选② maintenance 自持小 bundle：**不采纳**——模板 M 与信号定义版本本来就应联合签名（跨包版本差=部署漂移），自持小 bundle 反而拆散联合签名；且引入第二套 bundle 机制=新概念。
- **结论**：模板 M 入 core PROMPT_BUNDLE（v9→v10，新增 entry 只加不减）；**维护功能发布纪律：core + evolution-maintenance（+ commands 若变更）同版发布**；signals/模板任一变更必须同步升 signals_version/bundle 并跑四道测试。

## 12. 架构决策与备选考量（A8 新增论证）

| 决策 | 内容 | 理由 |
|---|---|---|
| D1 归属（修订） | 新包 `evolution-maintenance`（scan/render/validate/probe 编排）+ core 新增 `drift-signals.ts`（纯函数信号定义，与 `signals.ts` 区名） | 信号面跨包消费（A 域/B 层给 maintain，后续 curator 可导入）；core=纯函数层；命名区名防概念错置（A1） |
| D2 执行边界 | maintain 只诊断不执行；执行面=既有命令 + 新增 restructure 命令 + patch 指引（§9） | 不建第二套执行面 |
| D3 版本 | 模板 M 入 core bundle v10；签名联合；同版发布（§11 裁定记录） | fail-closed 惯例 |
| D4 与 review/curator 分工 | review=会话级审查；curator=生命周期执行；skill-health=只读健康；maintain=库级诊断 | §5 总表；信号源单一（core 两模块） |

**三备选论证（A8）**：
1. **纯确定性报告（无 LLM）**：可满足"事实"（Phase 1 的扫描器即产物，`/evolution maintain --facts` 可只显示事实块），但**不满足"建议"**——锚 vs 残留、同伞与否、窄名语义是语义判定（§2 归因：阈值只能给事实，裁决需要语义）；**裁决：确定性报告作 Phase 1 交付（事实面），LLM 只负责语义面**——二层各取所需，不二选一。
   **v12/v13 状态**："作 Phase 1 交付"指**扫描器代码产物**（事实面计算层交付即确定性事实保证）；`/evolution maintain --facts`（仅渲染事实块、零 LLM、不设冷却、复用富化 helper 与 `buildMaintainFacts`——与扫描同签名同渲染，永不与扫描矛盾）**已实现**（0.3.0 前补充；命令提示 `maintain --facts`）。
2. **扩展 curator `healthView` + `/evolution skills health`**：healthView 是逐技能只读健康（无跨库关系诊断），且无 LLM 语义层；库级域/层诊断需要跨技能判断（近重复/孤立域/层漂移）——**裁决：不并入**（healthView 保持只读轻量，maintain 用不同信号面）。
3. **review 通道加库级模式**：review 是会话级（读标记约束、本会话技能、cadence/completion 自动触发）；库级审查=全库+无读标记+用户命令——**裁决：不并入**（集成会破坏"先不做自动化治理"的触发面隔离；review 的读标记约束对库级语义不适用）。

**结论**：维持独立子代理流；确定性事实面（Phase 1）作为低成本底座与 LLM 语义面分离，是"为什么不用 0 token"的答辩：0 token 只能得到事实，得不到裁决。

## 13. 实施路线（修订：4 个可验收增量，F-3 措辞统一）

### Phase 1 — 确定性底座（无 LLM 面）
- `drift-signals.ts`（core）+ drift-scan.ts + render-facts.ts + **redact 下沉 core**（迁移 review redact.ts，review 改 import）+ 新检查 5 项。
- 测试：fixture 扫描快照断言（**fixture 精确断言，不钉当前库活数字**——库数字随维护漂移，见 §1）；示例可复算（自洽③）；redact 测试（§8 矩阵）。
- 验收：真实库扫描全信号检出（按 §1 测量契约口径核对信号存在性与量级方向——**断言"检出"而非"等于某值"**：双标题检出、长行检出、rc 密度 over 检出、窄名/指针等按 fixture 精确；真实库只做触发断言）。

### Phase 2 — 功能主板
- commands：`maintain [scope]` + **新 `restructure <name> <heading> <to_file>`**（桥接既有内核）+ `--plan` 回引参数（consolidate 侧可选）；core prompts.ts 加 `MAINTAIN_PROMPT` → bundle v10；plan-schema + validate-plan（含 confidence/needs_human 一致性）；service 编排（scan→render→subagents.start（`maintainRunning` 门 + `maintainTimeoutMs`）→校验→事件载荷→展示）。
- subagent 失败 fail-closed；MISMATCH 不发起模型调用；maintain 事件（摘要+runId）。
- 测试：命令契约（`{kind,text}` 断言）；validator 拒绝矩阵（含 needs_human 冲突）；anchored-smoke；MISMATCH；restructure 命令面（两端到端：命令→SkillLibrary.restructure 两阶段）；并发（already-running）。

### Phase 3 — 可选深挖（probe）
- tools.ts 注册 `maintenance_probe`（只读、redact、单源 JSON）；白名单 `['skill','maintenance_probe']`。
- 测试：probe 与摘要字段一致（单源）；写路径零暴露；redact 后无密钥。

### Phase 4 — 自洽硬化 + 发布
- 四道测试固化 CI；signals_version 纪律；**程序期 main-only（CI 双绿、publish 跳过），完成一次性 minor = 0.3.0**（特征批=minor 先例）。

## 14. 风险清单（修订）

| 风险 | 缓解 |
|---|---|
| LLM 语义层误判 | 下限=确定性信号（Phase 1）；needs_human/confidence/reversibility 全升可见；不静默执行 |
| 红act 迁移影响 review 既有行为 | 迁移=纯函数搬移+import 一行；review 既有 redact 测试回归；同版发布 |
| 新 restructure 命令面回归 | 桥接既有内核（两阶段/origin gate 不动）；两端到端测试（Phase 2 验收） |
| 模板与信号词表漂移 | 四道编译期测试 |
| 库结构演进使扫描器过期 | 未知结构→unknown；开放条款；输出附 signals_version |
| token 成本 | 低频命令；--facts 模式（0 token 事实面）可供用户先看；probe 按需 |
| bundle 混合版本 | "旧 worker 不受影响"表述更正：**混合版本部署装载期 fail-closed（既定纪律）**，本功能发布=同版全家桶、无独立线 |
| 与 curator/review 重叠 | 信号源单模块（core）；判定逻辑不复制；§5 总表登记 |

## 15. 验收标准（修订）

1. Phase 1：fixture 库扫描全信号精确断言（含双标题/长行/窄名/指针检出；不钉活数字）；真实库触发断言（信号存在性与方向正确）；redact 测试绿；
2. Phase 2：maintain 产出结构化 plan 两态（issues/no_issues）；MISMATCH/并发 correctly 拦截；**restructure 命令面端到端**（建议→命令→内核→两阶段回滚）；事件载荷含 runId 摘要；
3. Phase 3：probe 深挖改变 confidence（被真实利用）；写路径零暴露；
4. Phase 4：四道自洽测试 CI 全绿；0.3.0 程序发布闭环；v9 全部"实施前必须 + 应改"落点复核无遗漏。
