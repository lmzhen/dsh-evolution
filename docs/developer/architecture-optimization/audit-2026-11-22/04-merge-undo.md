# 04 merge / undo / approval-replay 只读审计

对象：`D:\dsh\dsh-evolution-mirror` HEAD `564431ac`；平台对照 `D:\dsh\harness-rc3`（`client/connection`）。
范围：evolution-merge、evolution-merge-engine、evolution-merge-ui、evolution-approval（接缝与 replay），以及 core 中与事务/锁/恢复相关的**对照读**（不审 core 写实现）。
方法：逐字读源码 + 测试反证 + 真实 home 度量；未跑测试、未改代码（只写本文件）。

## 结论

多技能 unit 的骨架是健康的：plan/snapshot/journal/evidence/receipt 五段，CAS 用内容锚，崩溃测试真的 fork 后 `taskkill /F` 再做恢复。未发现常规路径静默丢数据（**P0 = 0**）。
问题集中在三处：**恢复分支表缺 rollback 兜底**（崩溃窗口内页卡半合并态）、**staging 树不绑定“代”**（重试会把上一代的残留文件当支撑文件提交、且旧树会让 approve 确定性失败）、**“拥有者还活着吗”跨面判据用本进程 registry**（另一面在跑的 run 被判成 inactive，重复起 run）。
另有一批结构性问题：state 写入未统一走 house fence、行结果三套表示（expired/failed/skipped）、scan 与 approve 各写一份 pair 状态机、unit/receipt 无 retention（真实 home 已有 10.55 MB 永不回收）。

## P0

无。常规 scan/pair/approve/resume/undo 路径未复现静默丢数据或崩溃；`rg3-*` 崩溃测试覆盖 prepared…committed 八点且断言树字节，这一点比同族其它包强。下面 P1 都是**前置条件 + 触发窗口**型，不是主路径。

## P1

### P1-1 恢复分支 B 只 rollForward，失败后无 rollback 兜底 → 半合并卡死

- 位置：`recovery-coordinator.ts:27-33`（branchOf：`target-written`/`support-pending`/`source-archiving` → B）、`:69-95`（B 只调 `unit.rollForward`，失败即 `blocked`）；`unit-protocol.ts:546-573`（rollForward 要求“全部 source checkpoint 齐 + source 已不在活树”，否则 `unit-rollback-blocked`）。
- 机制：core 的提交顺序是 `onPhase('target-written')` → 逐 source `onPhase('source-archiving',{source})` **在归档动作之前**（`skill-store.ts:2961-3014`；`2997-3014` 的 journal 化由 unit-protocol 回调完成）。因此 target 已写、source 未归档时：checkpoint 缺（或只有当前一条）且 source 仍活 → rollForward 两条硬条件都不满足，`blocked`。
- 触发：进程在 target 写入后、最后一个 source 归档完成前的任意点被杀（含 `rg3-crash.spec.ts:61-67` 的原样状态：target=new、source 仍 live）。
- 证据：`rg3-recovery.spec.ts:49-62` 证明**同一 journal 状态下 `rollback` 成功**，但生产恢复表从不给 B 分支调 rollback；`unit-protocol.ts:575-592` 的 rollback 本身不限 phase。
- 后果：行停在 fuse、run 成 orphan、target 被 `busyTarget` 永久占用（`runtime.ts:65-72`）；没有 CLI/route 能对单个 unit 执行 rollback（grep 全包仅 `recovery-coordinator.ts:82` 与进程内 `cancel` `unit-protocol.ts:668`）。`resume --retry` 会基于**已合并后的活 target** 重新 assemble（`commit-assembly.ts:112-123` 以活 target 为 CAS 基线），等于在同一 target 上再吃一次 source，存在重复吸收风险（likely，未端到端复现）。
- 修法：恢复计划改为按“阶段 + 现场事实”求解（finalize → rollForward → rollback 依次尝试），并暴露 `merge recovery --unit <id>` 兜底。

### P1-2 staging 树不绑定“代”：重试提交上一代残留文件；旧树让 approve 确定性失败

- 位置：`new-child-authoring.ts:63-86`（重试时 `row.stagingRef` 优先，命中已有树只 `setStageTreeTarget`，**不清 `merged/`**）；`staged-tree.ts:41-67`（把 `merged/<target>/` 下**所有**文件当支撑文件返回，无 manifest 过滤）；`staging.ts:71-73`（`createStaging` 见到同名目录直接拒绝）；`scan-ports.ts:59-70`（stageKey 由 `rowIdOf(pairKey)` 派生，同一 pair 跨代同 key）；`runtime.ts:343-354,399-407`（reject/discard 只删行，不 `dropStage`）。
- 机制 a：上一轮 round2 已写过部分文件后失败（`merge-validation` 等），resume 复用同一棵树，新 child 只重写它认为的文件；`readStagedTree` 全量枚举 → 旧代 support 文件进入 `plan.supportFiles` 并随 commit 写入 target。且两处状态机对“校验失败是否清树”判断不同：`scan-run.ts:350-368` 把 `merge-validation` 算 terminal（清树），`round2-outcome.ts:85-94` 只清 `commit-failed`/`validation-failed`（`validation-failed` 全仓无生产者）→ resume 路径必留树。
- 机制 b：discard/reject 不清 stage，重新 pair 后 approve 走 `createStageForCards` → `reserveStage` 成功、`createStageTree` 失败 `staging already exists` → approve 报 `stage-failed`（`approve-command.ts:49-56`）；此时行已被 `approvePending` 移到 approved，只能改走 `resume --retry`。
- 触发：a = 任一次 round2 校验失败后 `resume --retry`；b = `discard`（或 skipped→restore）后重新 `pair` 再 `approve`。
- 修法：stageKey 用“本次 run + generation”，或复用前校验 `stageDigest` 并清空/拒绝旧树；行关闭（commit/skip/discard/reject）统一走一个 `closeRow()`，其中必 `dropStage`。

### P1-3 跨面 in-flight 判据读本进程 registry，活的外部 run 被判 inactive

- 位置：`index.ts:357-360`（`isOwnerActive: runId => runs.find(runId)?.state === 'running'`）、`run-registry.ts:595-597`（`find` = `owned ?? foreign`，`foreign` 只在 `load()` 重建，`index.ts:238` 仅启动时调用一次）；对照 `runtime.ts:178-187`（pair 的“同一 pair 幂等”判定优先用 `isOwnerActive`，而不是 run-meta 里的 pid 存活）。
- 机制：另一面在本进程启动后新起的 run 不在 `foreign` 里 → `isOwnerActive` 返回 false；而 `inFlightPairRun` 是直接读 run-meta 文件（`run-coordinator.ts:69-88`），拿到了带活 pid 的记录，却被判 inactive → 继续启动第二个 run。
- 触发：同一 `DSH_HOME` 上两个宿主面（家族已按跨面设计：`run-registry.ts:79-81,470-471`、HomeAuthority 文件锁），先后对同一 pair 执行 pair/approve/resume。
- 影响：重复的模型 run（成本）与重复 staging；行状态由 CAS 兜底，不会双合并（`scan-run.ts:242-249` 的 row-changed 拒绝），所以是“功能失效 + 重复应用”，不是树损坏。
- 修法：owner 判据统一为 pid-aware 的 `runs.hasOwner()`（或直接 `readRunMeta + isProcessAlive`），`isOwnerActive` 注入点全部换掉。

## P2 / 技术债 / 屎山

1. **双 unit 组装 + isActive 是死码**：`runtime.ts:130-134` 给命令流构造 `MergeUnitTransactions`（有 serial、**无 fence、无 isActive**），`index.ts:232` 给恢复构造另一份（有 fence/isActive）。`isActive` 唯一消费点在 `unit-protocol.ts:262` 的 commit，而恢复路径只调 finalize/rollForward/rollback（不消费）→ 生产 commit 从不校验 run 是否已终止；`unit-protocol.ts:91-92` 声明的“writer queue 先于 fence”只在 index 那份成立。
2. **state 写入未统一 house fence**：approve/resume 的 `pairLedger(…, fence)` 与 scan 的 `pairLedger(options.io, options.home)` 并存；scan-run 内 9 处 transact 全无 fence（`:242,255,277,293,327,339,351,358,400`），`reconcile.ts:105`、`recovery-projection.ts:84,97`、`runtime.ts:296`（onSelection 写 skipped 行）同样旁路。跨面时只剩 transactIo 文件锁 + version CAS，`queueRevision` 只用于读投影。
3. **pair 状态机两份**：`scan-run.ts:309-371` 与 `round2-outcome.ts:39-115` 各自实现 merged/failed/over-limit/CAS 分支，判据集合已不一致（P1-2 的 `merge-validation` 清树差异）；`failure-route.ts:22-31` 的 `routeFailure` 无 src 调用者，`validation-failed`/`commit-refused`/`invalid-decision` 无生产者 → 死词汇表。
4. **行结果三套表示**：同一 CAS 失败在 approve 预检落 `expired`（`runtime.ts:525-535,568-575`）、在 round2 落 `failed(non-retryable)`（`round2-outcome.ts:73-83`）、超限落 `skipped`（`round2-outcome.ts:64-71`）；UI 只能按 state 猜（`Panel.ts` 的 tab 与 reason 映射）。
5. **两套 claim 且损坏即永久失败**：`target-claim.ts:9` TTL 30 min，`unit-claim.ts:5` 注释写“24h stale”，同一 target 两个 claim 概念；claim 只保护 commit，undo/手工恢复不取 claim；`target-claim.ts:15-18` `parseClaim` 对损坏 JSON 直接 throw，错误信息不含文件路径 → 该 target 之后每次 merge 都 `unit-claim-failed`，无自动修复。
6. **unit/receipt 无 retention，且有假承诺**：`merge/unit-journals|unit-snapshots|units|unit-receipts|receipts|undo-*` 无任何剪枝（`pruneTreeChangeUnits` 只扫 `units/skill`，`mutation-storage-adapter.ts:88-111`；恢复把 legacy `merge/` 目录的 tree-change 一律 `skill-unit-skipped`，`recovery-coordinator.ts:57`）。实测桌面 home：`merge/unit-journals` 167 个、`merge/unit-snapshots` **10.55 MB**、最新 2026-11-08，全部永不回收。`undo-operation.ts:38-44` 的“evidence 老化出 retention window”分支对应的窗口在代码里不存在。
7. **读路径成本随历史线性**：每次 `/merge/view` 都 `readCommitReceipts` 全目录 + 对每个历史项 `listVersions`（`index.ts:312-335`、`merge-snapshot.ts:119`）；每次 pair 都 `readRunMetas` 全量（`run-coordinator.ts:69-83`）。目录不清 → 越用越慢。
8. **wire 缺字段，UI 自造**：`RowFact` 无 `pairKey`（`wire.ts:40-65`），UI 用 `id` 顶替（`api.ts:167`）；`currentPairKey` 是 `a+\u0000+b`（`contracts.ts:38-39`）原样进 DOM（`MergeRunStrip.ts:30`），两个技能名会粘在一起；view 的 counts 与 rows 是两次请求、Facts 无 `queueRevision`（`wire.ts:66-77`），计数与列表可能不同代；decision 路径由 `.replace(/body$/,'decision')` 客户端拼（`api.ts:229-233`），不在单一声明里。
9. **长函数**：`runtime.ts:160-627` 单 `execute()` 468 行、11 个 verb 内联（约一半是 approve 预检的分支爆炸）；`unit-protocol.ts:244-408` `commitOnce` 165 行且 evidence 构造两份（`:354-385` 与 `:455-485`）；`merge-routes.ts` 5 个路由 + decision 校验内联在一个函数返回数组。
10. **UI 不轮询**：detached 是默认（`runtime.ts:163`），批准后 `store.refresh()` 一次（`Panel.ts:189-203`），之后只靠 focus/visibility/手动按钮（`Panel.ts:219-227`）→ active run 进度与“合并完成/失败”要用户自己刷。

## 平台接口对照

- **exact-route carrier：对齐**。平台 `rpc-host.ts:234-251`（按 path 注册、重复 path 抛错、disposer 绑 owner fiber）与 `:207-232`（handler 只收 Request，owner principal 校验在 carrier）→ 家族 `http-routes.ts:139-191` 注册期取 `DecisionAudit` 快照是正确形状；`evolution-adapter/src/connection.ts:26-40` 的 `tryRegister` 包装也对。
- **决策审计：merge 丢了**。approval 把平台 admission 落到记录（`approval/index.ts:686-695`），merge decision 只用 `rowId/verb/sessionId`（`index.ts:379-386`），`_audit` 进了参数没进任何记录 → merge 批准/拒绝没有可审计的通道/principal。
- **同一 carrier 两种 wire**：approval 拒绝是 `200 + {ok:false}`（`routes.ts:96-110`），merge decision 拒绝是 400/409（`merge-routes.ts:154`）；同一宿主两种客户端处理。
- **HOST_ROUTES 单一声明被破坏**：`merge.decision` 未声明、由 base 拼出（`merge-routes.ts:15-21`）；`merge.run`/`merge.runs` 声明了但全仓无注册点（`http-routes.ts:90-91`，grep 仅生成物引用）→ 生成客户端表 `routes.generated.ts:32-39` 给浏览器两条必 404 的路径。
- **approval GET 有写副作用**：`pending` 路由 GET → `list()` → `expireStale()`（`approval/index.ts:499-504`），与 `routes.ts:10-13` 自述“routes only read the window”冲突；GET 非幂等，重试/预取会提前关闭 TTL 记录（设计上“expiry = reject”，但文档该改）。
- **approval replay 生命周期：策略对，靠 runner 自证幂等**：runner 先执行、再 `tryResolvePending`，失败不自动重放（`approval/index.ts:697-814`）——正确方向。但 `release` 是一等普通动作、无二次确认（`:518-590`），Seam 层没有 effect marker/idempotency key；实际幂等来自 skill runner 的 plan anchor（`tool-skill-manage/src/index.ts:1736-1755`，无 plan 的旧记录直接拒绝 `:1740-1742`）与 memory store 的 dedupe，不是 approval 的保证。
- **插件生命周期**：`index.ts:395` dispose → `runs.cancelAll()`。平台 fiber 卸载不等于进程退出（profile 行/插件开关变化也会 dispose），在途 merge 会被 abort，只能靠 core 的 signal 分支回滚半合并；这不是平台误用，但 dispose 语义应当“放弃所有权/留给恢复”，而非“取消”。
- **fs/storage**：merge 全部经 `EvolutionIoLike`/`transactIo`，未见直接调用平台 fs 服务；但 unit 快照/日志默认落 `merge/`（`unit-storage.ts:69-71`）而非 `units/`，造成 skill 写单元寄生在 merge 目录（P2-6 的回收缺口来源）。

## 更优实现

1. 恢复：把 branchOf 表换成 `settleUnit(journal)` 单函数，按现场事实一次判完 finalize/rollForward/rollback，并用 `merge recovery --unit` 暴露；`resume --retry` 检测到同 target 的半合并 unit 时先 settle 再 author。
2. staging：stageKey 代际化（runId 或 generation 前缀），复用前校验 `stageDigest` 且清 `merged/`；`closeRow()` 统一负责 `dropStage` + 行终态 + journal 结算。
3. 拥有者判据收敛到 `runs.hasOwner()`/pid 存活一个入口，删掉所有“本进程 registry”式的 owner 判断。
4. unit 组装只在 index.ts 一处（`deps.unit` 注入），删掉 runtime 的 fallback unit；`isActive` 接到 commit 或删掉。
5. 行/run-meta 写入收敛为一个 `stateStore(fence)`，删掉 `pairLedger` 的无 fence 重载；`queueRevision` 进 Facts 供 UI 拒混代读。
6. 单份 pair 结果记录器：scan 也走 `recordRound2Outcome`，删掉 scan-run 里的重复失败分支与 `failure-route` 死表。
7. 保留策略：unit 快照/证据/回执与 legacy `merge/unit-*` 一起进启动 sweep（或整体迁 `units/` 后按 keep 剪枝）；undo 的 `undo-evidence-expired` 要么实现窗口要么删分支。
8. `merge.decision` 进 HOST_ROUTES + 生成器，两处路径派生删除；merge 决策落 `DecisionAudit`；currentPairKey 生成为 `{a,b}`。

## 覆盖清单

- 逐字读（merge）：`unit-protocol/runtime/recovery-coordinator/recovery-projection/undo-operation/undo-merge/undo-resume/staging/staged-tree/staging-files/target-claim/unit-claim/state/approve-command/resume-command/scan-command/scan-run/commit-execute/commit-plan/commit-assembly/commit-receipt/round2-outcome/new-child-authoring/pending-actions/scan-ports/stage-tool/merge-routes/wire/authoring-flow/skill-library-unit-backend/index.ts(150-397)`；domain：`claim/stage-aggregate/reconcile/pair-ledger/run-coordinator/failure-route/undo-journal/undo-receipt/state-bootstrap(1-120)`；adapters：`undo`。
- 逐字读（ui）：`api/MergeStore/Panel(150-358)/MergeRunStrip/client-index/session`。逐字读（approval）：`index.ts(90-220,268-330,490-842)/routes.ts(95-231)`。
- core 对照读：`home-fence/authority(200-470)/unit-storage/unit-journal/unit-undo-plan/mutation-authority/mutation-storage-adapter/run-registry(300-626)/http-routes`；`skill-store` 关键段（2000-3130, 3700-4057）与 `system-skill-writer/skill-write-service` 入口。平台对照：`harness-rc3 packages/client/connection/src/rpc-host.ts`。
- 只 grep/抽样，未逐字：merge 其余 domain/surface/命令封装（约 30 文件）、evolution-merge-engine（入口、构建脚本、generate 产物；`src/index.bundle.js` 5739 行为构建输入，生成器不在包内，属既知构建债，未展开）、evolution-approval 余段、ui 其余组件与样式。
- 未执行：任何测试/构建/真机（只读约束）；未对 P1-1/P1-2/P1-3 做端到端复现，机制与状态由源码 + 现有崩溃/恢复测试交叉推出（P1-1 有测试状态直接对应，标“确定”；P1-2 的提交污染标 **likely**；P1-3 的两面时序未实测，标 **likely**）。
- 只改本文件；审计期间未触碰源码。
