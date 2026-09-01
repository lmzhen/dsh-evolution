# dsh-evolution 第七轮审计报告（0.2.0-rc.2）

| 项 | 内容 |
|---|---|
| 审计对象 | `D:\dsh\dsh-evolution-mirror` @ tag **`v0.2.0-rc.2`**（commit `bd6787e`，2026-09-01；含 0.1.0 正式发布与其后 008/009 两批架构工作） |
| 对比基线 | 第六轮审计（`AUDIT_REPORT_v6.md`，rc.71 `9a7d36b`） |
| 审计范围 | ① 逐条核验第六轮 G-1/G-2/G-3 及 H-1/H-3 修复；② 全量审计 rc.71→0.2.0-rc.2 增量（17 提交，约 +3073/−3317 行：rc.72 审计批次、0.1.0 发布与文档归档、008 四批——skill-health 域/usage 读侧观测/`SkillLibrary.restructure`/观测窗口语义、009 统一树变更内核 `applyTreeChange` + 包完整性门 + reference 降级、命令 input 声明）；③ 008/009 设计文档"宣称 vs 实现"比对；④ restructure 组装路径的逐字复现实跑验证 |
| 约束 | 只读审计，未修改任何代码 |

> **修复状态（2026-08-31 当日闭环）**：P1-1（restructure 双份 frontmatter）已修复（skill-store.ts planner 改收 body-only，回归=结构级断言+重复 restructure）;P3-1（supportRefs 非 md/子目录）已修复+回归;P3-2（锚点注释）已修正;P3-3（死变量/008 注记）已处理（空行观感保留）。修复在 d37daf5+3504b76（main），尚未发布（rc.2 为修复前 tag）。
**结论摘要**：v6 的 G-1/G-2/G-3 **三项全部确认修复**（归档名锚点续接 seq、严格数字归档 glob + 读错误隔离、缓存快照节奏 + 折叠地板守卫），H-1（curator 生命周期字段所有权 `stateOwned`）与 H-3（单一 glob helper、dsh-llm 转 peer）同样落地。008/009 的架构方向正确（结构健康为独立维度不进六因子、树变更单一提交点、旋转保序）。**但本轮发现 1 项 P1**：本版旗舰功能 `restructure` 的**组装路径把 frontmatter 复制了一份**——经逐字复刻实跑证实，每次成功 restructure 都会把 SKILL.md 写成"双份 frontmatter + `------` 残线"的损坏形态，`validateFrontmatter` 与全部现有测试（`toContain` 断言）均不设防，且对同一技能重复 restructure 会让 frontmatter 份数持续累积。另有 3 项 P3。**问题总量与严重度：39 → 7 → 7 → 6 → 7 → 3 → 本轮 1 P1 + 3 P3 + 5 观察**，严重度峰值首次回升至 P1，源于新功能组装层的一次性失误（与此前六轮"并发收尾"主题不同源）。

---

## 1. 第六轮问题修复核验（G-1/G-2/G-3 + H-1/H-3 全部确认 ✅）

| 编号 | 修复提交 | 核码证据 |
|---|---|---|
| G-1 seq 影子化（active 丢失后归档被顶替） | rc.72 | `appendEvolutionEvent` 空 active 分支改从**归档名锚点**续接 seq（`evolution-events.ts:146-153`，单一数字 glob 不解析内容）；`rotateIfDue` 增加 `rotateAt < 2` 与空 tail 双守卫（`:168-172`）；回归测试钉住 "deleted-active + archive → append seq 2, timeline [1,2]" |
| G-2 误删面/外来文件 | rc.72 | 归档命名严格数字 `EVENT_ARCHIVE_RE = /^events-(\d+)\.json$/`（`:46`），`listEventArchives`（`:100-113`）成为时间线/保留/迁移三方共用的单一谓词——`events-backup.json` 既不被读也不被删；`readEvolutionEvents` 隔离 readText 抛错（EISDIR 占位 → malformed、跳过，`:206-213`） |
| G-3 保留窗 vs 聚合完整性 | rc.72 | `CACHE_SNAP_EVERY = 1024` 节奏快照进 record 任务（`feedback/index.ts:146-148`）+ 折叠地板守卫：`cache.lastSeq < floor - 1` 的陈旧缓存被忽略、回退全量折叠（`:104-109`）——"结果可以缺、但绝不 fabricated" |
| H-1 curator 生命周期所有权 | rc.72 | `applyCuratorFields` 拆为 meta（quality/pinned，全树刷新）+ lifecycle（state/archived_at）两组（`usage.ts:139-163`）；`foldCuratorFields` 增加 `stateOwned` 限定（`:166-181`）；curator 以 `transitions ∪ archiveCandidates` + 成功/回滚/合并源动态补齐（`curator/index.ts:537-540,717-729,764-766`）——并发 curator 互不回滚对方归档 |
| H-3 观察项收敛 | rc.72 | 单一 `listEventArchives` helper ✅；`@deepseek-ai/dsh-llm` 在 commands 转 peerDependencies（与 review/curator 对齐）✅ |

**保持项**：审计报告归档策略（v1–v5 归档、v6 为现行基线）与 0.1.0 的 dist-tag 自动选择（prerelease→next、stable→latest，`publish-scoped.mjs:103`）语义正确。

---

## 2. 本轮新发现

### P1-1（功能正确性）`restructure` 组装路径**复制 frontmatter**：每次成功调用都写出损坏的 SKILL.md，且重复执行持续累积

- 位置：`packages/evolution-core/src/skill-store.ts:1016-1021`。
- 机制：`planRestructureSections(normalized, moves)`（`:1017`）接收的是**含 frontmatter 的全文**，其重建产物 `plan.body` 因此仍带着 frontmatter；而组装式 `newMd = normalized.slice(0, frontmatterEnd + 4) + plan.body`（`:1019-1021`）又先拼上前半段 frontmatter —— **frontmatter 拼接两遍，交界处形成 6 连字符残线**。
- 实跑证实（将 `planRestructureSections` + 切片逻辑逐字复刻后对测试夹具执行）：
  ```text
  ---                                    ← 原 frontmatter 开始
  name: demo-skill
  description: demonstrate restructure.
  ------                                 ← 残线（slice 的 "—" + plan.body 的 "---"）
  name: demo-skill                       ← 被复制的 frontmatter
  description: demonstrate restructure.
  ---
  ...正文（指针行替换正确）
  ```
- 为什么没被拦住：
  1. `validateFrontmatter(newMd)`（`:1022`）**通过**——`parseFrontmatter` 的 `indexOf('\n---', 3)` 命中交界处（`\n------` 的前四字符即 `\n---`），block 仍解析出正确的 name/description，body 非空；
  2. 全部 8 个 restructure 测试只用 `toContain`/`not.toContain` 断言（`skill-restructure.spec.ts`），**没有任何字节级/结构级断言**——双份 frontmatter 恰好满足所有 toContain。
- 后果：
  1. 旗舰功能（008-B/009-R，本版的核心卖点）**每次成功都产出损坏文件**；
  2. 对同一技能重复 restructure 时 frontmatter **逐次累积**（第 N 次的 `plan.body` 携带前 N-1 份副本）；
  3. 严格的 YAML frontmatter 解析器（含平台 skill-filesystem 的自有解析）会在**同一 block 内看到重复的 `name`/`description` 键**——许多 YAML 实现视为错误或静默 last-wins，技能在原生目录中的可见性/描述存在被破坏的现实风险；
  4. 009 设计文档对 restructure 的验收承诺是"**零行为变化**（迁移到内核，测试全绿）"——组装层这一失误直接违背该承诺。
- 修复方向：`planRestructureSections` 只接收**去 frontmatter 的 body**（或组装时取 `plan.body` 的 body 部分），并补两个测试：字节级对比成功 restructure 后的 SKILL.md；对同一技能连续两次 restructure 断言 frontmatter 只出现一份。

### P3-1（门完备性）`supportRefs` 只匹配 `.md` 与单段路径——009 完整性门的"悬空链接不可构造"宣称过强

- 位置：`skill-store.ts:384-390`——正则 `\b(?:references|templates|scripts|assets)\/[A-Za-z0-9._-]+\.md`。
- 漏网两类：①非 `.md` 支持文件链接（`scripts/run.sh`、`templates/x.yml`）；②子目录链接（`references/sub/x.md`，`[A-Za-z0-9._-]+` 不含 `/`）。这两类 body 在 append 合并/reference 降级/restructure 搬移时**不触发拒绝**，归档源后链接悬空。
- 009 设计文档的措辞是"支持目录相对引用"（不限扩展名），CHANGELOG 却宣称 *"Dangling support links are no longer constructible"*——**实现窄于设计、宣称强于实现**。建议：正则放宽为 `[A-Za-z0-9._\/-]+`（仍拒绝 `..`），或把宣称改窄。

### P3-2（注释失实）观测窗口锚点"下次读取重试"的注释与行为相反

- `skill-usage/src/index.ts` `appendUsageWindowEvent` 注释：*"the next observed read retries while no OTHER read opened the window"*。实际：锚点只在 `viewsBefore === 0` 的那次读取追加（`:observeRead`），append 失败后侧车 view 已 ≥1，**后续读取永不重试**——时间线将永久缺失 `window.opened` 锚点。功能影响为零（curator 的 `usageObserved()` 门读的是**侧车** view_count，已核实 `curator/index.ts` healthView/usageObserved），仅时间线审计链缺锚且注释误导。建议：失败时记一句 `logger.warn`（观测侧当前完全静默）并修正注释。

### P3-3（死代码/文档漂移散点）

1. `publish-scoped.mjs:31` `const tag = explicitTag ?? 'next'`——`tag` 变量在 dist-tag 自动选择改为逐 tarball 的 `distTag` 后**已无消费者**（publish 用 `distTag`），纯残留。
2. 008 设计文档宣称事件时间线扩展为 `type:'skill'`（use 聚合/restructure），实现为 `type:'usage'`（`kind:'skill'`）且 **restructure 事件只进 `evolution/skill-mutated` 进程总线、不进时间线**——"feedback 与 restructure 的先后可答"这一 008 动机只兑现了 usage 锚点一半；命名也与文档不一致。
3. `skill-store.ts:536-553、567-626` 等多处的 "One trim per entry" 注释块存在**双倍空行的合并残迹**（oxlint 不拦），纯观感。

---

## 3. 观察项（不计缺陷）

1. `applyTreeChange` 的调用方预读与内核提交之间存在**已文档化的 TOCTOU**（`skill-store.ts:1085-1089` 注释自认：回滚字节正确，但内容可能覆盖并发变更）——单进程串行下无暴露面，跨进程依赖技能树 IO 的低争用现实。
2. `CACHE_SNAP_EVERY` 快照在 record 链内做一次 O(全部历史) 的 timeline 解析（每 1024 条一次）——校准过的取舍（~100–200ms @ 10⁵ 事件）；达到 10⁶ 规模时按 007 的既定路线切 NDJSON+offset。
3. restructure/consolidate 生成的指针行硬编码中文 `> 详见 references/…`——与全英文的技能文件体例并存，属一致的风格选择（两处一致），提请确认是否有意。
4. `assessHealth` 的 `bodyChars` 用 `content.length`（含 frontmatter）——与阈值命名 "body" 有细微语义差，frontmatter 体量下可忽略。
5. 008 文档判定表如实记录了"sensing 断裂"的现场证据（usage.json 为空、record('use'/'view') 零生产调用方）并据此决策"NOT BUILD 读审计存储"——设计纪律良好。

---

## 4. 回归面抽查（历史修复未回退）

| 检查项 | 结果 |
|---|---|
| `session.append('evolution/*')`、空格命令名 | 零命中 ✅ |
| `saveUsage` 生产调用方 | 零 ✅（curator 全部经 `mutateUsage`） |
| P0-5 模糊补丁死循环 | 迭代化 `fuzzyReplace`（`scanFrom = start + newString.length`）+ 空串/纯空白边界拒绝 ✅（`:320-364`） |
| skill-usage `root=''` | `config.root || skillsRoot()` 保持 ✅（注释保留 P0-3 教训）；`eventsHome` 同款 `||` 写法 ✅ |
| prompt bundle fail-closed（v9，pinned 常量比对） | 机制未变 ✅ |
| 审批/重放 | restructure 经同一 approval 请求/重放链，`SkillWriteArgs.restructure` 透传 ✅ |
| 快照/归档不变量 | 归档即移动、snapshotAll/restoreLatestSnapshot 全树替换 + 合成 `restore` 事件（decision C 的单一失效事件）✅ |
| 测试声称 | CHANGELOG 如实标注 "296/299（3 例已知负载假失败）"——诚实，但 P1-1 恰好落在这 296 个"绿"里，见 §2 |

---

## 5. 总体评价与建议

七轮趋势：**39（6 P0）→ 7（2 P1）→ 7（1 P1）→ 6（0 P1）→ 7（0 P1）→ 3（0 P1）→ 本轮 4 项（1 P1 + 3 P3）**。前六轮的主题是"把既有架构的并发与恢复语义收口"，本轮转入**新功能开发**（008 感知/决策/行动三缝、009 树变更内核），P1 随之回到组装层——这不是收敛趋势的反转，而是"新代码面 ⇒ 新缺陷面"的正常映射，且本轮的新功能架构决策（健康维度独立、内核单一提交点、观测窗口语义）质量都高。

**建议处理顺序**：
1. **P1-1（立即）**：修正 restructure 组装（body-only 传入或切片取出），补字节级断言与"连续两次 restructure"回归——这是已发布 tag 上的功能缺陷，若 0.2.0 正式发布前不修，每个使用 restructure 的部署都会累积损坏文件；
2. P3-1：`supportRefs` 放宽到子目录与非 `.md`（或收窄宣称并记录为已知边界）；
3. P3-2/P3-3：注释、死变量、008 文档命名对齐——随手批；
4. 观察项第 1 条建议在 009 的"precondition mount"（R1-1 尚为空挂点）里顺势落一个"提交前重读比对"的挂点，把已文档化的 TOCTOU 变成机械守卫。

**统计**：本轮新发现 4 项（P1×1、P3×3）+ 5 项观察；v6 遗留 0 项；历史遗留仅 D-8（invariant 模板去重，持续搁置）。七轮累计 73 项发现，全部闭环或显式搁置。
