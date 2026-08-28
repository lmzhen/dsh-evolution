# rc.39 审计优化计划（架构分层 · 分组分步骤）

> 输入：`docs/hermes-alignment-audit-rc39.md`（本轮 H-only 对齐复审，含 1 高 + 2 中 + 6 低待修项与过期文档清单）。
> 原则（沿用 `hermes-borrow-implementation-plan.md` 纪律）：按**架构层级 / 文件接触面 / 平台依赖 / 可回滚性**分组；
> 每步独立 rc、独立验证（五连）、独立回滚（git revert + 重打 rc tag）；
> 顺序 = 先**状态一致性**再**控制面**再**共享纯函数**再**模型文本**再**错误面/观测面**再**接缝扩展**，文档治理收尾。
> 本文件只做计划，不改任何代码。

---

## 0. 架构分层与分组总览

dsh-evolution 家族的分层（自底向上）：

```
seam 层        evolution-io / evolution-io-node          （可选探针模式的 IO 接缝）
core 纯函数层  evolution-core（stores / curator / quality / prompts / constants）
服务/控制面层  evolution-curator / evolution-approval / skill-usage / evolution-state* / evolution-policy
编排层         evolution-review（+ plan-validator）
模型工具面     tool-memory / tool-skill-manage
人面/观测面    evolution-commands / evolution-learning-graph / evolution-activity / evolution-replay
装配/治理      evolution-host / evolution-agent（yml）+ docs
```

分组与顺序按"改哪一层、动多少文件、能否独立回滚"划定：

| 组 | 架构层级 | 内容 | 接触面包 | 依赖 | 审计来源 | 建议 rc |
|---|---|---|---|---|---|---|
| **G1 状态一致性收口** | 编排层 → 服务层 | review 直通 delete 回写 usage | evolution-review | 无 | §4-高 A | rc.40 |
| **G2 策展控制面补全** | 控制面 + 人面 | paused 门 + pause/resume 命令 | evolution-curator、evolution-commands | 无 | §4-中 B | rc.41 |
| **G3 图谱语义边 + related_skills 单源化** | core 纯函数 + 人面 | 字母序占位边 → `related_skills` 语义边；解析逻辑单源 | evolution-core、evolution-learning-graph、evolution-curator | 无 | §4-中 C | rc.42 |
| **G4 模型文本修正（bundle 版本纪律）** | core 文本层 | pinned 矛盾措辞 + inject 路径读前写约束；bundle 升版 | evolution-core(prompts) | 无 | §4-低 D/E | rc.43 |
| **G5 记忆错误面可恢复性** | core 纯函数 | replace/remove/批量失败附条目预览 | evolution-core(memory-store) | 无 | §4-低 F | rc.44 |
| **G6 报告观测面健壮性** | 控制面（+core 可选渲染） | 报告保留裁剪；可选 REPORT.md | evolution-curator、evolution-core(可选) | 无 | §4-低 G | rc.45 |
| **G7 IO 接缝符号链接防御** | seam 层 + core store | 可选 `isSymlink?` 探针 + archive/restore 拒 symlink | evolution-core(io,skill-store)、evolution-io | 无 | §4-低 H | rc.46 |
| **G8 文档与默认值治理** | 治理层 | 默认值差异显式声明、报告路径口径统一、旧审计标注被取代 | docs | 无 | §4-低 I、§5 | 随 rc.46 或独立 |

> G1+G2 接触面不重叠、改动都小，若发布节奏倾向合并可并为一个 rc（一次五连验证）；默认仍分开以保持独立回滚粒度。

**排序理由**：G1 是唯一的高severity（数据分叉）且一行级改动，最先落地止损；G2 补齐控制面软闸后，后续步骤的验证都可以安全地手动跑 curator；G3 顺手把 `related_skills` 解析收进 core 单源，消除"quality 因子与图谱各自解析"的既存漂移点；G4 触发 prompt bundle 升版（fail-closed 语义），单独一个 rc 让升级可见；G5/G6 纯增强；G7 动接缝（`EvolutionIoLike` 签名面），放最后；G8 无代码。

**明确不做**（维持已裁定项，见 §排期外）：不翻转 `pruneBuiltins` 默认（声明而非翻转）、不引入硬删除、不做全局 memory id 迁移、不实现 frozenSnapshot。

---

## 第一步（rc.40 · G1）：review 直通 delete 回写 usage ✅ 目标：消除唯一的高severity 状态分叉

**层级**：编排层（evolution-review）调用服务层既有写入口（skill-usage 注册表），零新概念。

1. `evolution-review/src/index.ts` `executeSkillDirect` delete 分支（:353-358）：`library.archive` 成功后，与同函数 create 分支的 `markAgentCreated`（:345-348）对称，经 `ctx.get('skillUsage')` 调 `markArchived(name)`（registry 已有该方法，`skill-usage/src/index.ts:82-91`）——状态迁移而非 patch 计数，与 H `skill_usage.archive_skill` 尾部 `set_state(ARCHIVED)`（skill_usage.py:754）同构。
2. 覆盖面核对（不改动，仅确认）：approval 启用路径走 runner → `tool-skill-manage:112` 已回写；图谱路径 `evolution-learning-graph:180-181` 已回写；curator 路径 `applyMutations:585-589` 已回写。本步后 **delete 四条路径全部收敛**。
3. 测试：review plan（delete 带 absorbed_into，approval-disabled 组合）→ `.usage.json` 记录 `state='archived'` + `archived_at` 非空、`patch_count` 不变；再次 curator run 不再产生 "not found" 错误（failed 列表为空）。
4. 验证五连：定向 vitest（evolution-review/skill-usage）+ `tsc -b tsconfig.host.json` + `oxlint --type-aware packages/evolution` + 全量 + CI。
5. 回滚：单文件 revert。

---

## 第二步（rc.41 · G2）：策展控制面补全（paused 门 + 命令面）

**层级**：控制面服务（evolution-curator）+ 人面命令（evolution-commands）。字段已存在（三处声明），本步只把"声明"变成"行为"。

1. **paused 门**（`evolution-curator/src/index.ts` `runCore`）：在 interval 门（:361）**之前**插入，对齐 H `should_run_now` 的 enabled→paused→interval 顺序（curator.py:231-233）：
   `if (!ignoreGates && persisted?.paused === true) → skippedReport + skipped:'paused'`。
   `ignoreGates`（`/evolution curator run` 手动语义）绕过 paused，与 H 手动路径绕过 `should_run_now` 一致。
2. **setter**：新增 `setPaused(paused: boolean)`：读 persisted state → 保留 lastRunAt/runCount/lastSummary → 写回 `paused` 标志。persisted 为 null 时种子一条（lastRunAt=now、runCount=0、summary='paused'）——注意与 first-run-deferred（:378-391）的交互：pause→resume 后 persisted 非空、lastRunAt=now，interval 门自然再 defer 一个周期，行为安全，写入注释。
3. **命令**（`evolution-commands/src/index.ts`）：`curator pause` / `curator resume` 子命令，回执带当前 paused 状态；help 行同步。
4. **可选（同面顺带，明确可选）**：
   - `curator status` 一行摘要（lastRunAt/runCount/paused/lastSummary）——report/scope 之外补运行态视图；
   - `curator run consolidate` 单次 LLM 覆盖——`run()` 增加可选 `forceConsolidate`，:411 处 `const llmOn = this.llmReview || options.forceConsolidate`（H `--consolidate` 单次覆盖对位）。
5. 测试：paused 时 timer/manual-gated 均返回 `skipped:'paused'` 且报告落盘；ignoreGates 仍执行；resume 后恢复；pause 在无 persisted state 时不崩溃。
6. 验证五连同 G1；回滚：两文件 revert（state schema 无变化，无迁移风险）。

---

## 第三步（rc.42 · G3）：图谱语义边 + `related_skills` 解析单源化

**层级**：core 纯函数（新增共享 helper）+ 人面（learning-graph）+ 控制面（curator 改为消费 helper）。这是本计划唯一的**消除既有架构漂移**的重构：quality 的 references 因子（`evolution-curator:531-546`）与图谱各自解析 `related_skills`，本轮先单源再接语义边。

1. **core 单源 helper**（`evolution-core/src/skill-store.ts`，紧邻 `parseFrontmatter` :101-117）：
   `export function relatedSkillNames(content: string, exclude?: string): string[]`
   ——解析 frontmatter `related_skills`，复用 curator 既有正则口径（`matchAll(/[a-z0-9][a-z0-9-]*/g)` + `SKILL_NAME_RE` 过滤 + 排除自身）。注意 D 的行式 frontmatter 解析把 YAML 数组留成字符串（`"[a, b]"`），正则天然兼容，行为与 curator 现状一致。
2. **curator 切换**（`evolution-curator:531-546`）：`referenceCounts` 改调 helper（行为不变，删除本地正则副本）。
3. **图谱语义边**（`evolution-learning-graph/src/index.ts`）：
   - `buildLearningGraph` 签名扩展：接收 `related: ReadonlyMap<string, readonly string[]>`（命令侧用 `withSkills().read(name)` + helper 构建，:146-148 处已有 library 句柄）；
   - 删除字母序相邻连线（:47-52），改为 H 语义（learning_graph.py:156-172 对位）：对每个技能节点的 related 目标，**两端都存在于节点集**才连边、去自身、无向去重（排序对作 key）；
   - `renderGraph`（:136-144）构建 related map 后传入。
4. **可选（明确可选）**：density 统计（H learning_graph.py:174-191 对位：edges_per_node / isolated_pct / linked_nodes）追加在 `/evolution graph` 尾部——纯读侧，量小。
5. 测试：helper（字符串/数组语法/自引用排除）；图谱 related 边两端校验+去重+无字母噪音边；curator referenceCounts 行为不回归（既有用例全绿）；`graph detail/edit/delete` 回归不受影响（解析器 :73-78 不动）。
6. 验证五连；回滚：三文件 revert（签名变更仅仓内消费，无外部兼容面）。

---

## 第四步（rc.43 · G4）：模型文本修正（bundle 版本纪律）

**层级**：core 文本层（prompts.ts）。零逻辑改动，但**必须升版 bundle**——这是本组的架构要点。

1. **pinned 矛盾措辞**（`prompts.ts:47`）：SKILL_REVIEW_PROMPT 的 "Pinned skills may be patched but not archived" 改为与实现对齐的表述——"Pinned skills are read-only to the background review; the pinned write guard refuses background changes. Only the foreground may update them."（H 同款矛盾在 background_review.py:171-275 vs :312，D 先行修掉自己的）。
2. **inject 回退软约束**（审计 §4-D）：SKILL_REVIEW_PROMPT 与 COMBINED_REVIEW_PROMPT 各加一句 "Only update skills you loaded or read in THIS session; never touch skills you have not read."——inject 回退路径（`evolution-review:151-157`）不经 filterUnreadSkillOps，先用提示词约束兜底；subagent 路径同 prompt（persona），与硬守卫（:405-417）叠加无害。
3. **bundle 升版**（`prompts.ts:18-19`）：`PROMPT_BUNDLE_ID = 'dsh-evolution@3'`、`PROMPT_BUNDLE_VERSION = 3`。纪律：任何语义性 prompt 变更必须同时 bump id+version（`verifyPromptBundle` 钉住常量，部分升级部署按设计 fail-closed，:103-105 拒绝调度 review）——发布说明须显式提示"升级需整批一致"。
4. 测试：bundle 校验用例随新常量自洽；review 相关断言文本同步；无行为性测试变化。
5. 验证五连；回滚：单文件 revert + 版本号回退。

---

## 第五步（rc.44 · G5）：记忆错误面可恢复性

**层级**：core 纯函数（memory-store）。只改失败消息的富信息度，不动任何成功/预算语义。

1. **包私有常量**：`ERROR_PREVIEW_ENTRIES = 5`、宽度 80（对齐 H `_previews` width 80，memory_tool.py:631）。不新增配置——预览是错误恢复辅助，不是行为开关。
2. **四处失败路径附预览**（`memory-store.ts`）：
   - `mutate` 缺 old_text（:228）——H 对位 `:927-958` 明确返回条目清单 + 重试指引；
   - `mutate` 未命中（:245）与多义匹配（:246-252）——H `apply_batch` 同款（:497 起）；
   - `applyBatch` 未命中（:294-295）与多义（:297-299）。
   消息追加 `Current entries (preview): …`，逐条截 80 字符、总数截 5，消息体积有界。
3. 不做：不把 entries 塞进 render（tool render 保持一行摘要，:186）——预览进 message 文本即对模型可见，改动面最小。
4. 测试：四条路径断言预览存在且有界；成功路径消息不含预览；既有 48+ 用例不回归。
5. 验证五连；回滚：单文件 revert。

---

## 第六步（rc.45 · G6）：报告观测面健壮性

**层级**：控制面（evolution-curator）+ core 可选渲染。

1. **报告保留裁剪**（`evolution-curator`）：写报告成功后（:455-462）调用私有 `retainReports(keep = 20)`——list reports 目录、过滤 `curator-*.json`、按名排序（runId 为 UUID，需按文件 mtime 或写入时间排序——实现用 `io.list` + 报告内 `startedAt` 排序最稳）、best-effort 删除最旧的超出部分（catch → warn，镜像 `retainSnapshots` :715-724 的姿态）。keep=20 包私有常量（对齐 claw 报告 keep 20 口径），不加配置。
2. **可选 REPORT.md**（明确可选，H 对位 `_render_report_markdown` curator.py:1271）：`core/curator.ts` 增 `renderCuratorReportMarkdown(report)`（头部、时长、archived/failed 清单、llmReviewEnabled），`runCore` 在 JSON 旁 best-effort 写 `curator-<runId>.md`；裁剪逻辑对两种扩展名同样生效。JSON 仍是机器契约，md 仅为 human 层。
3. 测试：写入 25 份 → 剩 20 份且保留最新；裁剪失败不抛；（可选）md 与 JSON 同 runId 成对。
4. 验证五连；回滚：revert。

---

## 第七步（rc.46 · G7）：IO 接缝符号链接防御

**层级**：seam 层扩展（可选探针，沿用 `size?` 的既有模式）+ core store 消费。放最后：签名面最宽、severity 最低。

1. **接缝扩展**（沿用 `size?` 可选探针三件套模式，`io.ts:27,41-45`；`evolution-io/src/index.ts:22` 同步声明）：
   `isSymlink?(path: string): Promise<boolean | null>` —— true/false/未知（后端不支持、缺失文件）返回 null。
   `evolutionIoAdapter` 透传：后端未实现 → `Promise.resolve(null)`（"守卫不适用"语义，与 size 一致）。
   `nodeEvolutionIo` 实现：`lstat` → `isSymbolicLink()`；ENOENT → null。`evolution-io-node` 展开 `nodeEvolutionIo()`（:19-25）自动继承。
2. **store 消费**（`skill-store.ts`）：`archive`（:487）对源目录、`restoreFromArchive`（:580）对 .archive 源，rename 前 `isSymlink` 探测——true 则拒绝，消息对齐 H `_validate_delete_target`（skill_manager_tool.py:219-223）："Refusing to archive/restore: the skill directory is a symlink/junction. Remove the link target manually if intended."。probe 为 null（后端不支持）→ 放行并在代码注释标注"守卫不适用"。
3. **平台注意**：symlink 测试在 CI 的 Windows runner 上可能不可用——逻辑测试用 mock io（探针返回 true/false/null 三态），真实 symlink/junction 用例标注 `skipIf(platform)`，不阻塞五连。
4. 测试：三态 mock（拒绝/放行/不适用放行）；archive 拒绝时文件树不动、无 `.archive-reason` 残留。
5. 验证五连；回滚：revert（接缝为纯可选新增，向后兼容）。

---

## 第八步（G8）：文档与默认值治理（无代码）

1. **默认值差异显式声明**（审计 §4-I 两项）：
   - `pruneBuiltins` 默认 false vs H true（config.py:2284）——README/config-catalog 与 evolution-curator Config 注释（:44-45）声明"保守默认：DSH 内置技能默认不进生命周期，开启需显式配置且 seed+suppression 前提已具备"；
   - 报告路径口径统一为 `~/.dsh/evolution/reports/`（全仓文档 + 未来任务文本引用时以此为准）。
2. **已知差异登记册**：把审计 §4-I 的保留 ≈ 项固化为一张表（per-file memory id、live 注入、60 字符机制前提、name 正则更窄、无 category、无 profile、review 压缩输入、cron 仅声明式、consolidate 拒绝而非降级），落在 `hermes-alignment-map.md` 头部或 README 对齐节——避免每轮审计重复"重新发现"。
3. **旧稿标注**：`hermes-alignment-audit-rc25.md` / `-rc30.md` 顶部加一行"已被 rc39 取代，遗留项状态见 rc39 §5.5"；`hermes-borrow-implementation-plan.md` G3 行状态更新为已实现（rc.24）。
4. 验证：纯文档，CI 无感。

---

## 排期外（渠道阻塞与已裁定项，如实记录）

| 项 | 阻塞/裁定 | 解锁后的落点 |
|---|---|---|
| cron 引用自动扫描 + 合并后重写 | 渠道阻塞：需 task-board/`packages/schedule` 暴露"列举引用技能名 + 重写引用"接口 | 接口具备后：引用集接入 `computeLifecycleTransitions` 入参（纯函数，好测）；`applyMutations` 完成后调重写（H cron/jobs.py:1748/:1777 同构） |
| inject 回退走结构化 plan 通道 | 低频回退场景；G4 软约束先行 | 若回退频率可观，再评估 inject 也产出 plan 经 validator 执行 |
| 全局 memory id 索引（per-file → 全局） | 兼容性破坏：id 规则 + 命令解析 + 图谱渲染三处联动，升级后旧 id 含义变化 | 保持已知近似；仅当出现跨生态工具互换需求时立项 |
| frozenSnapshot（冻结注入） | 已裁定：前缀缓存优化，收益/成本不明 | 维持 live |
| LLM consolidate `into` 不存在 → 降级为 pruning | 已裁定：D 拒绝（保守）方向正确 | 维持 |
| review 全量 replay（H 同模型路径） | 平台会话面差异；已有压缩输入 + 工具证据 + 脱敏 | 维持 ≈ |

---

## 风险与纪律

- 每步可独立回滚（git revert + 重打 rc tag）；组间无代码依赖，仅建议顺序。
- 验证五连（定向 vitest → `tsc -b tsconfig.host.json` → `oxlint --type-aware packages/evolution` → 全量 → CI）；**测试文件改动必须跑上游型全量 typecheck**（tsc -b 只查 src，历史教训）。
- G4 的 bundle 升版是唯一有**部署一致性**含义的步骤：升级窗口内新旧混布会 fail-closed（按设计拒绝调度 review），发布说明必须显式提示。
- G7 的接缝扩展遵循 `size?` 先例：可选成员 + adapter 兜底 null，任何第三方 IO 后端零改动兼容。
- 全程不翻转任何默认值（pruneBuiltins 声明而非翻转）、不引入硬删除、不做破坏性 id 迁移。

---

## 落地后的回归基准更新（供下一轮审计校准）

全部落地后，rc.25 式校准表应按此修订（下轮审计以此为基准）：

| 域 | 修订后口径 |
|---|---|
| 技能 | delete 四路径（工具/图谱/curator/review 直通）usage 回写全收敛 → ✅ |
| 策展 | 门控 = interval + idle + first-run-deferred + **paused**；pause/resume 命令面 → ✅ |
| 图谱 | related 边 = `related_skills` 语义边（单源 helper）；per-file 索引仍为已知近似 → ✅/≈ |
| 复习 | 提示词与写保护零矛盾；inject 回退带读前写软约束（硬守卫仍限 subagent 路径）→ ✅/≈ |
| 记忆 | 失败消息附条目预览（80×5）→ ✅；其余不变 |
| 报告 | `~/.dsh/evolution/reports/` + keep 20（口径已统一）→ ✅ |
| 接缝 | `isSymlink?` 可选探针入 seam；archive/restore 拒 symlink（后端不支持则守卫不适用）→ ✅/≈ |
| 治理 | 默认值差异与已知差异登记册成文 → ✅ |
