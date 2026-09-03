# dsh-evolution 第十轮评审报告：010 维护子代理设计（可行性 + 架构合理性，合并终稿）

| 项 | 内容 |
|---|---|
| 评审对象 | `docs/design-review/010-maintenance-subagent.md`（"维护子代理：用户命令唤起的域/层漂移审查"，设计稿，2026-09-02，**未入库**） |
| 核对基准 | 插件 HEAD `a5bb19b` + 上游 `dsh-upstream-0.1.1-rc.2` 平台事实 + 本机真实技能库复算 |
| 评审方法 | 可行性：逐条核对"复用"声明与实现、执行映射走查、实证数字复算；架构：分层归属/依赖方向、评估面格局、bundle 演进耦合、数据流与状态设计、信任边界、运行时健壮性、配置一致性、备选方案论证——每项均落到现有代码证据 |
| 报告说明 | 本报告合并并取代同日前稿（仅可行性版）；v1-v8 代码审计结论作为既定基线引用 |
| 约束 | 只读评审，未修改任何文件 |

**评审结论：approve-with-changes（方向批准，实施前必须解决 1 P1 + 3 P2）。**
可行性层面：方案可实施，三段式（模板 M / 机械事实块 / 只读 probe）与既有审批链、009 内核、事件时间线的衔接设计正确，自洽性方案（四道编译期测试 + 联合签名）是设计稿族的最高水准。架构层面：整体分层与家族惯例一致，但存在**一处归属矛盾牵出的命名冲突**（signals）、**评估面增殖缺统一架构声明**、**信任边界缺位（无脱敏）**、**计划状态短暂性**四项需要设计补强；PROMPT_BUNDLE 的单调演进耦合与备选方案论证缺失列为应答事项。

---

## Part I 可行性核验

### 1.1 "复用/阈值"声明核对（11 项：10 ✅ / 1 ❌）

| 信号 | 文档声称 | 实现事实 | 判定 |
|---|---|---|---|
| `dedup_group` 组 ≥2 | 复用 `computeDedupGroups` | `group.length > 1` ✅ | ✅ |
| `prefix_cluster` 簇 ≥3 | 复用 `computePrefixClusters` | 过滤为 `members.length >= 2` | ❌ 阈值矛盾（F-4） |
| `stamp_density` >2.0/KB 且 body≥2000 | 复用 SkillHealth | `stampDensityPerKb: 2` + `MIN_STAMP_BODY_CHARS = 2_000` ✅ | ✅ |
| `body_size` >40KB | 复用 SkillHealth | `softBodyChars: 40_000` ✅ | ✅ |
| `quality_low` <0.3 | 复用 quality | `LOW_QUALITY_THRESHOLD = 0.3` ✅ | ✅ |
| `description_chars` >60 | 复用 authoringFeedback | `AUTHORING_DESCRIPTION_BAR = 60` ✅ | ✅ |
| `usage_observed` | 复用 usage 服务 | `usageObserved()`（008-C）✅ | ✅ |
| `narrow_name`/`dup_heading`/`overlong_line`/`pointer_missing` | 新写 | 确无现成实现 | ✅ 合理 |

### 1.2 实证数字复算（对 `~/.dsh/skills` 真实库）

| 文档声称 | 复算 | 判定 |
|---|---|---|
| 双份 `## 已知 bug 模式` | `dsh-evolution-maintenance/SKILL.md:29-30` 连续重复 | ✅ 精确 |
| 3 行 >1500 字符 | 恰好 3 行（6889/2131/1672，同一文件） | ✅ 精确 |
| "技能库 104KB" | 实为**单技能** `dsh-evolution-maintenance/SKILL.md` = 105,367B ≈ 105KB；库整体 SKILL.md 131.6KB / 全部文件 488KB | ⚠️ 口径歧义（F-5） |
| 153 处 rc / 39 日期 | 同技能现值 168 / 40（随维护漂移）；全库口径 491 / 77 | ⚠️ 漂移 + 口径未定义 |

### 1.3 执行映射走查（检查清单输出 → 现有命令/审批链）

| 规则 | 建议动作 | 现有执行通道 | 判定 |
|---|---|---|---|
| A1 近重复合并 | relationship-level consolidate | `/evolution consolidate`（append/reference 双模式，009） | ✅ |
| B1 残留迁引用 | restructure（单锚 H2） | review 计划 / `skill_manage action=restructure`；**无用户命令** | ⚠️ |
| B3 重复章节收敛 | 合并/删除冗余 | **restructure 对重复标题直接拒绝**（`planRestructureSections` "ambiguous anchor"，有测试钉住） | ❌ 无通道 |
| B2 补正文指针 / B4 拆行 / B5 缩 description | patch / update | 不在 §3 所列三通道（consolidate / restructure / curator run）内 | ❌ 映射缺失 |
| A2 改名/归档 | rename→archive | archive 有命令路径；rename 无 | ⚠️ |

### 1.4 平台事实核验

- 子代理机制：`subagents.start('spawn')` + `outputSchema` 结构化返回 + fake-start 冒烟样板 ✅（review 先例完整）。
- `appendEvolutionEvent({type:'maintain'})` ✅ 可行（`usage` 已开同类扩展先例，解析侧容忍未知 type 已验证）。
- bundle v9→v10 新增 entry ✅ 可行；"新增只加不减"与 fail-closed 惯例一致。
- **工具面 `['skill','skill_load','maintenance_probe']` ❌**：平台事实（v1 审计确立、host patch 注释、rc.58 README 更正）——DSH 目录只有 `skill`，`skill_search`/`skill_load` 不存在，列入即死配置。

---

## Part II 架构合理性评审

### A1（P2）分层归属：signals 的归属矛盾牵出**命名冲突**——core 已有一个语义完全不同的 `signals.ts`

- 文档 §4 说"信号初版定义（signals.ts，单源）"，§8-D1 说该 signals 落新包 `evolution-maintenance`、§8-D4 又要求 review/curator 共享——三处合起来自相矛盾：若落 maintenance，curator/review 共享必须反向依赖（违反 D1 的依赖单向 `commands→maintenance→core`）；若落 core，则与 **core 现有的 `src/signals.ts`（review 节奏信号门：`observeEvent`/`advanceReview`/`foldTurn`/`TurnSignals`）同名撞车**——两个语义无关的"信号"模块共用一个文件名与"信号"词汇，正是 §2-P2 要防的概念错置。
- **建议**：信号定义（纯函数 + 阈值表）落 **core**（与 `skill-health.ts` 同层，完全符合 D1 自己对 core 的定义），文件名与词汇与 review 门显式区分（如 `drift-signals.ts`）；maintenance 包只做 scan/render/validate/probe 编排。D4 的"三者共享"随之自然成立。

### A2（P3 · 架构声明缺位）家族已有**四个评估面**，010 缺一段"评估架构"总纲

- 现状：review（会话级、节奏触发、写执行）、curator（生命周期、定时自动、归档执行）、skill-health（结构维度、只读暴露、`/evolution skills health`）、maintain（库级、用户命令、只诊断）——四者在信号、触发、输出、权限上各有一套。010 的 D4 只划了 maintain 与两者的边界，但"哪个维度归谁、自动 vs 按需、信号从哪来"没有一张总表。
- 风险：每个新评估面各自为政（skill-health 当初也是"独立维度"），词汇（health/quality/signal/drift）与阈值逐渐分叉——文档 §2-P1 批判的"代理指标替代、权重不稳定"会在**家族层面**复演。
- **建议**：010 增补一节"评估面总表"（面 × 触发 × 信号源 × 输出去向 × 执行权限），并把"信号定义单源"从一句 D4 扩为带消费方清单的契约（A1 落地后 natural 成立）。

### A3（P3 · 演进耦合）PROMPT_BUNDLE 是 core 里的**单调全局结构**，每加一个 feature entry 都扩大混合版本的爆炸半径

- D3 把 MAINTAIN_PROMPT 入 core bundle（v9→v10）。机制现状：bundle digest 覆盖**全部** entry，任一新增改变 digest ⇒ 所有混合版本部署在装载期 fail-closed（既定纪律，但爆炸半径随 entry 数线性增长）；core 因此承载了 maintenance 专属的提示词——"core = 纯共享库"的边界被逐条侵蚀。
- **备选（文档未论证）**：① bundle 支持包级**贡献式 entry**（各包注册自己的 prompt entry，digest 按命名空间分段）；② maintenance 自持小 bundle（模板 M + 自身签名），core bundle 不动。两者都能把"维护功能发布 = core+maintenance 同版"的强制耦合降为局部。至少应在 §8-D3 记录"为什么不做"——008 的判定表传统即为此而设。

### A4（P2 · 数据流与状态设计）维护计划是**短暂对象**：不落 approval、不落 state、不落事件载荷——展示与执行之间没有持久桥

- 流程"展示给用户 → 用户挑选 → 现有命令执行"中，plan（含 evidence 链路、undo_path、confidence）只存在于命令返回文本与当轮会话。会话结束/重启后：plan 丢失 ⇒ 用户只能重跑（再花 3-5K token）；执行的命令**不携带 plan 引用** ⇒ 事后审计（哪个建议导致这次 consolidate）断链——恰是 §2-P4 批判的"写入无意图标注"在新面的复演。
- 家族已有现成挂点未用：**evolution-approval 的 staged 记录**（audit 历史天然持久，`kind` 联合可扩 `'maintain'`）或 evolution-state 自有表。建议：plan（或用户勾选的子集）落 staged/记录层，执行命令引用 plan id；最低限度把 plan 摘要进 `type:'maintain'` 事件的载荷。
- 附带收益：计划可引用后，B3/B4/B5 这类无命令通道的建议（Part I §1.3）也有了"挂起待执行"的栖身处。

### A5（P2 · 信任边界）事实块/技能正文跨会话边界输送，**无脱敏、无威胁模型章节**——与 review 通道姿态不一致

- review 通道在把会话内容发给子代理前过 `redactReviewSecrets`（`evolution-review/src/index.ts:214`，rc.60 引入，动机明示："跨边界快照是唯一外送面"）。maintain 的事实块与 probe JSON 同样出会话边界（子代理 = 独立 LLM 调用），且 probe 按"按需深挖"会返回**单技能全文密度分布/指针明细**级别的原文内容；`skill` 工具还让子代理可读任意技能正文。010 通篇未提脱敏与注入面。
- 威胁现实：技能正文是历史上**模型自写**的内容（可被注入污染）——子代理读入后可能产出被偏置的"建议"（如推荐 archive 某竞品技能）。缓解链存在但未被文档声明：plan 无执行权（D2）+ 用户挑选 + 执行命令过既有审批/威胁链——这三道闸应当作为**威胁模型小节**写明，脱敏（复用 `redactReviewSecrets` 于事实块渲染）应进 §6 实现要点与测试矩阵。
- 另注：`evidence ⊆ 事实块` 的引用闭合约束已经把"probe 引入新证据"挡住（好设计），但 probe 输出影响 confidence/semantic_reasoning 的通道仍应在威胁模型里点名。

### A6（P3 · 运行时健壮性）编排器的并发/超时未定义——两个先例都在家里

- curator 有重入门（`this.running` + `already-running` 结果，`curator/index.ts:402`）；review 有 `reviewTimeoutMs`（120s，`AbortSignal.timeout`）。maintain 编排（scan→render→subagent→validate）两者皆无：两次 `/evolution maintain` 并发 = 双份 token 成本 + 两份冲突建议；子代理挂起无超时 = 命令悬挂。建议照抄两个先例（`maintainRunning` 门 + `maintainTimeoutMs`），各一行配置。

### A7（P3 · 配置一致性）扫描根与 `root` 三处分叉、`quality_low` 未接观测窗口

- 家族现状：tool-skill-manage / skill-usage / evolution-skill-catalog 各带 `root` 配置（注释互相提醒 "Align with skill-usage/catalog rows"）。maintain 的扫描根必须加入这个对齐故事（默认 `skillsRoot()`、可 profile 覆盖、与三处同源），否则"诊断的库"与"工具操作的库"可能不是同一个。
- `quality_low` 直接取六因子分，但六因子中的 usageFrequency/stability 在观测窗口开启前同样不可信（008-C 的结论）——maintain 应与 curator `healthView` 同款处理：窗口未开时 `quality_low` 标 unknown/抑制，而不是只给 `usage_observed` 一个环境行。

### A8（P3 · 论证完整性）缺"备选方案考量"节

- 008 的判定表（KEEP/REFACTOR/NOT BUILD 逐缝裁决）是本族的强项传统。010 对"为什么是独立子代理流而非：① 纯确定性报告（无 LLM）；② 扩展 curator `healthView` + `/evolution skills health`；③ review 通道加库级模式"三个更便宜的备选没有论证。三段式中真正需要 LLM 的只有语义判断（锚 vs 残留、同伞与否）——这个论证值得写下来，否则 Phase 2 的 3-5K token/次成本缺一个"为什么不用 0 token"的答辩。

---

## Part III 可行性发现回顾（详证见同日前稿，此处保留结论）

- **F-1（P1）B3 执行通道不存在**：dup_heading 检出的场景（重复标题）被 restructure 明文拒绝（"ambiguous anchor"），"合并/删除"也非 restructure 动作形态；B2/B4/B5（补指针/拆行/缩 description）不在三通道内；用户侧无 restructure 命令。要求补"规则→执行命令→可逆性"映射表并为 B3 定通道。
- **F-4（P2）`prefix_cluster` "簇 ≥3" vs 实现 ≥2**：标注"复用"却阈值不同——实现者第一天即撞；就地消歧（新阈值参数或改文档）。
- **F-5（P3）实证口径**：见 Part I §1.2——"104KB"是单技能体量；验收应改 fixture 精确断言 + 真实库触发断言，并写明测量契约（口径/正则/时点）。
- **F-2（P3）** probe 注册作用域未定义（全局挂载 = 全会话目录多一个工具——安装定型不违缓存纪律，但暴露面是产品决策）。
- **F-3（P3）流程**：文档未入库（git 未跟踪）却标注"评审通过"；"3 个增量" vs Phase 1-4 措辞不齐。
- **F-6（P3）细节**：confidence (0.4,0.6) 隔离带无定义；"旧 worker 不受影响"应写为"混合版本装载期 fail-closed（既定纪律）"。

---

## Part IV 修订清单（合并分级）

**实施前必须（阻塞 Phase 1/2 的分叉与撞墙）**
1. F-1：补"规则→执行命令→可逆性"映射表；为 B3 指定通道（扩展 restructure 去重形态 / patch+update 链 / 降级为仅报告）；补 restructure 用户命令面。
2. A1：signals 归属二选一并落位（建议落 core、改名避撞 review 信号门）；同步 D1/D4。
3. F-2：工具面 `['skill','skill_load']` → `['skill']`（probe 另加）。
4. F-4：`prefix_cluster` 阈值就地消歧（≥2 复用 or ≥3 新参数）。

**应改（设计补强，Phase 2 前落纸）**
5. A5：补威胁模型小节 + 事实块渲染接入 `redactReviewSecrets` + 测试。
6. A4：plan 持久化决策（approval staged / state 表 / 事件载荷最低限度）。
7. A6：`maintainRunning` 重入门 + `maintainTimeoutMs`（照抄 curator/review 先例）。
8. A7：扫描根入三处 root 对齐故事；`quality_low` 接观测窗口门。

**应答（记录即可）**
9. A2：评估面总表一节；A3：bundle 贡献式 entry 的取舍记录；A8：三备选论证；F-3/F-5/F-6：入库、口径、措辞与隔离带裁定。

---

## 判定与统计

**approve-with-changes。** 设计的核心判断（机械/语义分权、只诊断不执行、信号表驱动、自洽签名捆绑）站得住，且与 008/009 的衔接是系列中最自觉的；架构层面的四个 P2/P3 主题（signals 归属与命名、评估面总纲、信任边界脱敏、计划状态短暂性）都是"补一节/挪一个文件/接一个现有挂点"量级的修订，不动摇方案骨架。若不在实施前处理，A1 与 F-1 会让 Phase 1-2 返工，A5 让新面成为家族信任边界的例外。

**统计**：可行性核验——复用声明 11 项（10 ✅ / 1 ❌）、执行映射 5 类（2 ❌ / 3 ⚠️✅）、平台事实 4 项（1 ❌）、实证复算 5 项（2 精确 / 3 口径漂移）；架构评审 8 轴（2 P2 + 5 P3 + 1 P3 论证缺位）。合并终稿评审意见：**P1×1、P2×4、P3×8**。九轮累计 86 项（含 v8 文档审计 5 项更正）。
