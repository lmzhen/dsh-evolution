# 合并设计裁决记录（2026-10-23，v2 扩写）

> 状态：已裁决。本文优先于 integration-discussion.md 与 merge-architecture-optimization.md 中与本文冲突的旧表述。
> 范围：D1–D4（落地审计，原文保留）＋ D5–D13（按 docs/merge-architecture-review.md §10 Lead 拍板扩写：ADR-1 事务/锁/恢复、ADR-2 包与版本、ADR-4 迁移/兼容/保留）。
> 依据：reviews/61-landing-gap-audit.md、reviews/62-integration-coverage-matrix.md、merge-architecture-review.md §10、task-36/41 平台/后端评审与 ADR-1 终裁。
> 边界：查询/命令/UI（ADR-3）归 merge-functional-spec-v2.md 与 merge-wire-contract.md；engine 边界归 merge-engine-boundary.md；RG/K 门禁归 merge-architecture-gates.md。本文只扩 ADR-1/2/4。

## D1 staging 时序：decide 之后

**裁决**：采用口径 B。resolve 后先 decide，child 只读源，不建 staging；approve 之后才 stage，从当时活树复制两源；pending 不产生 staging。

**理由**

- pending 只存名字、decision、target/sources、三句摘要，不存正文。
- 源在 pending 期间被改、归档、改名时，approve 重新 resolve，能走 source-gone/source-changed，不会被旧草稿掩盖。
- 不产生 pending 期间无人认领的 staging 目录，减少 7 天孤儿。

**后果**

- agent1 的 cwd 不再是 staging，改为只读源目录；prompts 中“读 staging 源”表述要改。
- approve 必须重新 resolve + 重新 stage；不能复用 pending 前的 child 草稿。
- staging 生命周期只覆盖 agent2；cleanup 仍按 run 保留 7 天。
- 需要新增“approve 时源已变”的测试，不能只测同 child 正常路径。

**已同步文档**

- integration-discussion.md §3.4 流程图与 bullets。
- §3.3-2 / §4.2 的“pending 不产生 staging / staging 只在 agent2 后产生”成为一致口径。

## D2 undo 的 --run 与 --retry

**裁决**：undo 的 --run 必填，省略不猜最新；--retry 是布尔开关，不是取值参数。

**理由**

- 多代合并/重复合并时，省略 --run 会引入“最新是哪次”的歧义，容易撤错代。
- receipt/unit 以 runId 为锚；必填与底层 unit undo 直接对齐。
- --retry 的语义是“是否重跑”，不是“重跑哪个 id”；id 由 positional 参数或当前行决定。

**后果**

- 命令形状：merge undo <target> --run <id>；merge resume --retry <id>；merge candidates --retry <id>。
- parser/help 的“取值参数表”只收 --run、--restore；--retry 作为 flag 单独处理。
- §3.6 的旧写法 undo <target> [--run <id>] 作废。
- 增加“省略 --run 报错”的 parser 测试。

**已同步文档**

- integration-discussion.md §3.6、§4.1 参数说明。

## D3 审计粒度：一个 merge unit + N 条 per-skill mutations

**裁决**：v1 采用 1+N。一个 merge 写一个 merge unit（target + sources[] + runId）；底层复用 SkillLibrary 既有 per-skill mutations，不新增 merge 级事件流。

**理由**

- 不另造事件/activity/replay 类型，复用现有 create/update/archive/audit 底座。
- merge unit 提供事务级锚点，1+N 条 per-skill mutation 提供细粒度审计。
- 历史/面板/undo 按 runId 聚合，而不是要求每条 mutation 自带 merge 语义。

**后果**

- 一次 merge 的审计账本不是 1 条，而是 target mutation + 每个源 archive mutation；消费方必须按 runId/merge unit 聚合。
- merge unit 必须稳定写 runId；否则历史/undo 无法把 1+N 归组。
- “无 partial success”靠 merge unit + 回滚/补偿保证，不靠单条 ledger 的原子性。
- §3.11 旧表述“一次 merge 一条 mutation/事件”作废。

**已同步文档**

- integration-discussion.md §3.11；§5.2 的“既有 per-skill mutations”保留并明确。

## D4 数据布局：单 merge-state.json（显式例外）

**裁决**：v1 保留单 evolution/merge-state.json 存 pending/skipped 行；不拆 merge-pending.json / merge-skipped.json。runs 仍走 run registry。

**理由**

- 单文件一次原子写，当前规模小，实现/事务简单。
- pending/skipped 都是 pair 行，共用 pair 键、createdAt/updatedAt、queue 投影；拆文件会引入跨文件事务和双写一致性问题。
- 这是对 §3.7 三文件设计的显式例外，不是遗漏。

**代价与必须补的保障**

- 损坏半径覆盖全部队列：必须有损坏 note、备份/恢复、迁移策略。
- 单文件写入串行：写路径必须走同一 mutex/transact。
- 队列清理/迁移需要按 rows 过滤，不能按文件删。
- 如果未来队列规模/隔离要求上升，再评估拆文件；拆时必须一次迁移并保留旧文件只读备份。

**已同步文档**

- integration-discussion.md §3.7 表与裁决注记。

## 后续实现顺序

1. D2 parser/help（小，先落）。
2. D1 staging：agent1 改只读源、approve 重 resolve/restage、测试。
3. D3 merge unit/runId 聚合；不新增事件流。
4. D4 单文件损坏/备份/迁移保障。

---

## 0. 覆盖与保留（v2 增补，先读）

### 0.1 既有 D1–D4 的状态

| 裁决 | 状态 | 增补/覆盖说明 |
| --- | --- | --- |
| D1 staging 时序（decide 之后） | **保留** | 与 D5–D8 一致：pending 不产生 staging；approve 必须重新 resolve + 重新 stage；恢复四分支（D8）不依赖 staging，只用 evidence 与活树 revision。 |
| D2 undo --run / --retry | **命令形状保留，子项被覆盖** | `merge undo <target> --run <id>` 必填、`--retry` 为布尔开关：保留。D2 中"parser/help 的取值参数表只收 --run、--restore"这一实现子项，自 0.31 起由 ADR-3 的 CommandSurface（v2 §10.1 / wire §10，catalog 生成 parser/help/UI）接管；旧的可选 --run / 旧 resume 形状按 D10 给一个发布周期的迁移提示。 |
| D3 审计粒度（1 unit + N mutations） | **保留并扩写** | unit 必须稳定写 runId，升格为 D5 的 evidence 不变量；"无 partial success 靠 unit + 回滚"由 D5/D8 强化——host 侧补偿/裸写不再是权威。 |
| D4 单 merge-state.json | **保留并加硬性保障** | 增加 last-known-good 备份、原子替换、损坏 note/恢复、迁移 dry-run（D10/D12）；任一缺失按 K10 拒绝发布。 |

### 0.2 被本文覆盖的外部表述（只列冲突项，不重复原文）

| 旧表述所在 | 旧口径 | 由谁取代 |
| --- | --- | --- |
| merge-architecture-optimization.md §2.6 | tree/target/run 三个独立 lease，各带 TTL | **D6**：一个 commit fence（tree lock token=epoch）+ commit 期 target claim；取消三套 TTL。 |
| merge-architecture-optimization.md §2.6 | 把 commitMerge 拆成公开多阶段（prepare/apply/archive/finalize）供 host 调 | **D5**：core 持不透明 UnitTransaction；拆分被明确 reject。 |
| merge-architecture-optimization.md §2.5 | eligibility 的 `snapshot: string` 语义未定 | **D6/D9**：snapshot = gates 配置摘要（excluded/referenced/suppressed 排序 hash）+ 求值时间。 |
| design/g6-commit-undo.md | journal 相位早写、恢复决策未接自动回放、snapshot 非持久 | **D8**：journal 只存 intent；恢复四分支 + 自动回放；证据持久化。 |
| 0.30.15 现状 | commit-execute 在提交前写 `sources-archived`；恢复裸写活树；receipt 是唯一记录 | **D5/D8**：0.30.16/17 临时修（P0），0.32 由 UnitTransaction/evidence 收口；host 不得写树。 |
| 任何"run registry 参与恢复/调度/重试"的设想 | registry 兼执行器 | **D7**：只做唯一持久/所有权源；执行/恢复由 host 用例层负责。 |
| 任何"0.31 就进 schema 3 / Row 联合"的设想 | 0.31 schema 3 | **D9**：0.32 才做，且 RG0+RG1 未过不得开工。 |
| 本文原"后续实现顺序"（旧 92–97 行） | D2→D1→D3→D4 | **D13**：按 0.30.16/17 → RG0/RG1 → 0.31 → RG2/RG3 → 0.32 → RG4–RG8。 |

---

## D5 UnitTransaction：core 唯一事务所有者（ADR-1）

**裁决**：SkillLibrary 持**一个不透明 UnitTransaction**；merge/host 只提交 plan + 提供 journal hooks，绝不写活树。事务有四个方法：prepare / commit / verify / rollback；unitId 由调用方提供且幂等；evidence 由 core 持久；rollback 只能被 evidence 授权。拆分 core 内核成公开多阶段、或 host 自己补偿回滚，均 **reject**。

**不变量（缺一不可）**

1. **无长事务**：prepare/verify 只读、不进 serial；commit 是唯一 serialized 原子段；rollback 是另一个独立 serial 段。任何"事务跨 hook 持有锁/占用 ROOT_SERIAL"的实现都算违约。
2. **unitId 调用方提供且确定**（如 `u-merge-<runId>-<pairHash>`），core 不再随机生成。同 unitId + 同 planDigest：返回已存 evidence、零写入（幂等 replay）；同 unitId + 不同 digest：拒绝 `unit-conflict`。
3. **evidence 由 core 持久**（不靠 host receipt）：至少 `{unitId, runId, state, target{beforeHash, afterHash, supportDigest, created}, sources[{name, beforeHash, afterHash?, archived, absorbedInto?}], mutations, at}`。UnitHead 必须带 runId。
4. **rollback 由 evidence 授权**：仅 `state ∈ {target-only, sources-partial}` 且盘上 hash 与 evidence 相等时允许；`complete` 一律拒绝，走 undo（append-only 历史）；rollback 自身写一个 rollback unit。
5. **hooks 只做 I/O**：commit 期间可回调 `onPhase('target-written'|'sources-archived', partialEvidence)`，供 host 写 journal；hook 内禁止调用 SkillLibrary 变更 API；hook 异常/超时降级为 warning，绝不改变提交结果，也不延长提交锁窗口超过约定值。

**签名（冻结）**

    export interface UnitPreparePlan {
      unitId: string; runId: string
      target: string; targetExists: boolean; sources: readonly string[]
      body: string; supportFiles: readonly { path: string; content: string }[]
      expectedTargetBody: string | null; expectedTargetSupportDigest: string | null
      expectedSources: readonly { name: string; body: string; supportDigest: string }[]
      origin: WriteOrigin; summary: string
    }
    export type UnitEvidenceState = 'absent' | 'target-only' | 'sources-partial' | 'complete'
    export interface UnitEvidence {
      unitId: string; runId: string; state: UnitEvidenceState
      target: { beforeHash: string | null; afterHash: string; supportDigest: string; created: boolean }
      sources: readonly { name: string; beforeHash: string; afterHash?: string; archived: boolean; absorbedInto?: string }[]
      mutations: number; at: string
    }
    export interface UnitHooks {
      onPhase?(phase: 'target-written' | 'sources-archived', evidence: Partial<UnitEvidence>): void | Promise<void>
    }
    prepare(plan): Promise<{ ok: true; prepared: { unitId: string; planDigest: string } }
      | { ok: false; code: 'protected' | 'invalid' | 'cas-mismatch' | 'unit-conflict'; message: string }>
    commit(prepared, hooks?): Promise<{ ok: true; evidence: UnitEvidence }
      | { ok: false; code: string; message: string; evidence?: UnitEvidence }>
    verify(ref: { unitId: string } | { runId: string }): Promise<UnitEvidence | null>
    rollback(evidence: UnitEvidence, reason: string): Promise<{ ok: true; evidence: UnitEvidence }
      | { ok: false; stuck: readonly string[]; message: string }>

**配套改动**：CommitMergePlan 增加 `unitId/runId/expectedSupportDigest`（现只 CAS SKILL.md）；`writeProtection` 对 pinned **无条件拒绝**（不再只拒 background_review）；archive 暴露 `isAbsorbedInto(source,target)` 或幂等错误码；旧 `commitMerge(plan)` 保留一版兼容包装。

**验收**：G1（静态：merge 无 node:fs 写、无 SkillLibrary 变更调用）、G2（崩溃矩阵：complete 绝不回滚、mutations 恰 1+N、action=merge 版本恰 1）、G3（幂等 replay 三次零新增）、G5（pinned/bundled/hub/protectionUnknown 在 commit 期拒绝）。

---

## D6 一个 commit fence + commit 期 target claim

**裁决**：正确性只由**一个 commit fence** 保证：tree lock 的 `token` 即 epoch；只有提交段持锁；target claim 只在 commit 阶段取；**不做 tree/target/run 三套 TTL**。run 没有独立 lease（所有权在 run registry 行，见 D7）。

**不变量**

1. **顺序固定**：tree fence → target claim；释放逆序；持有任一锁期间禁止阻塞等待另一把锁。
2. **approve 不得跨 run 持 target claim**：现在 approve 先 claim 再起 run 的实现必须改；claim 在 commit 阶段按**实际 target**（含 `-v2` 后缀与墓碑检查）取，prepare 阶段解析 actual 并写入 row/pending。
3. **无 TTL 抢锁**：claim/fence 只在 pid 死亡时回收；禁止"租约到期即夺"。correctness 全由 fence 保证，claim 只是准入。
4. **fencing**：每个写阶段前调用 `assertHeld(io, home, token)`；epoch 变即中止（不写、不归档、不结算为成功）。core 的 `acquireTreeWriteLock` 增 `expectEpoch` 与 `assertHeld`；`readTreeLock`（已有）供 fencing。
5. **修正注释与语义**：`tree-lock.ts` 第 4 行"merge run 持锁全程"作废，改为"只有提交段持锁；run 其余阶段不持"（与第 10–12 行一致）；curator 取同一把锁。
6. **target claim 与 target 串行**：同 target 的提交由 fence 串行；claim 抢不到 → 该对 park（fuse/tree-busy 或 claim-busy，可重试），不得等待持有 fence。

**理由**：三套 TTL 会产生"到期被抢但原进程仍在写"的 split-brain；pid 复用与 TTL 抢锁互相打架；run 侧再设 lease 与 registry 所有权重复。

**验收**：G4（approve 与 pair/scan 并发单赢家且无死锁；人为改 token → 写前中止；curator 持 fence 时只等待/park；两进程同时恢复同一 journal 一赢）。

---

## D7 run registry：唯一持久/所有权源，只记账

**裁决**：run registry 是 run 的**唯一持久与所有权源**（begin/stage/settle/pid/plane），但**不做执行、调度、重试、恢复**；执行/恢复属于 host 用例层。display 层不得自行推断终态或合成状态。

**必须补的 typed 生命周期 API**

    ensureLoaded(): Promise<{ ok: boolean; note?: string }>
    findActive(id): { row: RunRecord; owned: boolean; alive: boolean } | undefined
    cancel(id): { cancelled: true } | { cancelled: false; reason: 'not-found' | 'foreign' | 'terminal' }
    settleOrphan(id, input: { reason: 'interrupted' | 'orphan'; at: number }): boolean   // 仅 pid 已死允许

**约束**

- 恢复前必须 `await ensureLoaded()`（现在 `void load()` 后立即恢复，`find` 只读内存 Map，会把活 run 的 journal 当死恢复）。
- 行保持轻量：runs.json 只存 `command/stage/progress/parentRunId/stagingRef/pairKey/mergeStatus/pid/终态` 等；pair 明细与 hash 走 pairIndex（已有 sidecar），不得把 pairs 全量写进 runs.json。
- foreign 行不可 cancel、不可由非恢复路径结算；`settleOrphan` 只在 pid 已死时成功并写原因（interrupted=本机历史、orphan=他机/他进程）。
- registry 不新增 TTL、定时器、重试循环。

**验收**：G6（load 前 findActive 正确、恢复不动 owned+alive、foreign cancel typed、settleOrphan 仅 pid 死可成）。

---

## D8 恢复四分支（journal 只存 intent，evidence/receipt 权威）

**裁决**：恢复按 evidence 定相，分四支：**finalize / roll-forward / rollback / refuse-manual**。已提交（unit complete 且全部源已归档）**绝不回滚**；journal 只存 intent，不存"完成事实"。

| 分支 | 判定（evidence 优先） | 动作（全部幂等） | 终态 |
| --- | --- | --- | --- |
| 1 finalize | unit 为 `complete`：target 已写且所有源 `absorbedInto=target` | 缺 receipt 时用 evidence 补写；journal→committed；结算 run | succeeded（recovered） |
| 2 roll-forward | unit 为 `target-only/sources-partial`，且 `target.afterHash` 与 evidence 相等、未归档源 live hash 仍等于 `beforeHash` | 继续归档剩余源（已归档二次调用视为成功）→ finalize | succeeded（recovered） |
| 3 rollback | 无 unit（或 verify 返回 null），且 target hash 等于 before 或 target 不存在 | 在 fence 内 `rollback(evidence)`（内核内、写 rollback unit）；恢复源 | failed（recovered） |
| 4 refuse-manual | target hash 既非 before 也非 after；或源 revision 与记录不符 | **零写入**；置 `mergeStatus=interrupted` + `failure.code=recovery-blocked`；面板/doctor 可见 | interrupted（待人工） |

**规则**

1. journal v2 只存 intent：`{schemaVersion:2, runId, unitId, planDigest, attempt, phase:'intent'|'committed'|'rolled-back'|'failed'|'blocked', evidence?, at}`；提交前不得写"已完成"相位（现 0.30.15 提交前写 `sources-archived` 的行为作废）。
2. 恢复执行条件：持 **tree fence** + journal CAS claim（attempt token）只执行一次；两进程不能同时恢复；动作幂等（receipt 重写同字节、归档二次视为已吸收、journal 终态 CAS）。
3. journal 写必须 `transactIo` CAS（expected phase+attempt），不得裸 `writeText`。
4. 恢复结束必须结算 run（succeeded/failed/interrupted）并写报告 note；不得让 run 永久停在 running。
5. 恢复不依赖 staging（D1）：分支 2 只用 evidence + 活树 revision。

**验收**：G2（崩溃点矩阵）、G3（恢复回放幂等）、G4（双恢复互斥）。

---

## D9 包拓扑与发布矩阵（ADR-2）

**拓扑裁决**

1. 一个服务端产品包 `dsh-evolution-merge`（含 merge 用例/命令/路由/设置/事务适配），merge-ui 为**独立 client 包**（只渲染 MergeView，不含业务规则）。
2. engine 保持 **pinned 私有库依赖**：本轮不内部化、不 fork vendor；发布字节 parity 必须可证（UPSTREAM.json hash、许可、精确版本）。
3. merge 的 manifest **不得留 `workspace:^`**（发布形态必须是精确版本依赖）；engine 升级只能通过变更 pin 版本 + parity gate。
4. 0.30.x 期间 schema 固定 2；schema 3 只在 0.32 且 RG0+RG1 通过后开工。
   > 2026-10-25 修订（A12/OI-13）：0.30.18 实际已按 schema 3 发布，本句的版本矩阵作废；schema 3 是当前基线，D9 只保留包拓扑/兼容原则，版本时点以实际发布为准。
   > 2026-10-26 校准：当前基线为 0.30.26（schema 4），下表 0.30.16/17、0.31、0.32 行是历史计划标签，不是当前发布矩阵；0.32 已无发布点。

**发布矩阵**

| 版本 | 范围 | schema | 前置 gate | 回滚 |
| --- | --- | --- | --- | --- |
| 0.30.16/17（P0 hotfix，可拆两次） | ① approve/resume detached；② target managed/pinned/protected 在提交期强校验；③ journal/恢复的临时修（禁止提交前写完成相位、恢复不裸写、receipt/evidence 校验）；④ engine C8 配置 allowlist；⑤ engine parity 证据（UPSTREAM/许可/精确版本） | 2 | P0 复现套件全绿；API web 真机；回滚演练 | 回 0.30.15（schema 2 内） |
| 0.31（RG1） | 端口化（UnitTransaction/SkillLibrary 只读面/Eligibility/GateSet）、CommandSurface、MergeFacts+Reconcile（只读原型）、eligibility/lock 接线；schema 2；/merge alias 发弃用提示 | 2 | RG0 ownership matrix + RG1 fixtures/备份/对账/no-downgrade 全绿 | 回最近 0.30.x |
| 0.32（RG2/RG3） | schema 3（Row 判别联合/迁移）、UnitTransaction 收口、commit/journal 全新实现、UI 薄化 | 3 | RG0+RG1+RG2+RG3 全绿；迁移 dry-run | **迁移后不可降级**（no-downgrade gate） |

**验收**：G8（包/engine parity：UPSTREAM hash、许可、精确依赖、无 workspace:^）、G9（版本矩阵与回滚/no-downgrade）。

> 2026-10-26：版本矩阵按上述校准降为历史记录；当前交付基线 0.30.26 / schema 4。

---

## D10 兼容窗口

**裁决**

1. schema 2 保持到 0.32；v3 迁移**一次完成**，旧文件只读备份，不做长期 v2/v3 双写。
2. `/merge` alias：0.31 发弃用提示，0.32 删除；旧 `resume`/`undo` 形状（可选 --run 等）给一个发布周期的迁移提示后再收紧。
3. journal v1→v2：旧 journal 只读兼容（可被恢复识别），新一轮提交只写 v2；不迁移旧 journal。
4. run registry 新字段全部 optional：旧读者忽略未知字段；0.29 写→0.30 读需验证（反向在新版本写旧版本读不承诺）。
5. 降级窗口：0.30.15↔0.30.x 可互回；0.31 可回 0.30.x；0.32 迁移后禁止降级（RG no-downgrade）。回滚演练必须在 0.30.16 发布前完成一次。

**验收**：G9（迁移/降级矩阵逐格测试）。

> 2026-10-26 校准：0.30.26 / schema 4 已越过上述 0.31/0.32 计划；第 1、2、5 条的版本时点降为历史记录，兼容原则仍有效（旧文件只读、registry 新字段 optional、迁移后 no-downgrade）。

---

## D11 evidence/units/receipts 保留：90 天且 1000 次 merge

**裁决**：`units/<unitId>.json` 与 receipt 至少满足两个下限中的**更强者**：保留最近 **90 天** 且保留最近 **1000 次 merge**（即保留窗口 = max(90 天, 最近 1000 次)）。超出窗口后：

- `verify()` 仍可依据 journal/snapshot 降级判断，但 `undo` 必须 **fail-closed**，返回明确错误 `undo-evidence-expired`（写明保留策略与当前窗口），不得猜。
- 历史版本的 retention 裁剪不得删除窗口内 unit 的 evidence；cleanup 必须同时读 units/receipts/journals 三处引用计数。
- 存储预算：以 500 managed skills / 1000 merge 估算单位记录体积（单 unit ≤ 4KB），写入 RG5 预算；超预算时先扩保留而非丢 evidence。

**验收**：G3（1001 次/跨 90 天夹具：窗口内 undo 可成，窗口外时报 `undo-evidence-expired`）。

---

## D12 迁移范围（ADR-4）

**裁决**：v3 迁移覆盖 **state / runs / receipts / journals / staging / unit-history** 六类；旧文件只读备份；不做双写；失败按 K10 拒绝（不产生半迁移状态）。

1. 迁移顺序：备份 → dry-run（报告差异，不写）→ 单事务替换 → 校验（行数/哈希/引用）→ 旧文件改名只读。
2. 0.30.15 真实 fixtures 必须覆盖：五态行、expired、receipt 缺失、journal 各 phase、foreign run、损坏 state、旧 staging；缺一不得开工。
3. RG0 ownership matrix 是迁移前置（谁是 state/runs/receipts 的唯一写者）。
4. 容量目标（非产品承诺）：500 managed skills、2000 merge rows、单 run 200 pairs、20 并发客户端、support 每技能 10MB；rows API p95 ≤300ms（本机 warm）、state transition ≤50ms。变更即 RG5 重开。

**验收**：G9 + RG0/RG1 全绿。

---

## D13 执行顺序（覆盖本文旧"后续实现顺序"）

1. 文档冻结 + **RG0 ownership matrix**。
2. **P0 hotfix 0.30.16/17**（五项）；发版 + API web 验证 + 回滚演练。
3. **RG1** fixtures/备份/对账 + **0.31** 端口/CommandSurface/MergeFacts+Reconcile/eligibility/lock。
4. **RG2/RG3** 状态机/事务 → **0.32** schema 3 + UnitTransaction 收口 + UI 薄化。
5. **RG4–RG8** 并发/查询/run/包/发布。

任一 gate 未过，不得进入下一阶段；K1–K12 保留，当前最可能打回的是 **K2/K3/K4/K7/K8/K10**。

---

## 验收 gate 索引（本文各项 → 可执行判据）

| Gate | 判据 |
| --- | --- |
| G1 静态写路径 | merge 包无 node:fs 写、无 SkillLibrary 变更调用（只有 UnitTransaction + 只读）；arch/lint 测试 |
| G2 崩溃矩阵 | snapshot 后/journal 前/fence 后/target 写后/每源归档后/commit 返回前/receipt 前后注入崩溃；重启断言：complete 不回滚、mutations 1+N、每源归档一次、action=merge 版本恰 1、journal 终态、receipt 可重建、run 结算 |
| G3 幂等 | 同 unitId 同 digest commit 三次同一 evidence、零新版本；rollback 两次同 evidence；二次 archive 成功；1001 次/90 天保留窗口 |
| G4 并发/死锁 | approve 与 pair/scan 并发单赢家且 <waitMs+ε；epoch 被夺写前中止；curator 持 fence 时只等待/park；双恢复一赢 |
| G5 资格/保护 | pinned/bundled/hub/protectionUnknown 在 scan/pair/approve/commit 四处均拒；curator 行缺席时 GateSet 仍生效；commit 前 pin → 整对 failed 零写入 |
| G6 registry | ensureLoaded 前 findActive 正确；恢复不动 owned+alive；foreign cancel typed；settleOrphan 仅 pid 死 |
| G7 历史/undo | 一次 merge 一个 unit 含 runId；两代按 run 倒序 undo；rollback 写 rollback unit（append-only） |
| G8 包/engine parity | UPSTREAM hash、许可、精确依赖版本、merge manifest 无 workspace:^ |
| G9 迁移/兼容 | v2→v3 迁移 dry-run/备份/校验；降级窗口逐格；no-downgrade 在 0.32 后生效 |

## 未决与归属

- **归属**：本文件只裁 ADR-1/2/4；查询/命令/UI 归 merge-functional-spec-v2.md 与 merge-wire-contract.md；engine pinned/parity/fallback 归 merge-engine-boundary.md；RG0–RG8/K1–K12/迁移/运维/scale 归 merge-architecture-gates.md。
- **残余风险（接受并记录）**：tree fence 的 holder 判别仅 pid+startedAt（Windows 无 pid start 校验），epoch fencing 只能防"被夺后继续写"，不能防"夺锁误判"；已写入 README 已知限制候选。
- **未定数值**：unit 单条体积/总存储预算、1000 次与 90 天的联合清理批次、0.30.16 与 0.30.17 的切分点，由 RG5/发布计划定，不得改变本节下限。