# dsh-evolution 第十一轮审计报告：011 维护子代理设计落实情况

| 项 | 内容 |
|---|---|
| 审计对象 | 设计 `docs/design-review/011-maintenance-subagent-v2.md` 的**实现落地**（提交 `0ff877b`→`8fc9828`，Phase 1-4；基线 `a5bb19b`） |
| 覆盖增量 | 50 文件、约 +3165/−54 行：新包 `evolution-maintenance`（scan/render/validate/orchestrate/probe/tools）、core `drift-signals.ts`（260 行）、`redact.ts` 下沉、MAINTAIN_PROMPT + bundle v10、commands `maintain`/`restructure` 命令、host patch 挂载、8 个测试文件 |
| 审计方法 | 011 逐条承诺对照实现（Phase 1-4 全量）；v10 评审遗留项核销；v8 审计 P2 修复（快照旁路）顺带核销；新代码全量通读 + 接线追踪（命令 → 编排 → 信号） |
| 约束 | 只读审计，未修改任何代码 |

**结论摘要**：落地完成度高——Phase 1-4 骨架全部在库，测试纪律延续（四道自洽测试 ①②③④ 全部实现、fail-closed 路径有测试、restructure 命令端到端、v10 全部 P3 清单中 5 项已顺手修复），v8 审计的 P2（快照刷新旁路）也已正确修复（`evolution/memory-applied` 写入汇事件 + tool-memory 订阅，走 `ctx.emit` 不落会话日志——v1 的 P0-1 教训被正确应用）。**但发现 1 项 P1**：编排命令**没有接任何富化钩子**，导致 4 个信号在真实路径上失活，其中 `pointer_missing` 在未枚举支持文件时被实现为**伪造 pass**（事实块断言"无缺失指针"）——直接违反 011 自己的"unknown≠pass / 事实只读"铁律。另有 3 项 P2：联合签名弱化（只哈希模板前 2048 字符 + 信号 id 集合，不绑阈值——MISMATCH 协议检不出模板后半与阈值漂移）、`--plan <runId>` 回引未实现（§10 承诺的审计闭环半途）、`evolution-maintenance` 未进 `prepare-release.mjs` 的 publishGroups（下次发布在一致性检查处 fail-loud）。

---

## 1. 落实矩阵（011 承诺 → 实现状态）

### Phase 1 — 确定性底座

| 承诺 | 状态 | 证据与偏差 |
|---|---|---|
| `drift-signals.ts` 落 core、与 `signals.ts` 区名 | ✅ | `evolution-core/src/drift-signals.ts`（纯函数、阈值从属主模块导入零复制、`DRIFT_SIGNALS_VERSION='1'`）；A1 正确关闭 |
| 信号集 11 项 + 阈值镜像 | ✅/⚠️ | dedup ≥2、prefix **≥2**（F-4 裁决镜像实现）、stamp 2.0/KB+2000、body 40k、quality 0.3、bar 60 全部从属主模块 ✅ |
| drift-scan.ts 快照组装 | ✅/❌ | 组装器可用，但 `SnapshotOptions` **缺 `usageObserved` 字段**；且未接富化时 `pointer_missing` 伪造 pass（见 §2 P1-1） |
| render-facts.ts（签名头/redact/`[UNKNOWN]` 行） | ✅ | `render-facts.ts:28-52`：value/detail 过 redact、unknown 前缀区分、联合签名头 |
| redact 下沉 core + review 改 import | ✅ | `core/src/redact.ts`（模式逐一迁移）+ `review/src/index.ts` 改 `import { redactSecrets }`，行为不变；redact.spec 迁移 ✅ |
| 新检查 5 项纯函数 | ✅ | `duplicateHeadings`/`overlongLines`/`missingSupportPointers`/`narrowNameMatches` + probe 单源复用 |

### Phase 2 — 功能主板

| 承诺 | 状态 | 证据与偏差 |
|---|---|---|
| MAINTAIN_PROMPT 入 core bundle v10 | ✅ | bundle v10、`prompts.spec` 钉 `prompts['maintain']`；quality_low 门**收进校验器、模板侧不重复**——顺带消除了 v10 §3-(1) 的判据歧义 ✅ |
| `/evolution maintain [scope]` | ✅/⚠️ | 命令、fail-closed（io/subagents 缺失显式报错）、冷却窗 60s（**替代**了设计的 running 门——重叠窗口分析见 §2 P3-1）；scope/`--facts` 未实现（§12-1 承诺的 0-token 事实面缺席） |
| `/evolution restructure` 新命令 | ✅ | 引号 heading 解析、references/ 前置校验、`SkillLibrary.restructure` 桥接（内核两阶段/origin gate 复用）✅；端到端测试 ✅ |
| `--plan <runId>` 回引（§10） | ❌ | consolidate/restructure 均未实现该参数——**审计闭环只做了一半**（maintain 事件有 runId，执行命令无法回引） |
| validate-plan 拒绝矩阵 | ⚠️ | 枚举/必填/引用闭合/no_issues⇒空 plan/override_reason/**quality_low 强制门**/**reversibility 含 patch**（v10 遗留已修）✅；**缺**：mutation 字段拒绝（011 §6 明列）、names ⊆ 快照闭合、evidence.value 与事实块逐字比对、NaN confidence 穿透（见 §2 P2-2/P3） |
| 编排（running 门 + timeoutMs） | ⚠️ | timeoutMs 120s + `AbortSignal.timeout` ✅；重入门被冷却窗替代（偏差，见 §2 P3-1） |
| maintain 事件（摘要 + runId） | ✅ | `type:'maintain'` + `runId/verdict/recommendations` 字段入联合（`evolution-events.ts`），命令成功后 best-effort 追加 + warn 兜底 |
| subagent 失败 fail-closed、MISMATCH | ✅/⚠️ | 无 structured payload / 校验拒绝 → 显式报错 ✅；MISMATCH 协议的**签名机制弱化**（见 §2 P2-1） |
| 依赖声明 | ✅ | 实施中发现并当日修复的两处 P1（commands/host 补 `evolution-maintenance` 依赖声明，`8fc9828`/`975cf3d`） |

### Phase 3 — probe

| 承诺 | 状态 | 证据与偏差 |
|---|---|---|
| `maintenance_probe` 只读、单源、JSON | ✅/❌ | 工具注册（host patch 显式行 `evolution-maintenance/tools`）、`isConcurrencySafe:true`、输出过 redact ✅；**但 probe 重建快照时不携带 supportFiles/description/quality** → `pointer_missing` 恒空、`description_chars` 恒 missing、`quality_low` 恒 unknown——**probe 会与事实块矛盾**（事实块可能判 over，probe 说无缺失），破坏 011"probe 永不与事实块不一致"的单源契约 |
| 白名单 `['skill','maintenance_probe']` | ✅ | `orchestrate.ts:164` |
| `HEALTH_STAMP_RE` 单源导出 | ✅ | probe 密度公式与 skill-health 同式，但**未镜像 2000 字下限**（短文 probe 可报密度而事实块为 pass——同族矛盾，见上） |

### Phase 4 — 自洽硬化 + 发布

| 承诺 | 状态 | 证据 |
|---|---|---|
| 四道编译期测试 | ✅ | `self-consistency.spec.ts`：①词汇断言（渲染零残留、名词表=probe 信号集）②无孤儿 ③示例可复算（阈值占位渲染引擎值 + 锚示例复算）④引用闭合交叉验证 |
| signals_version 纪律 | ✅ | `DRIFT_SIGNALS_VERSION` 常量 + 渲染/签名入参 |
| 0.3.0 程序发布 | ⏳ 未到期 | 当前为 0.2.1（v8 P2 修复的 patch 发布）；但 **`prepare-release.mjs` 的 publishGroups 缺 `evolution-maintenance`**——下次发布在 manifest/publish-order 一致性检查处 fail-loud（见 §2 P2-3） |

### 附：v8 审计 P2（快照刷新旁路）修复核销 ✅

`MemoryRegistry.applyBatch` 成功后发 `evolution/memory-applied`（`memory/src/index.ts:93`，**cordis 事件而非 session.append**——v1 P0-1 的教训被正确应用）；tool-memory 以 `ctx.effect` 订阅并重渲染快照（`:144`），旁路（/graph 编辑、review 直连写）全部覆盖；事件声明进 memory 包的 Events 合并 ✅。缓存语义正确：快照未变 = 平台零注入，变了 = 尾部一条。

---

## 2. 本轮新发现

### P1-1（接线断层 + 伪造事实）命令编排**未接任何富化钩子**——4 个信号失活，其中 `pointer_missing` 伪造 pass

- **事实链**：`commands/src/index.ts` 调 `runMaintain({ library, subagents, parent })`——**不传** `options.quality/descriptions/supportFiles/usageObserved` 四个富化钩子中的任何一个；而 `snapshotFromLibrary` 的 `SnapshotOptions` 也没有 `usageObserved` 字段。于是 11 个信号在真实路径上的状态：
  - **7 个正常工作**：dedup_group、prefix_cluster、narrow_name、stamp_density、body_size、dup_heading、overlong_line（仅依赖 body/name ✅）。
  - **pointer_missing → 伪造 pass**（P1 核心）：`supportFiles ?? []` 把"未枚举"当"枚举为空"→ 事实块输出 `[FACT] signal=pointer_missing value=none verdict=pass`——在**从未检查过**支持文件的维度上断言"无缺失"。这违反 011 的两条铁律："unknown=脚本未检测 ≠ pass=未越阈"与"事实只读、不补写缺失信号"。正确行为应输出 `[UNKNOWN]`（fixture 有支持文件目录列表时不经此路径，但真实命令路径恒走伪造分支）。
  - **description_chars → 恒 unknown**：B5 规则（描述超 60）在真实路径**永不触发**——011 验收"真实库扫描全信号检出"不可能达成。
  - **quality_low → 恒 unknown**：A7 的观测窗口门退化为"永远强制 needs_human"——保守方向安全（`orchestrate.spec:120` 的测试名甚至自述 "no usage data in Phase 2"，把降级状态钉成了预期），但 quality 信号本体失活。
  - **usage_observed → 恒 unknown**：观测窗口事实在事实块中永不出现。
- **为什么是 P1 而非 P3**：伪造 pass 不是"降级"而是**错误事实**——模型会基于 `pointer_missing=pass` 得出"支持文件指针治理无需处理"的结论，恰是 011 要修的层漂移维度之一；且修复成本低（命令侧接 4 个钩子：frontmatter 解析、`SkillLibrary` 目录列举、usage 侧车 `loadUsage`+`computeQualityScores`、`usageObserved()`，全部现成 API）。

### P2-1（签名弱化）联合签名不绑"模板后半"与"阈值表"——MISMATCH 协议承诺的漂移检测不成立

- 011 §7：`sig = sha256(模板原文 + 信号定义表序列化)`。实现（`orchestrate.ts:88-95`）：`sha256(JSON.stringify({ signalsVersion, ids: existingSignalIds(report), template: template.slice(0, 2048) }))`。
- 三处偏离：①模板只哈希**前 2048 字符**——模板 M 全文 ~4.5KB，检查清单/输出契约（§3/§4）全部不在签名覆盖内，模板后后被篡改/截断/版本错配都不改变签名；②`ids` 只是**本次报告出现的信号 id 集合**，不是"信号定义表序列化"——**阈值变更不改变签名**（阈值恰是"模板与事实块共享同一词表与阈值"承诺的核心）；③签名随 report 内容变化，是运行指纹而非部署契约指纹——两处 sig 相同无法证明"同模板同阈值"，MISMATCH 协议的模型侧比对因此只剩弱保证（部署侧 pre-flight 校验可以补强，但实现同样用的是这个弱签名）。
- **建议**：签名改为 `sha256(模板全文 + drift-signals 模块导出的定义表（含阈值常量）的稳定序列化)`，去掉 report 依赖；`template.slice(0,2048)` 的截断删除。

### P2-2（审计闭环半途）`--plan <runId>` 回引未实现

- 011 §10 承诺"执行命令回引：consolidate/restructure 接受可选 `--plan <runId>`"。实现：两个命令均无该参数（consolidate 未动、restructure 只解析 name/heading/to_file）——maintain 事件有 runId，但从建议到执行的**引用链断在执行侧**，§2-P4 的"写入无意图标注"只解决了一半。mutation 审计（`.mutations.json`）里也无 plan 字段。
- **建议**：两命令加可选 `--plan <runId>`，写入 `SkillLibrary.audit` 的 summary 字段（一行改动）+ maintain 事件不改。

### P2-3（发布管线）`prepare-release.mjs` publishGroups 缺 `evolution-maintenance`

- 新包会被 `readdirSync` 打包进 dist/manifest.json，但 `publishGroups` 硬编码清单未加 → `publish-order.json` 不含它 → `publish-scoped.mjs` 的 "manifest and publish-order disagree" 一致性检查**直接 throw**——0.3.0 发布（011 Phase 4 的既定步骤）会在打包后卡死。fail-loud 可恢复（补一行清单），但属"下一次发布必踩"的确定性缺陷。

### P3（4 项）

1. **冷却窗替代重入门留有重叠窗口**：设计说"照抄 curator running 门"，实现改为 60s 冷却（changelog 明言 replacement）。冷却只防"快速连点"，不防并发：run 超时上限 120s > 冷却 60s，第二次调用在首个 run 仍在飞时可进入 → 双 LLM 调用 + 双结果竞写 cooldown 状态。要么补 running 标志，要么冷却 ≥ timeout。
2. **`usage_observed` 值文本错误（潜伏）**：窗口关闭（`usageObserved=false`）时 `computeDriftSignals` 输出 `verdict='pass', value='observed'`——值文本与事实相反（`probe.ts:77` 同款：`every(===true)` 才 observed，其余一律 'unknown'，至少不说反话）。当前生产路径恒 unknown 触不到，但 API 一旦被接上即产出错误事实。
3. **NaN confidence 穿透**：`confidence < 0 || confidence > 1` 对 NaN 均为 false → NaN 通过校验且 `NaN < 0.6` 为 false → 不触发人审。改 `Number.isFinite`。
4. **子代理输入双份模板**：`persona: template` 且 prompt 又拼一遍 template——模板全文在输入中出现两次（token 翻倍）；review 的 persona+prompt 分工是"人格 vs 事实"，maintain 的 prompt 已含全文模板，persona 重复。建议 persona 保持、prompt 只放事实块 + 输出指令。

### 观察项

- **`--facts` 模式缺席**：§12-1 裁决"确定性报告作 Phase 1 交付、`/evolution maintain --facts` 可只显示事实块"——未实现（`input === 'maintain'` 精确匹配，`--facts` 落到帮助分支）。0-token 事实面是 A8 答辩的一部分。
- **probe 工具全局挂载**：host patch 显式加行，所有会话目录可见——v10 要求的"暴露面决策"以"全局只读"方式做出，可接受但未见理由记录。
- `maxDepth: 2`（review 用 0）——允许维护子代理再生子代理；未见理由。
- `formatPlan` 的 recommendations 计数取自展示文本行首匹配——实现脆弱但仅作事件摘要。
- `orchestrate` 空库短路不花模型调用 ✅（`orchestrate.spec:80` 钉住）。

---

## 3. v10 遗留项核销状态

| v10 项 | 状态 |
|---|---|
| 测量契约（F-5） | ✅ 011 §1 建立（单技能口径 105,367B/168/40 全部精确复算；153=`rc\.\d{2,}` 假说实机验证成立）；⚠️ 验收仍钉活数字 + "全量口径 168"/"41 文件"两处混标（010 遗留，011 未完全修正） |
| `reversibility` 枚举缺 patch | ✅ 已加（`validate-plan.ts:15`） |
| quality_low 门进校验器 | ✅ 已实现（`unknownQualitySkills` 强制门 + forcedHuman 展示） |
| 模板/校验器判据歧义 | ✅ 模板侧删除重复表述、机械判据唯一归校验器 |
| probe 暴露面决策 | ✅ host 显式挂载（全局只读） |
| 文档入库 | ✅ 010/011/REVIEWS/审计报告均已提交 |
| 验收钉活数字 | ❌ 未改（Phase 1 验收仍引用会漂移的 168/40） |

---

## 4. 修复清单（按优先级）

1. **P1-1**：commands 接 4 个富化钩子（descriptions=parseFrontmatter、supportFiles=技能目录列举、quality=usage 侧车 + `computeQualityScores`、usageObserved=`usageObserved()`——全部现成 API）；`pointer_missing`/`description_chars` 在富化缺席时输出 `[UNKNOWN]` 而非伪造 pass；`SnapshotOptions` 补 `usageObserved` 字段。
2. **P2-1**：联合签名改为全文模板 + 信号定义表（含阈值），去 report 依赖。
3. **P2-3**：`publishGroups` 补 `evolution-maintenance`（一行，随下次发布前必须）。
4. **P2-2**：consolidate/restructure 加可选 `--plan <runId>`，写入 audit summary。
5. **P3**：running 门补回或冷却 ≥ 超时；`usage_observed` 值文本按布尔输出；confidence 用 `Number.isFinite`；persona/prompt 去重；补 `--facts`。
6. **验收改口径**：Phase 1 验收从"活数字全中"改为"fixture 精确断言 + 真实库信号触发断言"（011 §1 契约保留为口径文档）。

---

## 5. 总体评价与统计

**落地完成度**：Phase 1-4 骨架 100% 在库，011 的 11 个信号定义、四道自洽测试、执行映射（含新 restructure 命令）、威胁模型（redact 下沉）、评估面总表对应的**结构**全部兑现；实施中自曝并当日修复两处依赖声明 P1，v8 的 P2 修复顺带落地且正确选择了 `ctx.emit` 通道。质量趋势延续：测试先行、fail-closed 显式化、教训条目化（冷却窗注释、模板"模板侧不重复表述"）。

**但接线层是本轮的失分区**：设计写对了、纯函数写对了、测试把"降级态"钉成了预期——唯独命令到编排的最后一公里没接富化钩子，造成 1 项伪造事实（P1）与 3 项信号失活。这与 v7 的教训同构：**"测试全绿 ≠ 与设计契约一致"，验证绿的是实现自己定义的行为**。

**统计**：011 承诺核验 23 项（Phase 1-4：17 ✅ / 5 ⚠️ 偏差 / 1 ❌ 缺失）；v10 遗留核销 7 项（5 ✅ / 2 ⚠️）；新发现 **P1×1、P2×3、P3×4、观察 5**。十一轮累计意见 104 项。
