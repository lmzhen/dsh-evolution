# Core 写入与 IO 审计（HEAD 564431ac）

## 结论（一段）

核心写入骨架（WriteKernel 的读内 CAS、tmp+fsync+rename、`committed` 警告语义、MutationUnit 的 prepared/committed 快照顺序）是成立的，与平台 `storage-json/writeAtomic`、`fs-local` 的 realpath 身份规则基本对齐；本轮未发现默认配置下可直接复现的 P0（无字节丢失、无崩溃、无越权）。真正的风险集中在 HEAD 新增的两条路径上：一是多 op 计划用 `PLAN_SINK` + 假 MutationUnit 把"只有字节可延迟、副作用不可延迟"的假设写进了实现，create 的审计/事件在 prepare 阶段就落盘（成功重复、拒绝留幻影），并且这个拦截把崩溃恢复一起拦掉了；二是 `keyedSkillLocks` 打开跨进程并发后，`.mutations.json`/`.usage.json` 等 home 级 sidecar 仍假设 `transact` 是跨进程锁（实际 `nodeEvolutionIo` 只做进程内串行），生产构造点又从不传 `fence`。另外三处 P1 属于失败/恢复路径：恢复失败结果被丢弃、`repair()` 绕开平台 takeover claim、补偿遇第一个被阻塞目标就停止。技术债的主线是同一目标身份上叠了五层锁与两套 CAS 版本模型，任何新写入路径漏一层就退化成无互斥。

## P0（无则写无）

无。最接近 P0 的两个问题（多 op 计划的幻影审计、keyed 模式下 sidecar 丢更新）分别受"当前无生产多 op 调用方"和"需要显式 opt-in"限制，且不损坏技能字节，故列 P1。

## P1

### P1-1 多 op 计划里 create 的审计/事件在 prepare 阶段落盘：成功时重复、计划被拒时留幻影
- 证据：`packages/evolution-core/src/skill-store.ts:860`（PLAN_SINK）、`:1041-1066`（commitUnit 拦截返回假 unit）、`:4079-4088`（prepare 循环）、`:2187`（`createCore` 在 unit.apply 成功后无条件 `this.audit(...)` + `:2188` notify）、`:4112-4127`（最终 unit 的 hooks.committed 逐条 audit + notify）、`:4066-4070`（managed/非前台 create 被拒）。
- 机制：假 unit 的 `apply` 只把 op 记进 `sink.writes` 并返回 `{ok:true}`，但 `createCore` 的收尾副作用（content history `recordVersions`、`.mutations.json` `recordMutation`、`notifyMutation`）不在 unit hook 里，于是在 prepare 时真的写盘。applyMulti 提交成功后 hooks.committed 又对同一次 create 再 audit/notify 一次；若后续 op 拒绝（`:4085`）或最终 unit CAS 漂移，prepare 已写下的版本条目/ledger 记录/事件成为幻影。
- 影响：`.mutations.json` 与进化事件（目录失效、面板刷新）双触发；技能被拒时留下"已 create"的版本条目与 ledger 记录，`listVersions`/审计面板读到不存在的技能；对 history 的"每个版本可回读"假设造成噪声（同内容重复条目因 `nextHistoryIndex` 的 tail-hash 去重不会重复，但拒绝路径仍留条目）。
- 建议：删除 `createCore` 里的直接 audit/notify，统一放进 unit hooks（与 update/patch 一致）；或让假 unit 显式不支持任何副作用（改成 prepare 返回 plan，副作用只在 commit hook）。
- 置信度：代码机制高；生产可达性中（仓库内 `library.apply` >1 op 的调用方暂缺，新测试直接调用，`skill-write-plan.spec.ts`）。

### P1-2 `keyedSkillLocks=true` 后 home 级 sidecar 的 RMW 仍只有单进程 transact
- 证据：`packages/evolution-core/src/authority-plugin.ts:14-20`（opt-in，默认 false）、`packages/evolution-core/src/io.ts:17-24` 与 `:42-52`（接口声称 transact 是跨进程 RMW；同文件 `:385-393` 自认 node 后端只做进程内）、`packages/evolution-core/src/mutations.ts:86-92`（注释声称"第二个进程不能再插入"）、`packages/evolution-core/src/usage.ts:230-240`（`transactIo(usageFile)`）、`packages/evolution-core/src/skill-store.ts:1802,1866`（audit 把 `this.fence` 传下去，但生产构造点未传 fence：`packages/tool-skill-manage/src/index.ts:770` 等；`HistoryFence` 在 src 外无引用）。
- 机制：keyed 模式让两个进程可以并发写不同技能（per-target `withFileLock`），但 committed hook 里的 `recordMutation`/`mutateUsage`/`appendEvolutionEvent` 修改的是同一个根级 JSON，落地只靠 `io.transact`；`nodeEvolutionIo.transact` 的跨进程互斥只来自 `HomeAuthority`（keyless 路径），keyed 路径不取 home fence。
- 影响：双进程（desktop+CLI、双 web）同时写技能时，审计记录/用量计数被 last-writer-wins 覆盖（丢记录、丢 lifecycle 遥测）；默认配置安全，只有开启 keyed 后才暴露。
- 建议：home 级 sidecar 的 RMW 显式取平台 `withFileLock(<file>)`（与 `util/atomic-write/src/index.ts:238-273` 同一协议）；或 keyed 模式下把这类写回落到 home fence。
- 置信度：机制高；影响面取决于 opt-in。

### P1-3 崩溃恢复的"拒绝/漂移"结果被静默丢弃
- 证据：`packages/evolution-core/src/skill-store.ts:1129-1134`（`ensureRecovered` 只 `.then(() => undefined).catch(...)`，返回值丢弃）、`:1142-1167`（`recoverPreparedUnits` 把 `MutationResult[]` 原样返回）、`packages/evolution-core/src/mutation-unit.ts:452-458`（`recoverPrepared` 逐条 `recover`）、`:461-484`（`recover-drift`/`recover-failed` 用 `{ok:false}` 返回而不是 throw）。
- 机制：只有抛异常才会进 `console.warn`；`recover()` 的漂移拒绝是返回值。于是"崩溃留下的 prepared 单元、但目标已被第三方改动"这条路径既不重试也不报警，`this.recovery` 还被 memo 成 resolved。
- 影响：半写单元永久停留；后续 `undo` 一律被 `undo-needs-recovery` 拒绝（`mutation-unit.ts:517-519`），操作者没有任何线索（唯一痕迹是磁盘上的 snapshot/journal 文件）。
- 建议：boot 汇总 `recoverPrepared()` 的失败项并 warn/上报 doctor；或让 recover 漂移 throw 一个带 target 的错误。
- 置信度：高。

### P1-4 `repair()` 绕开平台锁的 takeover claim，可能删掉活进程刚写入的锁
- 证据：`packages/evolution-core/src/authority.ts:269-290`（`TargetLockSet.repair`：读 `<path>.lock` 的 pid → 非活/非本进程才留 → `rm({force:true})`，删除前不复核记录）、`:442-458`（`HomeAuthority.repair` 同形）；平台协议 `harness-rc3/packages/util/atomic-write/src/index.ts:150-178`（写 `<lock>.takeover-<hash>` claim、复核记录仍是被接管者后才 rm）、`:238-273`。
- 机制：平台的 claim 文件序列化"删除死锁"这一动作。插件的 repair 直接 rm；与另一进程的 `takeOverExitedLock` 交错时，对方可能已经在插件 rm 之前写入自己的锁，插件把新锁删掉。之后两个进程各自认为持有 home/target 锁。
- 影响：release 失败（Windows EPERM 等）后，若恰有另一进程抢锁，可能出现双持有 → 并发写同一技能树 → 丢失更新。窗口小但后果是互斥语义被破坏。
- 建议：不复刻删除；直接复用平台 takeover（在 claim 协议内复核记录内容与 pid 再删），或删除前重读并比对（内容变化则不删、报 skipped）。
- 置信度：机制高；触发需 release 失败 + 并发竞争者。

### P1-5 失败补偿遇到第一个被阻塞目标就停止，其余目标不回滚
- 证据：`packages/evolution-core/src/mutation-unit.ts:581-586`（`rollback` 逆序循环，任何 `!result.ok` 直接 `throw`）、`:415-424`（catch 把 rollback 失败拼进消息后返回 `{ok:false}`）；对照 `packages/evolution-core/src/write-kernel.ts:175-182` 的 `compensate` 是收集全部错误（该 API 当前无调用方）。
- 机制：一个目标被并发写者改动 → `restore` 返回 `compensation-blocked` → 抛错跳出循环，后面（更早写入）的目标保留本单元字节。
- 影响：多目标单元失败后磁盘上的"本单元写入"比最小必要更多；报告写"failed; rollback failed"，实际状态介于 before/after 之间，恢复只能靠 prepared 快照（而 P1-3 又可能静默失败）。
- 建议：收集全部补偿失败后统一返回（blocked 的进错误列表），与 `compensate` 的语义一致。
- 置信度：高。

## P2 / 技术债 / 屎山

1. **死 API / 死 seam**：`WriteKernel.commit`/`run`/`compensate` 无调用方（`write-kernel.ts:64-86,140-160,175-182`）；`guardBaseline`/`transactGuard` 仅 `createCore` 传 false（`skill-store.ts:2120`），而它的 op 是 `expected:null` 走 `createTextIfAbsent` 分支，永远到不了 transact 分支（`write-kernel.ts:94-108` vs `109-137`）——旧"defer 重试 seam"已死；`writeFileCas` 只有 spec 调用（`skill-store.ts:3979`）；`atomicWriteFiles` 无调用方（`io.ts:652-766`，115 行）；`TargetLockSet.run` 无调用方。
2. **五层锁/两套版本模型**：`ROOT_SERIAL`、`SkillTargetLocks`、`SkillRootGate`、`HomeAuthority`、`TargetLockSet` 都在回答"同一目标互斥"；`writeFileCas` 走 `serial`+home fence，`update` 走 `rootGate`+targetLocks+keyed lock（`skill-store.ts:3997` vs `2215`）——同一文件没有共同的第一性锁，新路径漏一层即失去跨进程互斥。`write-kernel.ts:114-125` 的 CAS 用原始字节串，`SkillWriteService` 用 contentHash，`write-kernel.ts:14-18` 又有结构化 code，三者并存。
3. **文件头注释已过期**：`skill-store.ts:9-34` 说 create/update/patch 走 in-process serial、"Per-directory write lock (io.ts LOCK_*)"跨进程；实际 create/update/patch 走 `rootGate`+`withTarget`（`:2056,2215,2299`），serial 只剩 `writeFileCas`/`commitMerge`/`consolidate`，`io.ts` 里已无 LOCK_* 协议（只有 `inProcessWrite`）。这类注释会让下一条写入路径按错误模型接线。
4. **`as unknown as MutationUnit` 假 unit**（`skill-store.ts:1047-1065`）：只有 `apply`，类型逃逸。任何 mutator 未来调用 `recover/undo/preview` 就是运行期 TypeError；而且它已经真的截住了 `recoverPreparedUnits`（见下条）。
5. **plan sink 连崩溃恢复一起拦截**（likely）：fresh 实例首次写若是多 op 计划 → `recoverPreparedUnits` 里的 `this.commitUnit` 也返回假 unit → `unit.recoverPrepared()` TypeError → 被 `ensureRecovered` 的 catch 吞掉且 memo（`skill-store.ts:1041-1066,1129-1134,1145-1164`）→ 该实例的崩溃恢复永久跳过。仅当 boot 恢复未先跑（`recoverOnBoot` 只有 `packages/tool-skill-manage/src/index.ts:775` 一处调用）。
6. **applyMulti 的 prepare 不在提交锁内、且顺序敏感**：support 写前的 `pendingCreate` 只看已收集的 body create（`skill-store.ts:4244-4245`），计划里 create 排在 support 之后即整单拒绝；prepare→commit 之间的第三方改动只能靠 commit CAS 失败（多一次全量失败），`SkillWritePlan` 的文档没有说明顺序约束（`skill-write-plan.ts:56-62`）。
7. **错误码靠消息正则分类**：`skill-write-service.ts:401-409` 用 `/已存在|target appeared|changed after plan|concurrent modification/` 推导 `SKILL_ALREADY_EXISTS`，而 kernel 已返回结构化 `code`（`write-kernel.ts:14-18`）；平台有稳定词汇 `FS_*`（`harness-rc3/packages/fs/fs/src/types.ts:189-210`）。
8. **提交后读失败会把已落盘的写变成异常**：`updateBody/patchBody/updateSupport/writeSupport` 在 `result.ok` 后 `await this.readBody(...)` 无 try/catch（`skill-write-service.ts:285-287,311,328,355-363`），与同文件 `:247-249` 的 K6 注释（"post-commit read failure can never turn a landed write into a tool failure"）矛盾；`library.read` 对非 EISDIR 错误会 throw（`skill-store.ts:1385-1400`）。
9. **observation 版本口径漂移**：`skill-observation.ts:20-27` 声明平台 `FsVersion` 会原样作为版本，实际所有入口都换算成 `contentHash`（`packages/tool-skill-manage/src/skill-observations.ts:85-103`）；contentHash 无法发现"同内容替换"（ABA 盲区），平台 stat-identity 可以。
10. **create 的 ledger 没有 origin**：`skill-store.ts:2187` 的 `audit(...)` 传 `undefined` origin，而 update/patch 传 origin（`:2266,:2491`）→ "谁写了这条"在 create 上缺失。
11. **本进程 tmp 会被 sweep 删掉，而 createTextIfAbsent 不在 inProcessWrite 队列**：`io.ts:453-455`（`selfLeftover` 立即删）、`:488-507`（create 无队列）vs `:508-540`（writeText/transact 有队列）→ 同路径 create 与 transact 并发时可能互删 tmp（表现为 ENOENT 伪失败）。likely。
12. **undo 计划依赖索引 append 顺序**：`unit-undo-plan.ts:62-70` 用"数组最后一个 = newest"，而 `nextHistoryIndex` 明确允许非邻接 unit 打乱分组（`skill-history.ts:543-555`）；顺序被重排时 newest/oldest 判定会取错。
13. **unit snapshot 读写 scope 不对称**：`mutation-storage-adapter.ts:44`（写 skill scope）vs `:47,61-83`（读/列举同时看 skill+merge）→ legacy merge 树变化快照可被当 prepared 参与恢复。
14. **journalId 每实例生成一次**（`mutation-unit.ts:311`），而 `MutationJournalRecord.journalId` 文档说它标识"this nested unit"（`:142-145`）；同一实例复用 `apply` 时相位非单调（`unit-journal.ts:58-65`）只产生 warning。
15. **`atomicWriteFiles` 是 io.ts 的第三套原子写**：同步 fs、无 fsync、`.tmp` 命名不进 sweep（`:661` vs `:446-447`）、remove-then-rename 恢复仍可能丢目标（`:688-727`）；无调用方，应删。
16. **observation owner 无平台派生**：`SkillWriteOwner = object`（`skill-write-service.ts:19`），tool 传 `exec.agent.session`，其它 face 传 `{}`/`undefined`（`tool-skill-manage/src/index.ts:1064`）；平台从 dispatch actor 派生 owner，无 owner 的直调不能写（`harness-rc3/packages/fs/fs-observation-policy/src/index.ts:36-41`）。共享一个长生命周期 owner 对象即跨会话授权。likely。

## 平台接口对照

| 平台契约/实现 | 插件用法 | 判断 | 证据 |
|---|---|---|---|
| 每 targetKey 一个 in-process promise 锁，read→guard→write 全在锁内（`harness-rc3/packages/fs/fs-local/src/index.ts:107-145,216-247`） | `SkillTargetLocks`（`skill-target-locks.ts:39-64`）+ `withTarget`（`skill-store.ts:960-963`）；MutationUnit 另加 keyed `TargetLockSet` | 方向正确但重复：同一身份三套锁；并且 `createTextIfAbsent` 不进 `inProcessWrite` 队列，等于平台"所有 mutation 同锁"不成立 | `io.ts:488-507` vs `508-540` |
| guarded write 用 `FsWriteIntent{createIfAbsent\|replaceIfVersion}` + 不透明 `FsVersion`，锁内 re-probe；create 用 `link()` no-replace（`fs-local/src/index.ts:348-367`；`fsio.ts:651-656`） | `SkillWriteIntent` 同形（`skill-write-intent.ts:86-114`），版本=contentHash；MutationUnit CAS 用原始字节串（`write-kernel.ts:114-125`）；原子 create 已补（`io.ts:488-507`） | 语义等价、原子创建对齐；版本模型弱于平台（同内容替换/ABA 不可见）；冲突码不同（cas-conflict vs `FS_NOT_OBSERVED`/`FS_STALE_VERSION`） | `skill-write-intent.ts:86-114`；`write-kernel.ts:94-137` |
| observation policy：owner=`actor.agent.session`；unseen/absent→createIfAbsent，present→replaceIfVersion；edit/delete 需 present（`fs-observation-policy/src/index.ts:36-97,128-140`） | `SkillObservationStore(owner object)` + `requirePresent`（`skill-observation.ts:134-169`；`skill-write-service.ts:108-119,160-169`） | 语义对齐；owner 无平台派生、版本换算成 contentHash（丢平台 token） | `skill-observations.ts:80-104` |
| 锁文件协议：`wx` + `<pid>\n` + 死持有者 takeover **claim**（`util/atomic-write/src/index.ts:150-178,238-273`） | `HomeAuthority`/`TargetLockSet` 复用 `withFileLock`，但 `repair()` 自己 rm | 用对了锁原语，repair 绕开 claim → P1-4 | `authority.ts:252-292,442-458` |
| 崩溃持久化：tmp+fsync+rename+dir fsync（`storage-json/src/atomic.ts:29-41`） | `writeDurableTmp`/`commitTmp`/`writeOne` 逐字对齐，并把"rename 后 dir fsync 失败"建模为 committed warning（`isCommittedWarning`/`transactIo`） | 正确且强于 `util/atomic-write`（后者明确不做 fsync）；但 `transact` 的"跨进程 RMW"接口注释与实现相反 | `io.ts:96-155,260-347`；`io.ts:42-52` vs `19-24,385-393` |
| target identity：存在→文件 realpath；缺失→最近祖先 realpath + 缺失片段（`fs-local/src/fsio.ts:170-227`） | `canonicalTargetKey` 同规则 + sha256（`skill-store.ts:991-1024`）；`skillHostIdentity` 又独立实现同一规则（`skill-observation.ts:125-132`） | 与平台一致（f43ad13d 已对齐）；两处独立实现，已出现旁路漂移（版本换算） | 同上 |
| 多目标操作按 key 字典序取锁（`fs-local/src/index.ts:128-145`） | `TargetLockSet` 同样排序（`authority.ts:153-156`） | 排序对齐；但 keyless 落 home fence、keyed 落 target 锁，两套锁互不排斥 → `writeFileCas` 与 `update` 跨进程可并发 | `mutation-authority.ts:39-55 vs 72-75`；`skill-store.ts:3997 vs 2215` |

## 同一功能更优实现

1. **多 op 计划不要用假 unit**：给 `MutationUnit` 一个真正的 `prepare(op)`（锁内读 + 校验，返回 `{before, expected, next}`），applyMulti 在一次锁内 prepare 全部 op 再 `commit(prepared[])`；audit/notify/history 只放在 commit hook。这样删掉 `PLAN_SINK`、假 unit、`pendingCreate` 旁路和顺序依赖，prepare 天然零副作用。
2. **错误码**：直接用 `WriteKernelError.code` + 平台 `FS_*` 词汇，删掉 `actionResult` 的正则分类（`skill-write-service.ts:401-409`）；create 冲突返回平台语义（`FS_NOT_OBSERVED`/`ALREADY_EXISTS` 映射表）。
3. **锁**：删掉 `ROOT_SERIAL`/`SkillTargetLocks` 中至少一层，把 keyed `TargetLockSet`（含 in-process tail）作为唯一目标锁；`rootGate` 只保留 structural 语义；`writeFileCas`/`atomicWriteFiles` 要么接同一锁，要么删（都无调用方）。
4. **版本/观测**：直接复用平台 `FsVersion`+`FsObservation`（seam 上就是 `targetKey+version`），不要 contentHash 换算；写侧用 `FsWriteIntent` 形状。这样与平台 `fs-observation-policy` 的 ABA/同内容替换语义一致。
5. **home 级 sidecar**：`.mutations.json`/`.usage.json`/event log 的 RMW 用平台 `withFileLock('<file>')` 包住（或复用 storage-json per-record unit），而不是假设 `transact` 跨进程。

## 审计覆盖清单

| 文件 | 覆盖 |
|---|---|
| `packages/evolution-core/src/io.ts`（767） | 全读（含 createTextIfAbsent、sweep、writeDurableTmp/commitTmp、atomicWriteFiles、adapter） |
| `.../io-node.ts`（42）、`.../io-registry.ts`（125） | 全读 |
| `.../write-kernel.ts`（183） | 全读 |
| `.../mutation-unit.ts`（666） | 全读 |
| `.../authority.ts`（471） | 全读（HomeAuthority/TargetLockSet/lease/repair） |
| `.../tree-write.ts`（65） | 全读（纯类型 + wrapper，未发现写入语义问题） |
| `.../unit-claim.ts`（9）、`unit-journal.ts`（89）、`unit-members.ts`（153）、`unit-storage.ts`（163）、`unit-undo-plan.ts`（131）、`unit-undo.ts`（124） | 全读 |
| `.../skill-store.ts`（5076） | 重点读：并发/锁/`identify`/`create`/`update`/`patch`/`writeFileCas`/`apply`/`applyMulti`/`writeSupportFile`/`removeSupportFile`/`archive`/`commitMerge`/`consolidate`/`snapshotAll`/`audit`；未细读 extract/restructure/merge-plan 计算、`restoreLatestSnapshot` 的备份恢复细节、frontmatter/lint/threat 扫描（超出写入/IO 域） |
| `.../skill-write-service.ts`（410）、`skill-write-plan.ts`（86）、`skill-write-intent.ts`（159） | 全读 |
| `.../skill-target-locks.ts`（65）、`skill-root-gate.ts`（97）、`skill-observation.ts`（175） | 全读 |
| `.../skill-history.ts`（903） | 读 `nextHistoryIndex`/`recordVersions`/`readHistoryIndex`/版本映射及 undo 相关；`textDiffFacts`/faces 展示层未读（非写入语义） |
| `.../mutations.ts`（127）、`write-authority.ts`（103）、`probe.ts`（144） | 全读 |
| `.../write-gates.ts`（447） | 只读函数轮廓；approval/confirm 属本域外（确认语义由 evolution-approval 承担） |
| tests（skill-store*/skill-write*/mutation-*/io.spec/authority*/unit-transaction*） | 全读 HEAD 改动与新增多 op 用例；`skill-store.spec.ts` 1236 行只对照 HEAD diff，未逐条重读历史用例 |
| 平台 `fs-local/src/index.ts`、`fsio.ts`、`fs/src/types.ts`、`fs-observation-policy/src/index.ts`、`util/atomic-write/src/index.ts`、`storage-json/src/atomic.ts` | 读关键段（写路径/版本/观测/锁/takeover/atomic）；`core/session` 未读——observation actor 形状只经 `fs-observation-policy` 的 `actor.agent.session` 间接引用 |
