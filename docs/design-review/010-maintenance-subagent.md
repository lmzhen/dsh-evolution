# 010 — 维护子代理（用户命令唤起的域/层漂移审查）

> 状态：设计稿（评审通过，待 Phase 1 实施）
> 日期：2026-09-02
> 前置：000-009 设计稿族约定；基于测评脚本与技能库实证的元层面归因（§2）
> 关联：008（结构健康闭环）、009（统一变更内核）；与 curator/review 的边界见 §8

## 1. 背景与问题

技能库在长期演化中出现两类结构退化（已实证）：

- **域漂移**：主题域结构退化——类级伞形碎裂为窄技能（PR 号/错误串/日期/会话产品名）、同域近重复组未合并、孤立新域入侵。
- **层漂移**：同一知识在「SKILL.md 正文 / `references|templates|scripts` 支持文件 / 记忆」三层间错位——正文 log 化（日期/sha/实录密集）、实录未沉淀、模式被沉底进支持文件、支持文件存在但正文无指针、同一事实多地重复表述。

**实证（2026-09-02 实测）**：本机自维护技能库 104KB / 153 处 rc 引用 / 39 处日期 / 双份 `## 已知 bug 模式` 标题 / 3 行 >1500 字符——技能库自身就是域/层漂移的活样本；这些结构与"测评脚本 diff.json 的质量差异"无因果关系（diff 差异由评测环境不对称产生，见 §2）。

## 2. 元层面归因（方案的设计依据）

对"测评脚本（dsh_hermes_diff.py）+ 沉淀技能库"暴露的问题做系统性归因，得到 4 类提示词元层面缺陷——**本方案的所有机制都是这 4 类的反制**：

| 类别 | 定义 | 实证 |
|---|---|---|
| P1 评判标准缺失 → 代理指标替代 | 审查者没有"被审对象的好标准"时自动用可观测代理（长度/丰富度），且权重不稳定 | judge 无 rubric：28 字符 vs 464 字符 → 2-3 分 vs 4-5 分，同时抱怨"更 verbose 扣分"——同产物加减分并存 |
| P2 机制/提示错置 | 该机械化的规则写成提示 = 执行率≈0；凡进 validator/schema/guard 的被执行 | "单行超长禁令/净增 2KB/实录迁引用"全部写了全部未执行（104KB 现实）；read-before-write 因进了 filterUnreadSkillOps 才被执行 |
| P3 审查者效用函数错位 | 奖励"产出"而非"正确判断"；优化局部增量而非系统收益 | 审查提示 "Be ACTIVE / missed learning opportunity" 与 "Nothing to save 是合法选项" 自相矛盾 |
| P4 溯源与验证缺口 | 评产物不看来源、评机制不看触发、写入无意图标注 | judge 评"真实 home 预存内容"为本次产出；评测未验证 review 通道是否被触发；写入无 PATTERN/LOG 标注 → 事后靠猜"锚 vs 残留" |

**机械层铁律**：机械层职责 = 契约完整性（建议是否成形），**不是**语义正确性（建议是否成立）。机械层守门（拒绝含糊/无据/越权），永不裁决（何时该建议、建议是否成立）；机械信号与语义判断冲突时只能 "flag + 升人审"，决不是 "拒绝"。

## 3. 方案总览：三部分 + 用户命令唤起

```
/evolution maintain [scope]
  └─ ② 确定性扫描（evolution-maintenance）：只读、单次快照、信号级隔离
      └─ 渲染 MECHANICAL_FACTS 块（签名 = bundle_v + signals_v + sha256）
          └─ 子代理（① 模板 M + 事实块；工具面 ['skill','skill_load','maintenance_probe']）
              └─ plan(JSON) → 校验器（引用闭合/写保护/必填矩阵）
                  └─ 展示给用户（每条建议 + evidence 链路 + 可逆性）
                      └─ 用户挑选 → 现有命令执行（consolidate / restructure 审批链 / curator run）
```

| 部分 | 形态 | 角色 |
|---|---|---|
| ① 操作指引（模板 M） | core bundle 内的 LLM 文本 | 语义条款 + 边界示例——"应该怎么处理" |
| ② 机械事实注入 | 确定性脚本聚合 → 事实块 | "有什么不合规"（事实契约，可测） |
| ③ 可选机械脚本 | `maintenance_probe` 只读工具 | "怎么确认细节"（按需深挖，只增强上限） |

**分工红线**：② 只出"事实"（零裁决动词）；③ 只出"数据"（详情 JSON）；"结论"由 ① 出（semantic_reasoning/recommendation）；执行一律走现有命令。

## 4. 信号初版定义（signals.ts，单源）

信号归属只分 **A（域）/ B（层）**；`usage_observed`、`quality_low` 为**环境信号**（上下文事实，非漂移判定）。阈值 = 包内 Config 默认（可 profile 覆盖）。

| id | 源 | 复用/新写 | 阈值 | 归属 |
|---|---|---|---|---|
| `dedup_group` | `computeDedupGroups`（core 已有） | 复用 | 组 ≥2 → over | A |
| `prefix_cluster` | `computePrefixClusters`（已有） | 复用 | 簇 ≥3 → over | A |
| `narrow_name` | 命名正则（PR 号/错误串/日期/audit-诊断形态） | 新写 | 正则命中 → over | A |
| `stamp_density` | SkillHealth（已有） | 复用 | >2.0/KB 且 body≥2000 → over | B |
| `body_size` | SkillHealth（已有） | 复用 | >40KB → over | B |
| `dup_heading` | 章节标题重复检测 | 新写 | count≥2 → over | B |
| `overlong_line` | 行长检测 | 新写 | 行 >1500 → over | B |
| `pointer_missing` | SUPPORT_DIRS 存在而正文无文件名引用 | 新写 | 存在支持文件且正文 0 引用 → over | B |
| `description_chars` | `authoringFeedback`（已有） | 复用 | >60 → over | B |
| `usage_observed` | usage 服务 | 复用 | 窗口未开 → pass（事实） | 环境 |
| `quality_low` | quality 因子 | 复用 | <0.3 → over | 环境 |

**归 LLM 语义层（不机械判）**：`pattern_sunk`（模式沉底）、`dup_fact`（同一事实多处表述）——只作 `contextual` 证据，`confidence≤0.4 + needs_human`。
**信号集开放**：事实块含、条款未列的信号 → notes 区建议新增条款（模板 §6），不产生建议。

## 5. 提示词模板 M

> 渲染约定：`{signal:id}` / `{signal:id.threshold}` 由 signals.ts 单源替换（模板与事实块共享同一词表与阈值，无硬编码）；模板头与事实块头由同一渲染函数产生，签名一致。

```
<<<MAINTAIN_PROMPT v={bundle_version} sig={joint_signature}>>>

## 角色
你是技能库维护审查代理。基于机械事实块与本文规则，识别技能库的域漂移与层漂移，
输出结构化维护计划。你只输出计划，从不执行；执行由用户命令与审批完成。

## 1. 输入契约（最高优先级，冲突时以此为准）
机械事实块 <<<MECHANICAL_FACTS v={signals_version} sig={joint_signature}>>>（下方）是
唯一证据来源；每条信号的名字、阈值、verdict 与本文规则引用一一对应。
- verdict 语义（枚举，不可引申）：pass=未越阈；over=越阈；under=低于阈；unknown=脚本未检测。
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
环境信号（不单独触发建议，仅作上下文）：{signal:usage_observed}、{signal:quality_low}——
quality_low 只影响"是否值得动结构"的判断，quality_low 本身不构成建议理由。

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
  正文；会话专属实录 → 建议保留并补正文指针。
- B3 当 {signal:dup_heading}=over：建议收敛重复章节（合并/删除冗余），skill-level。
- B4 当 {signal:overlong_line}=over：建议拆行长（每行 ≤1500），skill-level。
- B5 当 {signal:description_chars}=over：建议缩短 description 到 ≤60，skill-level；
  不得建议改动正文其他部分（描述契约不影响正文合法性）。

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
   recommendation: "<唯一允许的'应'句：建议动作与理由>",
   semantic_reasoning: "<语义判据；含 LLM 推断时 confidence≤0.4>",
   impact: "better|worse|neutral", impact_reason: "<相对'不动'的净影响>",
   reversibility: "archive|restructure|rename|none", undo_path: "<一步撤销方式>",
   confidence: float,  // machine ≥0.6；contextual ≤0.4
   needs_human: bool, is_override: bool, override_reason: "<仅 is_override>" }],
 notes: [str]}
- verdict=no_issues ⇒ plan=[]（机械判定，不允许空 plan 之外的"无问题"表述）。
- 校验器拒绝：无 evidence 项 / 引用事实块外信号 / 无 impact / 无 semantic_reasoning /
  任何 mutation 字段 / is_override 无 override_reason / verdict=no_issues 但 plan 非空。
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
- 条款同构扩展：新增检查 = signals.ts 加定义 + §3 加一条"信号→语义→输出"条款。
- 库规模无关：判据是事实与条款，不是库体量印象。
- 信号机制疑问（阈值、检测原理）→ 写 needs_human，不猜测机制。
```

## 6. 机械层实现要点

- **扫描器（scan.ts）**：只读、单次全库快照；**信号级 try/catch**（单信号失败 → 该行 `[ERROR]`，不拖垮全扫描）；未知目录结构 fail-safe 输出 `unknown` 而非报错；纯函数主体。
- **渲染（render-facts.ts）**：事实块与模板头同源产生联合签名 `sig = sha256(模板原文 + 信号定义表序列化)`；`signals_version` 信号集变更即递增。
- **校验器（validate-plan.ts）**：zod schema + §5 模板输出契约的拒绝矩阵逐条实现；**引用闭合**（evidence.signal ⊆ 事实块信号集）；拒绝时输出结构化失败报告（哪项、哪字段、为何拒）——不是静默。
- **probe 工具（tools.ts）**：只读，复用 scan 详情函数（与事实块单源派生），输出 JSON；子代理工具面白名单 `['skill','skill_load','maintenance_probe']`（无任何写工具）。

## 7. 自洽性方案（四道编译期测试 + 签名捆绑）

| # | 测试 | 断言 |
|---|---|---|
| ① | 词汇断言 | 模板全部 `{signal:id}` 解析成功；渲染文本零残留占位符；verdict 词表与条款词表集合相等 |
| ② | 无孤儿/无悬空 | 事实块每个信号至少被一条条款引用；模板每条 `{signal}` 在信号定义中存在 |
| ③ | 示例可复算 | 模板 §5 示例的 fixture 技能库跑真实扫描 → 输出与示例逐字段一致（示例值全渲染，无硬编码） |
| ④ | plan 引用闭合 | plan.evidence 信号 id ⊆ 本次注入信号集（校验器，编译期+运行时双保险） |

**版本捆绑**：`sig = sha256(模板原文 + 信号定义表)` + `bundle_version` + `signals_version`。部署侧本地校验失配 → 不发起模型调用直接报 MISMATCH；模型侧协议见模板 §1。**发布纪律：维护功能发布 = core（bundle 升版）+ evolution-maintenance（signals 升版）同版发布**（5 包同版本先例）；signals 或模板任一变更必须同步升 signals_version / bundle 并跑四道测试。

## 8. 架构决策与边界

| 决策 | 内容 | 理由 |
|---|---|---|
| D1 归属 | 新包 `evolution-maintenance`，不并 core/curator | 信号面跨包消费；core = 纯底层常量/纯函数；与 curator 生命周期不同（curator 自动、maintain 仅命令） |
| D2 执行边界 | maintain **只诊断不执行**；执行复用 consolidate / restructure 审批链 / curator run | 不建第二套执行面（"先不做自动化治理"） |
| D3 版本 | 模板 M 入 core PROMPT_BUNDLE（v9→v10，新增 entry 只加不减）；signals 在 maintenance | 沿用 fail-closed 惯例；联合签名防跨包漂移 |
| D4 与 review/curator 分工 | review=会话级审查（读标记）；curator=生命周期+合并执行；maintain=库级诊断+建议 | 三者信号共享（signals.ts 唯一源），判定逻辑不复制 |

**鲁棒性**：信号级隔离；unknown≠pass 进契约；fail-closed（subagent 失败/签名失配/校验失败显式报错，无静默降级——**不做主会话 inject 回退**，回退会丢 outputSchema）；单次快照一致性；零写路径。
**可扩展性**：信号表驱动；条款三要素同构；probe 详情与摘要单源；scope 参数预留（先全库）。
**易维护性**：依赖单向（commands→maintenance→core）；纯函数主体；模板与信号同渲染函数；版本钉两件套免人工漂移检查。

## 9. 分步实施路线（3 个独立可验收增量 + 程序期发布）

### Phase 1 — 确定性底座（无 LLM 面）
- signals.ts + scan.ts + render-facts.ts（新检查 5 项纯函数）。
- 测试：fixture 库扫描快照断言；**示例可复算测试**（自洽测试③在此落地）。
- 验收：真实库扫描，人工核对每条信号值（104KB/153rc/双标题/3 长行全部被检出）。

### Phase 2 — 功能主板（命令+模板+子代理+校验器）
- commands 加 `maintain [scope]`；core prompts.ts 加 `MAINTAIN_PROMPT` → **bundle v10**（改 prompts.spec 后必须跑 prompts.spec —— rc.60 教训）；plan-schema.ts + validate-plan.ts（引用闭合/写保护/必填矩阵）；service 编排（scan→render→subagents.start→校验→展示）。
- subagent 失败 fail-closed 报错（不回退主会话——plan 无 schema 保障）。
- 事件：`appendEvolutionEvent({type:'maintain', source:'manual'})`（learn 先例）。
- 测试：命令契约（断言 `{kind,text}` 包装——rc.28 教训）；validator 拒绝矩阵逐类一例；anchored-smoke（fake subagents.start 返回 structured plan——review 样板）；MISMATCH 场景（错误签名 → 不发起模型调用）。

### Phase 3 — 可选深挖通道（probe）
- tools.ts 注册 `maintenance_probe`（只读、单源详情、JSON 输出）；子代理白名单限定。
- 测试：probe 输出与信号摘要字段一致（单源断言）；写路径零暴露。

### Phase 4 — 自洽硬化 + 发布
- 四道测试固化 CI；`signals_version` 变更纪律；**程序期 main-only（CI 双绿门禁、publish 跳过），完成一次性 minor = 0.3.0**（特征批=minor 先例）。

## 10. 风险清单

| 风险 | 缓解 |
|---|---|
| LLM 语义层误判（下限依赖信号覆盖） | 下限=确定性信号（Phase 1）；误判经 needs_human / is_override / reversibility 全部上升为可见——不静默执行 |
| 模板与信号词表漂移 | 四道编译期测试（非人审） |
| 库结构演进使扫描器过期 | 未知结构 → unknown（fail-safe）；模板 §6 开放条款；输出附 signals_version 供排查 |
| token 成本（≈3-5K/次） | 低频用户命令；文档写明预期；probe 按需 |
| 与 curator 重叠 | 共享 signals.ts 唯一源；判定逻辑不复制；边界见 D4 |
| 破坏既有 bundle 语义 | 模板 M 新增 entry 只加不减；旧 worker 不受影响 |

## 11. 验收标准（汇总）

1. Phase 1：真实库全信号正确检出（含全部已知异常）；
2. Phase 2：`/evolution maintain` 产出结构化 plan；verdict=no_issues 与 verdict=issues 两态可达；MISMATCH 正确拦截；
3. Phase 3：probe 深挖改变某条建议的 confidence（被语义层真实利用而非摆设）；
4. Phase 4：四道自洽测试 CI 全绿；0.3.0 程序发布闭环。
