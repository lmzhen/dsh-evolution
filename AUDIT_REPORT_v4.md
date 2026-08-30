# dsh-evolution 第四轮审计报告（最新版本 rc.66）

| 项 | 内容 |
|---|---|
| 审计对象 | `D:\dsh\dsh-evolution-mirror` @ git HEAD `9f0f729`（**rc.66**，2026-08-30） |
| 对比基线 | 第三轮审计（`AUDIT_REPORT_v3.md`，rc.62 `980b60b`） |
| 审计范围 | ① 逐条核验第三轮 M-1…M-7 及自查项修复；② 全量审计 rc.63→rc.66 新增/重写代码（约 +625/−173 行：curator 提名通道双后盾、review 通道变体 persona、memory/feedback/state-json/写锁四处并发收口、守卫脚本加固、死代码私有化） |
| 约束 | 只读审计，未修改任何代码 |

**结论摘要**：v3 计划的 M-1…M-7 **七项全部确认修复**，且开发者自查清单的 6 项（skillUsage 遥测事务化、state-json 全事务化、写锁 TOCTOU fail-loud、state-domain 错误面精确化、graph 命令 HMR 绑定、registerRunner 重复抛错）也全部落地。M-1 的修复质量尤其好——提示词层（提名者视图 + "唯一产出 = YAML 块"硬约束）与执行层双后盾（consolidations 池过滤 + `applyMutations` 对池外提名的可见拒绝）同时收紧。**本轮新发现 6 项**：2 项 P2（curator 两条控制面路径的 usage 整文件写逃逸了事务化迁移、运行窗口快照覆盖丢计数）+ 4 项 P3。**无 P0/P1**，问题总量与严重度连续第四轮收敛（39 → 7 → 7 → 6，且严重度峰值 P0→P1→P1→P2）。

---

## 1. 第三轮问题修复核验（M-1…M-7 全部确认 ✅）

| 编号 | 修复提交 | 核码证据 |
|---|---|---|
| M-1 提名通道 vs 执行现实 | rc.63 | CURATOR_PROMPT 工具集段删除，替换为 "You are a NOMINATOR, not an executor: this channel has NO tools… Return ONLY the YAML block"（`prompts.ts`）；双硬后盾：`recommend()` 的 consolidations 过滤到候选池（`evolution-curator/src/index.ts:288`），`applyMutations` 对池外 from 可见拒绝并入 report.failed（`:709-715`）——幻觉提名再无落地路径 |
| M-2 review persona vs 工具过滤 | rc.63 | `SKILL_REVIEW_PLAN_PROMPT`/`COMBINED_REVIEW_PLAN_PROMPT` 通道变体（bundle v6，双变体入 digest 且契约测试钉住）；subagent 用 `reviewPrompt(kind, 'plan')`（`evolution-review/src/index.ts:234`），inject 路径保持操作性原文（`:176`）——通道与措辞一一对应 |
| M-3 pruning 池失控 | rc.63 | `gatedNominations.prunings` 二次过滤回 `result.markStale`（`:487-489`）——活跃非 stale 技能不再可经 LLM 提名归档，回归测试钉住 |
| M-4 失败伪造空文件 | rc.63 | `core.write ?? (current ?? null)`——缺失文件上失败返回 null（DELETE 对不存在文件是 no-op，`memory-store.ts:233-235`），测试断言失败后文件仍缺失 |
| M-5 layout-sync 幽灵路径 | rc.63 | `--auto` 与硬编码 `D:/dsh/...` 移除，双路径必填参数 |
| M-6 覆盖面声明失实 | rc.63 | 头注释如实声明"仅比 scripts/ 树；packages/ 是 normalize-mirror 发布面，--deep 留待" |
| M-7 散点 | rc.63/64 | platform-ranges 在 `--our-scope @deepseek-ai` 时 fail-loud 并提供 `--family-prefixes`（守卫不再可能空转）；`parseState` 排除数组；systemPrompt 软探测 vs approval 硬 inject 的"按依赖强度区分"理由写入注释 |
| （自查）写锁 TOCTOU | rc.65 | 重试预算耗尽由"无锁放行"改为 **fail-loud throw**（`io.ts:144`）——7!=8 的 CI 丢更新（两写者同时无锁进入）被关闭；方向正确（数据完整性优先于可用性，且工具层错误可重试） |
| （自查）锁活性探测 | rc.66 | >5s 陈旧锁接管前读取 holder pid 并 `process.kill(pid, 0)` 探活：活持有者永不被夺锁，死 pid 才接管（`io.ts:99-107,131-136`）；pid 复用被注释为剩余 best-effort 面。测试覆盖活/死两向 |
| （自查）state-domain 错误面 | rc.64 | 仅捕获 `DomainError('missing-key')`（已对照上游 `storage-domain/src/error.ts:11,34` 确认该类与 code 真实存在），closed/backend 故障向上传播——"已解决"误报不再吞掉真实故障 |
| （自查）graph 命令 HMR 绑定 | rc.64 | `commandCtx.effect(() => commands.register(…), 'evolution-learning-graph.command')`——注册 dispose 绑定 fiber，reload 不再复制命令 |
| （自查）registerRunner 重复抛错 | rc.65 | 重复 kind 抛错（对齐 registry.registerProvider 语义），不再静默遮蔽 |
| （自查）死代码 | rc.65 | 5 个无测试消费的导出私有化（`EVOLUTION_SKILL_RANK/CAPABILITY_NAME_RE/scorePlan/collectReadSkillNames/COUNTER_SWEEP_THRESHOLD`）；幽灵 `index.d.ts` 删除；`mergeStates` 随 flush 退役删除 |

**工程亮点（保持项）**：sidecar 事务清单门继续发挥作用——本轮 feedback 从"flush 合并"重构为"每条记录入 transact"（跨进程同目标丢增量关闭，回归测试断言两实例并发记录后磁盘为精确和），退役的 flush 被 `waitIdle()` 卸载等待取代；state-json 的 claim/release/resolve/save 全部迁入 `jsonTransact`（跨进程 RMW 最后一处裸写关闭）；memory 的 oversized 读守卫上移到 transact 之前（锁内"never loaded"契约恢复成立）。

---

## 2. 本轮新发现（rc.63→rc.66 引入/暴露）

### K-1（P2 · 迁移遗漏）curator 控制面 `consolidate()`/`restore()` 仍是整文件 `saveUsage`

- 位置：`packages/evolution-curator/src/index.ts:917`（consolidate，loadUsage → 改 state/archived_at → `saveUsage`）、`:933`（restore，同模式）。
- rc.66 把 `applyMutations` 的使用侧写迁到了 `mutateUsage`（transact 折叠，`:752`），但同一文件里这两条 `/evolution consolidate`、`/evolution skill restore` 控制面路径**逃逸了迁移**：仍是 load→改→整文件写。两个进程并发时（如 curator run 与人工 restore 交错），整写会clobber 对方刚落的记录——正是 sidecar 事务清单要杜绝的类。清单门测试只检查"文件内有 transactIo"，curator.ts 因 applyMutations 已含 transactIo 而通过，**门对文件内个别调用点不敏感**（这是门粒度的已知局限，本轮首次实际暴露）。
- 建议：两处改为 `mutateUsage(root, io, disk => { … disk 字段折叠 … })`；顺带考虑把清单门升级为"每文件 transactIo 调用数 ≥ 该文件 RMW 写点数"的人工核对注释，或加 lint 规则禁止 `saveUsage` 直呼。

### K-2（P2 · 剩余竞态窗口）runCore 的 usage 折叠按**记录整体**覆盖，运行窗口内的并发计数 bump 丢失

- 位置：`evolution-curator/src/index.ts:752-754`——`mutateUsage` 内 `for (const [name, record] of usage) disk.set(name, record)`：`usage` 是 **run 开始时**（`:444` loadUsage）的快照，当 run 含 LLM 提名时窗口可达分钟级；窗口内另一进程对某技能的 `use_count` bump 会被快照旧值整体覆盖（rc.66 之前是丢全部，现在丢窗口内的）。
- 建议：折叠按**字段**而非记录——curator 只拥有 `state / archived_at / quality_score / quality_warn / pinned`（seedBaseline 镜像），计数器字段保留 disk 现值：`disk.set(name, { ...diskRecord, state: r.state, archived_at: r.archived_at, quality_score: r.quality_score, quality_warn: r.quality_warn, pinned: r.pinned })`。K-1 的两处同理。
- 定性：与第一轮 P2-2、第三轮 P3-① 同族的跨进程丢更新，属该收敛过程的最后两块（K-1 路径 + K-2 字段粒度），非新架构缺陷。

### K-3（P3 · 软硬约束再脱节）计划通道提示词丢失 read-before-write 措辞，机械守卫仍在

- rc.59 重写 SKILL_REVIEW_PROMPT 时删掉了 "Only update skills you loaded or read in THIS session; never touch skills you have not read"（本轮 grep 确认 prompts.ts 已无此句）；执行器 `filterUnreadSkillOps`（F19 硬守卫）仍在，未读技能的 op 会被丢弃并计入 rejectedOps。后果不是违规写入，而是模型按提示词可能产出更多注定被拒的 op（review 效率下降、rejectedOps 噪声）——与 rc.64 修正的"referenced skills 提示词承诺引擎未实现的行为"（M-1 同类：提示词-引擎一致性）同族。建议在 SKILL_REVIEW/COMBINED（含 plan 变体）补回一句读取前置约束。

### K-4（P3 · 注释失实）`evolution-review/src/index.ts:240-242`

- rc.64 把 `childReads` 采集移到 `await run.result` 之后（M-4 修复），但 try 前的注释仍是 "Capture the child session before dispose"——时序描述与新实现不符（意图"dispose 前读取"仍成立，纯注释债）。

### K-5（P3 · 格式）`evolution-commands/src/index.ts:91`

- `if (input === 'curator report') {          const curator = …` 行内挤压仍在（v3 轮已见，M 批次未覆盖）。

### K-6（P3 · 潜伏参数错配）feedback `record(target, rating, note, kind, io)` 的 io 参数与构造 io 可不一致

- `record` 优先用调用方传入的 `recordIo`，但 `path` 固定来自构造时 io 对应的 home（`constructor` 里 `this.path`）——若调用方传不同后端的 io，会出现"路径按 A 后端推导、写入走 B 后端"的错配。当前仓库内唯一调用方（apply 桥）不传该参，纯潜伏面；建议删除该参数或绑定 path 校验。

---

## 3. 上游接口与发布口径（0.1.1-rc.2）增量

- `DomainError`/`missing-key` import 与上游 storage-domain 真实导出对齐（`packages/storage/storage-domain/src/error.ts:11,34`）——rc.64 的错误面精确化不是凭空假设。
- 发布口径维持 rc.56 的单点 `PLATFORM_VERSION: 0.1.1-rc.2`，双锚点 + 机械守卫链未变；layout-sync/platform-ranges 两个守卫的参数与本仓库布局一致（`@lmzhen` scope 下守卫有效）。
- 提示词 bundle v6（skillPlan/combinedPlan 入 digest）——混合版本 fail-closed 设计不变。
- 死代码面：rc.65 的 5 项私有化后，抽查确认 `graphDensity/gateConsolidations` 等 test-consumed 导出保留有声明理由；`loadMutations`/`buildLearnPrompt` 等均有生产消费方。无新增死代码。

---

## 4. 总体评价与建议

四轮趋势：**39 项（6 P0）→ 7 项（2 P1）→ 7 项（1 P1）→ 6 项（0 P1，2 P2 + 4 P3）**。本轮的全部新发现都集中在同一主题——**"curator 对 usage sidecar 的写路径收敛做了一半"**（applyMutations 已事务化并按记录覆盖，consolidate/restore 未迁移；记录覆盖应再细化为字段覆盖）。这属于同一收敛曲线的收尾工作，不是新架构问题。

三轮审计驱动的修复质量值得肯定：M-1 的"提示词 + 解析过滤 + 执行拒绝"三层收口、rc.66 的锁活性探测、sidecar 清单门持续抓漏（本轮 K-1 恰好暴露了门粒度局限），以及每轮"修复前红"的回归测试纪律（本轮新增 +10 个测试文件级断言，222→含新增的本地全绿）。

**建议处理顺序**：
1. K-1：consolidate/restore 两处迁入 `mutateUsage`（改动极小，且与 sidecar 门语义对齐）；
2. K-2：usage 折叠改字段粒度（curator 权威字段集：state/archived_at/quality_score/quality_warn/pinned）——与 K-1 同一 PR 顺手完成；
3. K-3：SKILL_REVIEW/COMBINED 补回 read-before-write 句（含 plan 变体，bundle 升 v7）；
4. K-4/K-5/K-6：注释、格式、参数面随手清。

**统计**：本轮新发现 6 项（P2×2、P3×4）；v3 遗留 0 项；历史遗留仅 D-8（invariant 模板去重，持续搁置）。审计-修复循环到本轮已覆盖前三轮全部 52 项发现，未修复项为零（除主动搁置项）。
