# dsh-evolution 第六轮审计报告（当前审计基线）

> 注：V1–V5 中间版本已在 0.1.0 正式版发布后归档删除（历史结论随六轮趋势保留于本文 §6 与本仓库发布链记录）；本文为现行审计基线文件。其全部发现（G-1…G-3）及深扫项（H-1…H-3）已在 rc.72（0.1.0 stable 内容）闭环。

| 项 | 内容 |
|---|---|
| 审计对象 | `D:\dsh\dsh-evolution-mirror` @ git HEAD `9a7d36b`（**rc.71**，2026-08-30） |
| 对比基线 | 第五轮审计（`AUDIT_REPORT_v5.md`，rc.69 `54f7714`） |
| 审计范围 | ① 逐条核验第五轮 F-1…F-7 修复；② 全量审计 rc.70→rc.71 新增/改动代码（约 +523/−30 行、13 个文件：审计批次收口 + 事件日志**分裂轮转**（007 设计：`events-<seq>.json` 归档、seq 去重时间线、数字序保留、迁移条件收紧））；③ 新增测试与设计文档（007）的"设计宣称 vs 实现"比对 |
| 约束 | 只读审计，未修改任何代码 |

**结论摘要**：v5 的 F-1…F-7 **七项全部确认修复**，其中 F-1 的修复方式值得肯定——不是简单补丁，而是把"损坏"边界重新定义为**语法级损坏 = 不可覆盖（immutable）、形状级损坏 = 可重建垃圾（replaceable）**，读写两侧共用同一边界并有测试钉住。rc.71 的轮转设计（007）是对 v5 §3 增长警告的正解：**旋转而非压缩**保住事件日志存在的意义（排序），seq 去重使崩溃窗口产出恒等时间线，数字序保留避免字典序陷阱。**本轮新发现 3 项：1 项 P2 + 2 项 P3**，全部位于轮转的 seq 派生/恢复路径；**无 P0/P1**。问题总量与严重度连续第六轮收敛（39 → 7 → 7 → 6 → 7 → 3，峰值 P0 → P1 → P1 → P2 → P2 → P2）。

---

## 1. 第五轮问题修复核验（F-1…F-7 全部确认 ✅）

| 编号 | 修复提交 | 核码证据 |
|---|---|---|
| F-1 malformed 门口径不一致 | rc.70 | 边界重定义并双侧对齐：`readEvolutionEvents` 形状损坏改判 `malformed: false`（"REPLACEABLE garbage"，`evolution-events.ts:159-166`）；append 门维持仅拒 JSON 语法损坏（`:86-88`）；条目级自愈（缺 `seq` 条目下次 append 剥离、有效条目存活）写入 `parseEvolutionEvents` 文档（`:59-64`）；测试钉住两种形状损坏（`evolution-events.spec.ts:61,75`）。口径选择与 usage sidecar 的逐字段归一姿态一致，成立 |
| F-2 `/learn` 注入绕过 createUserMessage | rc.70 | `invocation.agent.inject(createUserMessage({…}))`（`evolution-commands/src/index.ts:132-136`）；`@deepseek-ai/dsh-llm` 加入 dependencies（package.json）；spec 断言注入消息含 `role:'user'` |
| F-3 陈旧 "10 attempts" | rc.70 | 注释与 fail-loud 消息均改 40（`io.ts:133`、`:151`） |
| F-4 空聚合迁移创建空文件 | rc.70 | skip 路径返回 `current`（null 保持 null = "无文件"，transact 契约），`feedback/index.ts:215-219`；测试断言不创建文件（`feedback.spec.ts:236`） |
| F-5 缓存写与 006 设计声明不符 | rc.70 | 006 数据平面表改为如实描述："Atomic whole-file write (rename under the write lock) — not an RMW transact, the cache is DERIVED and rebuildable" |
| F-6 learn 事件失败静默 | rc.70 | `.catch` 改为 `ctx.logger.warn`（`evolution-commands/src/index.ts:144-146`） |
| F-7 清单门 regex 笔误 | rc.70 | `async function?` → `async function`；文件级（非逐写点）粒度作为 manual-review remainder 写入门注释（`sidecar-inventory.spec.ts:12-14`） |

---

## 2. 本轮新发现（rc.71 轮转引入）

### G-1（P2 · 设计宣称 vs 实现）**"active 丢失后由下次 append 重建"的恢复路径会撞号——append 的 seq 只从 active 派生，归档不参与；时间线去重的 "active 胜出" 会用新事件逐个顶替归档历史**

- 位置：`packages/evolution-core/src/evolution-events.ts:100`——`maxSeq = nextEvents.reduce(…, 0)`，`nextEvents` 仅来自 **active 文件**；归档（`events-<seq>.json`）从不参与 seq 推导。
- 007 设计文档明确宣称该恢复路径可用（§Migration interplay / Risks："A deleted active is rebuilt by the next append; the timeline before that boot comes from archives"），rc.71 的测试（`feedback.spec.ts:255`）也只验证到"迁移被抑制、active 保持缺席"为止——**此后 append 的行为未被测试，且是坏的**：
  1. active 被删（或内容为空白/形状损坏垃圾）+ 归档存在时，下一次 append 把 active 重建为 `[seq=1]`；
  2. 时间线合并（`readEvolutionTimeline:180-196`）按 seq 去重、**active 拷贝胜出**（归档先读、active 后写 map）——归档中 seq=1 的历史事件被这条无关的新事件**顶替**；
  3. 之后每次 append seq=2、3…继续与归档 seq 2、3…撞号——每 append 一次就顶替一条归档历史，聚合计数被静默污染，排序时间线交错错乱。"seqs stay globally monotonic"（rc.71 changelog 与代码注释的宣称）在该场景下不成立。
- 同根问题（同一处 seq 派生）：**`rotateAt ≤ 1` 的旋钮边界**——`rotateIfDue`（`:116-128`）在 `tail` 为空时（`rotateAt=1` 且 active 仅 1 条）锚点错误（归档名 `events-<seq-1>` 里装着 seq=`<seq>`），返回空 tail 后 maxSeq 归零，效果与上述恢复场景相同。生产默认 4000 不受影响（tail 恒非空），但旋钮无下界校验，测试用的 3 也未覆盖。
- 修复方向（成本低）：归档**文件名本身就是 seq 上界锚点**（`events-<lastArchivedSeq>.json`）——append 前取 `max(activeMaxSeq, 目录内最大归档名 seq) + 1` 即可，无需解析归档内容；`rotateIfDue` 增加 `tail.length === 0` 时跳过旋转（或校验 `rotateAt >= 2`）。补一个"deleted active + archives → append → 全局 seq 连续"的回归用例。

### G-2（P3 · 误删面）retention 的 glob 会把**非数字名**的 `events-*.json` 当最旧归档删除；外来异常条目还会让 timeline 读取中断

- `retainEventArchives`（`evolution-events.ts:131-143`）：过滤条件仅 `startsWith('events-') && endsWith('.json')`，名字解析 `parseInt(…) || 0`——用户在 `$DSH_HOME/evolution/`（用户可见目录）放的 `events-backup.json` 之类文件被解析为 0、排序为最旧，**首次旋转即被 `io.remove`**（不可逆）。建议：数字段解析失败的条目跳过（不参与保留计数、不删除）。
- 同族健壮性：`readEvolutionEvents` 对 `readText` 的抛错（如目录被误建为 `events-x.json/` 时的 EISDIR）没有 try 包裹——`readEvolutionTimeline` 会中断，`restore()` 整体失败（有 catch + warn 兜底，但本次 boot 的缓存刷新一并放弃）。低概率，与上一条合并处理即可。

### G-3（P3 · 窗口）保留窗口 vs **聚合完整性**：崩溃 + 单会话超窗流量会丢失中间计数

- 缓存（feedback.json）只在 boot（`restore`）与优雅卸载（`persistCache`）刷新；轮转剪枝发生在**append 路径**。若一个进程会话内追加量超过保留窗口（默认 10 归档 × ~2000 + 4000 active ≈ 24000 事件）后**硬崩溃**（无 dispose），下次 boot 的 timeline 只覆盖保留窗，cache.lastSeq 之前的中间事件**同时从缓存与时间线消失**——`foldWithDelta` 只能折叠 `seq > cache.lastSeq` 且仍在窗内的部分，(cache.lastSeq, 窗口起点) 之间的计数无载体。
- 007 的 "very old ordering data is explicitly disposable" 只论证了**排序数据**可弃；聚合计数（quality_score/curator 的输入）不在其列。触发条件苛刻（硬崩溃 + 单会话 > 24000 条记录），列 P3。缓解方向：`rotateIfDue` 在剪枝前把将被剪掉的最早 seq 同步进缓存（或旋转时顺带 `persistCache`），使"缓存覆盖 ≥ 保留窗下界"成为不变量。

---

## 3. 观察项（不计缺陷）

- `@deepseek-ai/dsh-llm` 在 commands 放 **dependencies**，而 review/curator 放 peerDependencies——风格不一致（两种均可工作，发布链由 prepare-release 统一重写范围）；建议与家族惯例对齐为 peer。
- `events-*` glob 谓词在 feedback（`restore` 的 archiveNames）与 core（timeline/retention）各写一份，建议下沉为 core 的单一 helper（`listEventArchives(io, path)`），顺带解决 G-2 的判定口径。
- 嵌套锁方向单一（active → archive，archive 仅在持有 active 锁时写入），无死锁面；崩溃窗口的 dedupe 测试用真实文件手写模拟，覆盖到位。
- 保留/轮转常量为 core `DEFAULT_*` 风格（`EVENT_LOG_ROTATE_AT=4000`/`RETAIN_ARCHIVES=10`），无 config 面——007 决策点 2 的取舍已被遵守。

---

## 4. 回归面抽查（历史修复未回退）

| 检查项 | 结果 |
|---|---|
| `session.append('evolution/*')`、空格命令名 | 零命中 ✅ |
| `saveUsage` 生产调用方 | 零 ✅ |
| prompt bundle v7 + plan 变体继承 | 未触碰 ✅ |
| sidecar 清单门 | 7 行 + 粒度注释（F-7）✅ |
| 迁移条件收紧（`noLog && archives.length === 0`） | `feedback/index.ts:81-90` ✅ 且有测试（`feedback.spec.ts:255`） |
| 时间线切换（restore/persistCache → `readEvolutionTimeline`） | 折叠函数不变、seq 排序契约满足 ✅ |
| 006 文档（F-5 措辞） | 已如实 ✅ |
| 发布链（PLATFORM_VERSION/platform-ranges/layout-sync） | 未触碰 ✅ |

---

## 5. 上游接口增量（0.1.1-rc.2）

本轮 rc.70/71 未新增上游依赖面：`createUserMessage` 是 v4 已核验的既有导出；事件日志/轮转纯 core + IO seam。无新接口风险。

---

## 6. 总体评价与建议

六轮趋势：**39 项（6 P0）→ 7（2 P1）→ 7（1 P1）→ 6（0 P1）→ 7（0 P1）→ 3（0 P1，1 P2 + 2 P3）**。审计驱动的修复循环连续六轮把严重度峰值压在 P2 以下趋势明确；rc.70 的批次收口与 rc.71 的轮转设计（007）质量俱佳——特别是 F-1 的"边界重定义"与 007 的"旋转非压缩"都是正确且有余量的架构决策，而非最小补丁。

本轮唯一的 P2（G-1）是**新能力宣称与实现的缝隙**：007 在设计文档里写下了"删掉 active 也能恢复"的承诺，实现只兑现了迁移抑制那一半，append 侧的 seq 推导没有跟上。这类"设计文档宣称 > 实现覆盖"的缝隙是前六轮首次出现，建议作为下一批次的第一项，并补上该恢复路径的端到端回归（deleted active + archives → append → 全局 seq 连续、无顶替）。

**建议处理顺序**：
1. G-1：append 的 seq 派生纳入归档名锚点 + `rotateIfDue` 空 tail 守卫 + 恢复路径回归测试（小改动，指向明确）；
2. G-2：retention 跳过非数字名 + `readText` 抛错隔离（与 G-1 同文件同批）；
3. G-3：剪枝前缓存下界不变量（可并入下一次设计评审，与 §3 观察项的 glob helper 一起做）。

**统计**：本轮新发现 3 项（P2×1、P3×2）+ 3 项观察；v5 遗留 0 项；历史遗留仅 D-8（invariant 模板去重，持续搁置）。六轮累计 69 项发现，全部闭环或显式搁置。
