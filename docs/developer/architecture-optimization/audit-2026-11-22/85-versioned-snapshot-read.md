# 85 版本化快照无锁读与统一读写内核

状态：设计基线（DCR-85）。本文取代 80-p2-ledger §D1-LOCK-READ 的“只读独占锁”过渡决策，作为下一阶段 HomeFS/StateStore/Projection 的落地设计。本文不改已发布的 0.61.0；实施从后续版本开始，按阶段迁移，具体版本号在发布时由用户确认。

## 1. 结论

不要再给 `state.lock` 加共享读锁，也不要在每个 plugin 里继续手写“读文件 + 自己加锁 + 自己拼快照”。

目标模型只有一个：

> **Home MVCC Store：写入串行、提交不可变、读取无锁。**

- 每个持久域（review/pending/curator、merge、runs、usage、feedback、memory、discovery、reports）是一组不可变对象；
- 所有对象由内容哈希寻址；
- 一次逻辑写入生成一个不可变 `commit`；
- `head.json` 是唯一的可变指针，原子替换；
- 读只读 `head -> commit -> objects`，从不获取跨进程读锁；
- 写只获取一个短 writer lock，提交完成前旧 `head` 始终可读；
- 多文件技能树仍由 `UnitKernel + HomeFence` 保证事务；其 tree unit 作为 commit 的 `tree` 摘要进入同一快照；
- 大模型工具、host 命令、UI 按钮、内部事件全部走同一对 `query / command` 端口，不再直接读写文件。

这样读写只有一个机制，而不是“state 一种锁、merge 一种 fence、usage 一种队列、UI 一种 fetch”。

## 2. 范围

本设计覆盖插件全量提供读写行为的表面：

1. 模型工具：`skill_manage`、`memory`、`skill_search`、`merge_stage`、maintenance probe；
2. host 命令：`/evolution` 全部子命令、`/evolution merge` 全部子命令、learning-graph 命令；
3. UI/按钮：设置页、合并建议页、审批页、技能历史、技能健康、诊断；
4. 内部副作用：usage 记录、activity、feedback、review/curator/approval、projection、报告和 run registry；
5. 平台侧：`ctx.fs`、`@deepseek-ai/dsh-atomic-write`、`ctx.evolutionIo`、`ctx.credentials`、`ctx.settings`、`remote`、tools/commands 注册与 UI slot。

不覆盖：平台会话日志、平台 settings/credentials 的内部存储、模型 provider、MCP 自身。

## 3. 现状证据

### 3.1 平台侧

- `@deepseek-ai/dsh-atomic-write` 的 `withFileLock` 是 `wx` 独占 lock 文件；没有共享读锁。它只适合 writer lock，不能作为“无锁读”的基础。
- `packages/fs/fs-local` 有 per-targetKey promise 队列和 `writeFileAtomic`，适用于单文件/多目标文件的原子发布；它没有跨文件快照和 home 级事务。
- `ctx.fs` 的 `readText` 不加锁；写入由 `fs-local.writeText` 在 target 锁内完成。平台自身的 `tool-fs` 在每次调用时解析 `ctx.fs`，不冻结服务。
- 平台 `skills`/`skill-filesystem` 是只读 provider registry；没有 `skill_manage` 写路径。
- 平台 settings/credentials 是独立服务，UI 只通过 remote 调用；不应被 family store 复制。

### 3.2 插件侧

- `EvolutionState`：`state/store.json` 是完整镜像，`withFileLock(state/state.lock)`；所有读也走锁。domain provider 保留迁移窗口。
- `SkillLibrary`：写走 `UnitKernel` + `HomeFence`/`MutationAuthority`；读走 `readText`/目录树。authority 已改为写时解析（0.61.0）。
- `MergeUnitTransactions`：tree fence + target claim + journal/snapshot；状态和 journal、runs、reports 是多个文件。
- `evolution-commands`：run registry、report、maintain 状态、handoff 走多个文件与 `transactIo`。
- `evolution-activity`/`feedback`/`usage`：分别有 JSONL/侧车/RMW 队列，读路径不统一。
- `evolution-skill-discovery`：domain map/projection/journal/snapshot 各有自己的 fence。
- UI 通过 `host routes` 读取这些文件派生出的 view；按钮通过 command/remote 写入。
- 多处长生命周期对象以前构造时冻结 authority/fence（0.61.0 已改为 use-time accessor）；说明“在构造函数里捕获运行时服务”本身是结构性风险。

## 4. 问题本质

不是某一把锁不够快，而是：

1. **读路径需要一致性**，但平台没有共享读锁；
2. **写路径是分散的**，每个包自己决定文件、锁、fence、serial、journal；
3. **读和写没有共同提交点**，读者可能看到 state、merge、runs 的混合版本；
4. **UI、命令、工具各自实现读取**，同一状态的语义容易漂移；
5. **长迁移/长写会阻塞所有读**，因为没有“旧快照继续可读”的概念；
6. **故障恢复靠各文件各自处理**，没有统一的“最后一个完整 commit”。

因此局部优化（共享读锁、读超时、缓存、readTextOrNull）都只能减少症状，不能减少机制数量。

## 5. 目标模型：Home MVCC Store

### 5.1 目录

```text
<evolutionHome>/store-v2/
  head.json                     # 唯一可变指针（原子替换）
  commits/<commitId>.json       # 不可变 commit manifest
  objects/<sha256>.json         # 不可变内容对象
  logs/activity/<segment>.jsonl  # 追加日志（非 MVCC）
  tmp/                          # 原子写临时文件（平台写实现）
```

`head.json`：

```json
{
  "schemaVersion": 1,
  "commitId": "01J...",
  "commitSha256": "…",
  "updatedAt": "2026-…"
}
```

`commits/<commitId>.json`：

```json
{
  "schemaVersion": 1,
  "commitId": "01J...",
  "parent": "01H...",
  "createdAt": "2026-…",
  "domains": {
    "state": "sha256:…",
    "merge": "sha256:…",
    "runs": "sha256:…",
    "usage": "sha256:…",
    "feedback": "sha256:…",
    "memory": "sha256:…",
    "discovery": "sha256:…",
    "reports": "sha256:…"
  },
  "tree": {
    "unitId": "…",
    "manifest": "sha256:…"
  },
  "source": "foreground|background_review|command|ui|tool"
}
```

`objects/<sha>.json` 是纯内容；同一内容只写一次。`tree` 可为空；有 tree 的提交表示这次提交同时发布了一个技能树 unit。

### 5.2 写入算法

所有写命令只有一个入口：

```text
command(input, {expectedHead?})
  -> acquire the ONE HomeFence writer scope (existing single home lock; nested callers use runNested)
  -> read head + commit（若不存在则从 legacy bootstrap）
  -> validate expectedHead（可选 CAS）
  -> run domain mutator on immutable previous values
  -> write changed objects with createTextIfAbsent(objects/<sha>)
  -> build full domain map = previous domains + changed
  -> write commits/<newCommitId>.json (immutable)
  -> atomically replace head.json
  -> release lock
  -> return {commitId, values}
```

规则：

- **对象先写，head 后写**：head 不指向半成品；
- `createTextIfAbsent` 保证内容对象不被覆盖；
- `head.json` 用平台原子写（临时文件 + rename）；
- writer 临界区由唯一的 `HomeFence`（`HomeAuthority` 的 tree scope，内部是平台 `withFileLock`）承担；不新增 `commit.lock` 文件，也不新增第二套跨进程锁。commit 临界区只包住“读 head → 写 head”，不覆盖长时间模型调用/文件扫描；
- 长任务（scan、review、maintain）把“准备阶段”放在锁外，只把最终提交放在锁内；
- 需要多文件技能树的命令先 `UnitKernel.prepare`，再提交 tree unit，最后发布 head；tree unit 的 journal 是恢复权威；
- 一个 commit 失败：只要 head 未替换，旧 commit 完整可读；孤儿对象由 GC 清理；
- 不必写 temp 再 rename 整个目录；平台 `writeFileAtomic` 负责单文件原子发布。

### 5.3 读取算法

```text
query({domains?})
  -> read head.json
  -> read commits/<head.commitId>.json
  -> validate commitSha256
  -> for each requested domain: read objects/<sha>
  -> validate sha
  -> return {commitId, values, tree}
```

- **不取 HomeFence，不做 state.lock，也不存在要取的 commit.lock 文件**。
- head 在查询中途变化不影响结果：读者已拿到一个完整 commit；
- 下一次查询自然看到新 head；
- 如果 head/commit/object 读失败：有限重试（读取 head 后重读 head，最多 3 次），仍失败则 **fail closed**，绝不把空对象当默认值；
- 进程内可以按 `sha` 缓存已解析对象；对象不可变，缓存无需失效；
- 读自己的写：command 返回 `commitId`；同一进程立即 query 能看到该 head（因为 head 在 command 返回前已更新）。

### 5.4 多域一致性

commit 保存的是 **一个完整 domain map**，而不是增量。

- 一次命令修改 state + merge + runs，读者在同一个 commitId 下看到三者同版本；
- 不需要每个域各有一个 current 指针，也不需要读者拼三个指针；
- 未变化域复用上一个 commit 的 object sha；不会重复写；
- 代价是一个 commit 最多写一个 manifest，可接受。

这是本设计相对“每域 current 文件”的关键简化：**一个 head，天然多域一致**。

### 5.5 写者互斥：一个 HomeFence，不是第二把锁

写者只使用现有的 `HomeFence`：

```text
HomeFence.run(tree)
  -> 读 head -> 写 objects -> 写 commit -> 原子写 head
```

- `HomeFence` 已经封装 `HomeAuthority` 的 tree scope：进程内 FIFO + 跨进程平台 `withFileLock`；这就是“唯一 writer lock”。
- 写技能树的命令先由 `HomeFence` 持有 tree scope；本次 commit 在同一 `fence.run` 内 `runNested`，不重新抢占锁，也不引入反向顺序。
- metadata commit 与技能树写者共享同一 fence：两个写者本来就应串行；读者不受影响。
- 文档里“commit.lock”只是 commit 临界区的逻辑名，**磁盘上没有 `commit.lock` 文件**；新增任何独立跨进程锁都会被门禁判红。
- 读不取任何锁；禁止为读增加共享读锁、读超时或 reader registry。
- 禁止在 fence 内调用模型、review 子代理、长时间扫描；长任务在锁外完成，只把最后提交放进锁内。
- 禁止在 fence 内取另一个 home 的 fence/store。

### 5.6 GC

- 保留最近 `N=64` 个 commit；R1 只做 count-based retention，7 天年龄保留延后到有真实 mtime/GC 验收后再加，避免把未验证的时间规则写进权威路径；
- 从 head 沿 parent 链保留引用；
- 不再被任何保留 commit 引用的 object 才删除；
- GC 在 writer fence 内只做“候选计算”，删除 best-effort：失败只记录到 `failures`，不抛、不破坏 head；
- GC 永远不删除当前 head 或其直接 parent；
- 崩溃留下孤儿 object 是安全的，只会占空间。

### 5.7 R1 落地修订（代码证据）

读完 `state/index.ts`、`state/store.ts`、`state/store-plugin.ts`、`io.ts`、`home-fence.ts`、`authority.ts`、平台 `atomic-write` 后，对初版 DCR-85 作两处收敛，后续实现以此为准：

1. **不新增 `store-v2/commit.lock`**。`HomeFence` 已经是唯一 home 级 writer 锁（`HomeAuthority` tree scope + 平台 `withFileLock`），metadata commit 直接在该 fence 内完成；独立锁文件会变成 DCR-85 所禁止的第二套跨进程锁。
2. **v2 读路径不经过 `withFileLock`，也不经过 `EvolutionState.withStateLock`**。0.61.0 的 `EvolutionState` 仍把所有读包在 `home/state.lock` 里，这是 R2 要删除的过渡机制；v2 kernel 的 query 只做 `readText`。
3. **对象/commit 的原子性来自 `EvolutionIoLike` 的 tmp+rename/`createTextIfAbsent`，不用 `writeFileAtomic` 直接写路径**。`nodeEvolutionIo.writeText` 已是原子替换；跨后端由 seam 保证。平台 `writeFileAtomic` 只在直接构造 kernel 的单测可注入；生产不绕过 IO seam。
4. **第一版 kernel 只做通用对象层**：domain schema、state/merge 的适配器在 R2 接入；R1 不改变 `EvolutionStateStorage` 的现有行为，也不删除 domain provider。

### 5.8 R1 已落地证据

- 代码：`packages/evolution-core/src/store/{types.ts,store-kernel.ts,index.ts}`；
- 公开面：`StoreKernel.query/mutate/bootstrap/collectGarbage`，根导出；
- 写入：`HomeFence.run` → 写 content object → 写 commit → 原子写 `head.json`；
- 读取：`readHead → readCommit → readObject`，全程不调用 fence；
- 对象/commit 使用 IO seam 的 `createTextIfAbsent`/`writeText`；没有 `commit.lock` 文件；
- 已覆盖：bootstrap、旧快照不可变、expectedHead CAS、同字节 no-op、head 缺失/对象篡改 fail-closed、重复 bootstrap 拒绝、GC 保留 head 链、读在 HomeFence 被持有时仍完成（真实平台锁）、嵌套 commit 检测、tree 归一化、非 plain JSON 拒绝、GC retain 非法值、head 瞬时缺失重试、publish 在 head 前崩溃后旧 head 可读；
- 独立复核后修复：P0-1 发布前用 `parseCommit` 自检（source/tree 归一化，非法对象不再锁死 head）；P0-2 `change` 后重新读 head，嵌套/并发 commit 抛 `StoreConflictError` 而不是被覆盖；P1-1 GC `retain` 校验并 best-effort 记录失败；P1-2 head 短暂缺失 bounded retry 且区分“未初始化/commit 存在但 head 丢失”；P1-3 Date/class/Map 等非 plain JSON 值拒绝；
- 验证：`store-kernel.spec.ts` 13 tests passed；`tsc -b packages/evolution/evolution-core/tsconfig.json` exit 0；现有 `state/store-provider.spec.ts` 5 tests 隔离运行通过；
- 新静态门禁：`verify-store-kernel.mjs`（gate-87）检查 query 无写锁、写入只用一个 HomeFence + IO seam、head/commit/object 已登记 `persisted-write-inventory`；已通过；
- 仍未完成（R2 前补齐）：真实两进程 writer、publish 各阶段 crash、read-during-write、GC/reader race、legacy bootstrap 迁移测试；见复核清单。
- 下一步 R2 才接 `EvolutionState`/state provider；R1 不改变 0.61.0 的运行路径。
- 下一步 R2 才接 `EvolutionState`/state provider；R1 不改变 0.61.0 的运行路径。

### 5.9 R2 设计：State 接入 MVCC（先设计，后改代码）

R1 的 kernel 只是对象层。R2 才把 review/pending/curator 的 state 接到它上面，并且**不改变 0.61.0 默认行为**，直到显式迁移。

#### provider 与切换

- 新增 provider 名 `store-v2`，实现现有 `EvolutionStateStorage` 接口；`locking: 'internal'`。
- `EvolutionStateStorage` 增加可选 `locking?: 'consumer' | 'internal'`；缺省 `consumer`（v1 store/domain 仍由 `EvolutionState` 的旧 `state.lock` 保护）。v2 的每个方法内部通过 kernel 的 writer fence 串行，消费者不得再套 `state.lock`。
- `EvolutionState.run()` 先解析当前 provider：`internal` 直接执行；`consumer` 才走旧 `withStateLock`。这一改动让 v2 读彻底无锁，同时 v1/domain 迁移窗口保持原语义。
- **Phase-1 exit gate**：在把 state 写入路由到 `store.mutate` 的同一个改动里，v2 路径必须不再获取 `state.lock`；禁止“v2 写 kernel + 外层仍持 state.lock”的双锁组合（会反转 HomeFence→state 的顺序）。测试必须证明：持 v2 写 fence 时 v2 读完成，持 v1 `state.lock` 时 v1 读仍等待。
- `auto` 规则保持向后兼容：
  1. v2 marker 存在 ⇒ `store-v2`；
  2. v1 marker 存在 ⇒ `store`；
  3. 无 marker、domain provider 存在 ⇒ `domain`；
  4. 都无法判定 ⇒ fail loud。
- 不在 R2 把默认改成 v2。升级用户必须显式运行 `/evolution migrate state --to v2`；fresh 安装也走同一命令（或后续安装器写入 v2 marker 后再切换默认）。这避免“v2 空 store 掩盖 domain/v1 数据”的静默丢状态。
- R7 再删除 v1/domain provider，并把默认切到 `store-v2`。

#### 文档与纯 reducer

- 把 v1 `state/store.ts` 里的 `StoreFile` 形状、parse/serialize、review/pending/curator 变更规则抽到 `state/document.ts`：
  - `StateDocument`：`{ version: 1, review, curator, pending }`（沿用现有磁盘 schema，v2 不改字段）；
  - `emptyStateDocument()` / `parseStateDocument()` / `serializeStateDocument()`；
  - 纯 reducer：`saveReview`、`saveCurator`、`transactCurator`、`savePending`、`claimPending`、`releasePending`、`resolvePending`、`listPending`、overflow/cap 规则。
- v1 file provider 与 v2 provider 共用同一 reducer；禁止复制 claim/resolve/overflow 规则（当前 store.ts 已有一份，复制会成为第二个缺陷源）。
- v2 provider 的每个写方法：
  1. `kernel.mutate({domains:['state'], change: current => ({state: reducer(current.state, input)})})`；
  2. return value 由 reducer 内部产出，不依赖写后重读。
- v2 provider 的每个读方法：`kernel.query(['state'])` 一次，取同一 commit 的 state；不读 head 多个文件，不取 fence。
- `state` 域值为完整 `StateDocument`；R2 仍然一个 JSON 对象，不把 review/pending 拆成多个对象，避免多域指针。

#### 迁移

`migrateStateToV2(ctx, {io,home})`：

1. 源选择：优先当前已挂载的 v1 `store`（读 `state/store.json`）；否则读 domain（复用现有 `migrateDomainToStoreUnlocked` 的读取逻辑，抽成 `readLegacyStateDocument`）；
2. 在 `HomeFence` 内 `kernel.bootstrap({state: document})`；已有 v2 head ⇒ 拒绝覆盖；
3. 写 `.migrated-to-store-v2.json`，记录 `commitId`、source（`domain|store`）、counts；
4. v1/domain 数据不删除，回退是显式把 `provider` pin 回旧名并保留 marker；
5. `--dry-run` 只读源、不写 head/marker；
6. 失败矩阵：源损坏、v2 head 已存在、marker 写失败但 head 已发布 ⇒ 明确恢复指引（head 是权威，补 marker 可重试），不静默回退。

#### 迁移窗口与失败模型

- v2 marker + head 缺失/损坏 ⇒ fail closed（不把空 document 当默认）。
- v1/v2 同时存在但无 v2 marker ⇒ `auto` 继续 v1；v2 provider 被显式 pin 时不得读 v1 数据，报“先 migrate”错误。
- v2 写成功后 v1 不双写；回退会丢 v2-era 新写，因此回退必须 pin 旧 provider，不能只删 marker（沿用 0.61 的 D1-ROLLBACK 判定）。
- v2 的 read 不调用 `withFileLock`/`state.lock`；`EvolutionState` 的 `locking` 分支是唯一的消费者级开关。
- HMR：provider 每次 apply 都新建，fence 用 `liveHomeFence(ctx, home)`；不在构造期冻结 authority。
- 多进程：两个进程同时 migrate，只有 HomeFence 内的 `bootstrap` 成功；第二个 fail loud。

#### R2 验收

- v2 provider 通过 `runStateProviderConsistency` 全套；
- v2 读在 HomeFence 被持有时完成；v1 读仍按旧 state.lock 等待（证明迁移窗口没有偷偷改语义）；
- `domain→v1→v2` 与 `domain→v2` 迁移用例、v1 新写后禁止静默回退、marker 写失败恢复、v2 head 损坏 fail closed；
- 所有 state 命令/工具/UI 不需要改调用签名；只由 `EvolutionState` 内部选择 provider；
- 更新 77/78/80：D1-LOCK-READ 的 v2 部分通过 locking 分支实现，v1 过渡未删除。

#### R2 已落地（第一段）

- `state/document.ts`：v1/v2 共用的 parse/serialize、review/pending/curator reducer；v1 `state/store.ts` 已改用，不再有第二套 claim/resolve/overflow 规则。
- `state/v2-provider.ts`：`store-v2` provider，`locking: 'internal'`，所有读走 `kernel.query(['state'])`，所有写走 `kernel.mutate`。
- `EvolutionState`：`run()` 同步校验后按 `locking` 分支；v1/domain 继续 `state.lock`，v2 不取。
- `auto`：v2 marker 优先，其次 v1 marker，其次 domain；v2 marker 缺 head 时 mount/first-op fail closed。
- `/evolution migrate state --to v2`：从 v1 store 或 domain 读取完整 document，`kernel.bootstrap`，写 `.migrated-to-store-v2.json`；v1/domain 不删除；head 已存在且 marker 缺失时按 head 恢复 marker。
- `store-plugin` 同时注册 v1/v2 provider；v2 provider 每次 apply 新建，fence 用 `liveHomeFence`，不在构造期冻结 authority。
- 测试：v2 provider conformance 3 tests、migrate command 6 tests、state provider/auto 11 tests（含 `state.lock` 持有时 v2 读完成）；`tsc` core/commands exit 0。
- 尚未切默认：`auto` 仍走 v1/domain，只有显式 v2 marker 才用 v2；R7 才删 v1/domain 并切默认。

#### R3 已落地（run registry 第一段）

- `run-registry.ts` 增加可选 `RunStorePort`、`createRunStorePort`、`runStorePortIfV2`；没有 v2 marker 时仍走 `runs.json`，不改变旧行为。
- `emptyRunIndex` / `parseRunIndexDocument` 是文件与 MVCC 共用的文档形状；run registry 的 begin/stage/settle/load/supersede 全部走同一 `writeIndex`/`readIndexText`。
- `--to v2` 首次 commit 同时迁移 `runs.json` 到 `runs` 域；v2 下 `runs.json` 不再被写。
- `evolution-commands`、`evolution-merge`、UI history 在 v2 marker 存在时注入 store port；否则继续 legacy。
- 测试：run-registry-v2 2 tests、legacy run-registry 21 tests、v2 state 6 tests 通过；`tsc` core/commands/merge/ui exit 0。
- 下一段：merge rows/reports 的 commit 适配，以及 v2 下 `runs` 域与 merge 域的同一 commit 关系。

#### R3b 已落地（merge state 桥）

- `store/scoped-text-io.ts`：把**恰好一个**旧文本路径映射到 MVCC 域（`merge` 域值 `{text}`），其他路径全部委托 base IO；`transact` 走 kernel，不再写原文件；`copy` 支持 pre-1b 备份复制，`exists/size/read` 从域读。
- 这是过渡适配器，不是第二存储：同一路径只写域，不双写；R7 用显式 query/command 替换调用方后删除。
- `merge-state.json` 只在 v2 marker 存在时启用桥；未迁移仍走原文件。
- `migrateStateToV2` 首 commit 同时携带 `merge` 文本、`runs` 文档与 `state` 文档；v2 merge 读取/写入与 runs/state 同一 commit。
- 测试：scoped-text-io 2 tests、v2 state/migration 7 tests 通过；`tsc` core/commands/merge/ui exit 0。
- 下一段：merge run-meta/report 引用、pre-1b 迁移与 v2 下的 `merge-state` 读写回归。

#### R3c 已落地（merge 辅助文件）

- `store/scoped-tree-io.ts`：`merge/run-meta` → `mergeMeta` 域、`reports` → `reports` 域，均存 `path -> text` map；dot 开头的锁文件（如 `reports/.retention`）仍走 base IO，不进入 commit。
- `mergeAuxIoIfV2` 只在 v2 marker 存在时包裹 merge IO；未迁移路径不变。
- `migrateStateToV2` 首 commit 同时读取旧 `merge/run-meta/*.json` 与 `reports/*`，避免 v2 下报告/运行元数据消失。
- 测试：tree IO 1 test、v2 state/migration 7 tests（含 run-meta/report 迁移）通过；`tsc` core/merge 0；io-discipline gate 通过。
- 这仍是过渡桥；R7 删除 path adapter，改为显式 report/meta 查询/命令端口。

#### R4 已落地（usage / suppressed / feedback 快照）

- `state/config` 新增 `usage` / `suppressed` / `feedback` 域；`newSkillLibrary` 在 v2 marker 下把 `.usage.json`、`.curator-suppressed.json` 包成 scoped text IO，SkillLibrary 的现有读写代码不变；skill 文件路径仍委托 base。
- `EvolutionFeedback` 在 v2 marker 下把 `feedback.json`（可重建缓存）映射到 `feedback` 域；events log 仍是 append-only，不进快照。
- `--to v2` 首 commit 同时迁移 usage/suppressed/feedback 文件；默认 skillsRoot 可由迁移选项覆盖。
- 测试：v2 sidecar 迁移 7 tests、feedback bridge 1 test、scoped text/tree 3 tests 通过；`tsc` core/activity/merge 0。
- 尚未做：discovery projection 与 memory 正文树、usage 事件化；R4b/R5 继续。

#### R4b 已落地（discovery 文档）

- `domain-map.json`、`projection-journal.json`、`view-snapshots.json` 在 v2 marker 下分别映射到 `domainMap`、`projectionJournal`、`viewSnapshots` 域；`discoveryIoIfV2` 在 main-entry 包住 IO，三个 Store 的代码不改。
- `--to v2` 首 commit 同时迁移这三个默认路径的文件；自定义路径仍由各自 adapter 按 v2 域读写。
- 测试：v2 state/migration 7 tests 覆盖三域迁移；`tsc` core/discovery 0。
- 尚未做：memory 正文树（R4c）与 activity append 分段（R5）。

#### R4c 已落地（memory 正文）

- `MEMORY.md` / `USER.md` 在 v2 marker 下映射到 `memoryFile` / `userFile` 域；`memoryIoIfV2` 包在 memory-files 的 store IO 上，`MemoryStore` 的读写/归档/回滚代码不变。
- `--to v2` 首 commit 同时迁移默认 `<dshHome>/memories` 下的两个文件；迁移选项可覆盖 memoryRoot。
- 测试：v2 state/migration 8 tests 覆盖 memory 迁移；`tsc` core/memory 0。
- 尚未做：memory 新增大正文的 blob 分层（当前单文本域，符合 DCR-85 的“大正文用 blob”后续项）。

#### R5 已落地（activity 事件分段）

- 既有边界保持不变：active `events.json` 到 `EVENT_LOG_ROTATE_AT=4000` 轮转为 `events-<lastArchivedSeq>.json`，保留 10 个 archive；append 在同一事务内写 archive 再写 active，archive 失败则整个 append 失败，active 不截断。
- `readEvolutionTimeline` 新增 `afterSeq` / `limit` 分页：按 archive 名（最后归档 seq）跳过整段旧 band，只读候选 archive + active，按 seq 升序返回，`hasMore` 表示分页未取完；`malformed` 语义不变。
- 日志仍是 append-only 的 base IO，不进入 MVCC；分段/轮转/offset 都不改变 best-effort 归档失败模型。
- 测试：evolution-events **24 tests**（含分页）通过；`tsc` core 0。
- 尚未做：offset 读在 UI 历史的接线、活动分段跨进程压力测试（属 R8 证据）。

#### R6a 已落地（tree manifest 基础）

- `store/tree-manifest.ts`：`buildTreeManifest(unitId, ops)` 纯函数，按 path 排序、去重（同 target 最后一次写胜出），write 记录 `sha256`/size，delete 记录 `kind:'deleted'`；
- `publishTreeManifest` 把 manifest 写成普通内容对象，返回 `StoreTreeRef`；`readTreeManifest` 通过 `getObject` 取回并校验；
- `StoreKernel` 新增 `putObject` / `getObject`（内容寻址、读时校验 sha），commit 的 `tree` ref 已在 `query` 返回；
- 测试：tree manifest 1 test；`tsc` core 0。
- 尚未做：把 `publishTreeManifest` 接到 UnitKernel 的每次 tree unit（包括失败/回滚/并发顺序），以及 materialized tree 的迁移期兼容；属 R6b。

#### R6b 已落地（方法边界发布）

- `UnitKernel` 新增 `afterCommit`：只在 unit lease 释放后调用，且不把 hook 失败变成回滚（结果带 warning）。
- `SkillLibrary` 用 `afterCommit` **只记录** `(unitId, snapshot ops)`，不立刻写 store；`withMutationLock` / `withTarget` 在锁释放之后再 `flushTreeUnits`，由 `publishTreeManifestFiles` 写内容对象并提交 metadata commit。
- 更新（`update` 等只走 `withTarget` 的路径）同样在目标锁释放后 flush；`create` 与 `update` 的端到端测试都能拿到新的 commit/tree ref。
- 这避开了两层锁：tree unit 内层 lease 已释放、公开方法的外层 `withMutationLock` 也已释放；`create` 的端到端测试在 0.65s 内拿到 query `tree.manifest`，manifest 含 `SKILL.md`。
- 若显式外层 HomeFence 仍被调用方持有（merge/undo/consolidate），flush 会保留队列并跳过，等下一个方法边界再发布；不自我死锁。flush 的“是否持锁”通过 `currentFence()` 动态解析，late-provided authority 也不会绕过该检查。
- 失败模型：metadata commit 失败只 `console.warn`，树内容以 UnitKernel 快照为准；materialized tree 仍是迁移期 fallback。
- 测试：tree-manifest-boundary 1 test；`tsc` core 0。
- 尚未做：外层面板/命令层显式 flush（当前依赖公开方法边界）、materialized tree 的读兼容切换。

#### R7a 已落地（surface registry）

- `store/surface.ts`：登记 DCR-85 第 9 节全部模型工具、host 命令、UI action 的稳定 `id`、`kind`、读/写域、`expectsCommit`；不登记任何 secret 载体，settings/credentials 的读写域为空。
- `requireStoreSurfaceCommand(id)` 对新 surface 失败关闭；`store-surface.spec.ts` 校验每个 `HOST_COMMAND_DEFS` id 都在 registry 中、registry 的 command 都是真实 host 命令、id 唯一。
- 测试：store-surface 3 tests；`tsc` core/commands 0。
- 尚未做：把 dispatch/route 实际改为只调用 query/command；该 registry 是 R7b 的闭包检查基线。

#### R7b 已落地（query/command 服务）

- `store/service.ts`：`StoreService.query(commandId, domains)` 与 `StoreService.command({commandId, domains, expectedCommit, change, tree})`；
- 读：只允许 `command.reads ∪ command.writes` 声明的域；写：只允许 `command.writes`；未知 command id 直接失败；
- 写通过 `StoreKernel.mutate`，`expectedCommit` 映射为 `expectedHead`，tree ref 原样透传；service 不新增锁，也不绕过 kernel；
- 测试：store-service 1 test（读/写域越界、未知 id、正常 approve 写）通过；`tsc` core 0；
- 尚未做：host command/tool/UI route 实际调用该 service；当前只是把闭包与写入口收成一个可注入对象。

#### R7c 已落地（service 注入）

- `evolution-state-store` 在 v2 marker 存在时 `ctx.provide('evolutionStore', StoreService)`；service 与 v2 provider 共用 `/state` 下的同一 kernel、同一 `liveHomeFence`，无新锁、无第二存储。
- 未迁移时 service 不存在，调用方继续 legacy provider；这保证默认仍走 v1/domain，不改变用户安装。
- HMR 语义：store-plugin 重新 apply 时重新创建 kernel/service；旧 service 随旧 ctx 失效，不缓存 IO/fence。
- 测试：store-service-plugin 2 tests（无 marker 不提供、有 marker 提供）；`tsc` core 0。
- 尚未做：host command/tool/UI 的实际 dispatch 仍未改为 `ctx.get('evolutionStore')`；这是 R7d。

#### R7d 已落地（doctor 首个消费者）

- `doctor --json` 在 `ctx.get('evolutionStore')` 存在时调用 `query('doctor')`，报告新增 `store: { commitId, treeUnit }`；
- 文本报告保持原样（没有新 locale key），未迁移 home 或 service 不可用时字段不出现；
- 查询失败只省略该字段，不让诊断整体失败；
- 测试：doctor-store 1 test；`tsc` commands 0；

#### R7e 已落地（run registry 走 service）

- `runStorePortIfV2` 在 `ctx.get('evolutionStore')` 存在时不再新建 kernel：
  - 读走 `query('maintain.status', ['runs'])`；
  - 写走 `command('maintain.handoff', { domains: ['runs'] })`；
- service 不在时仍回退到独立 kernel（兼容旧 composition）；
- 这消除了 run registry 在 v2 下的重复 kernel，同时保持同一 `runs` 域与同一 HomeFence；
- 测试：run-registry-service 1 test（断言 query/command id 与委托）；`tsc` core 0。

#### R7f 已落地（merge 单 kernel）

- `mergeIoIfV2` 用一个 kernel 同时构造 merge-state scoped IO 与 run-meta/reports scoped tree IO；merge 组合只调用一次，删除原先 state/aux 各建一个 kernel 的重复；
- 两个视图仍共享同一 `HomeFence`；未迁移时仍返回 undefined，调用方用 base IO；
- 测试：v2-merge-bridge 1 test、scoped-text-io 2 tests 通过；`tsc` core/merge 0。

#### R7g 已落地（旧 merge 适配器移除）

- 删除未被生产引用的 `mergeStateIoIfV2` / `mergeAuxIoIfV2`，只保留一个 `mergeIoIfV2` 复合入口；
- 测试改用复合入口，避免两套路径再次漂移；
- 这是 R7 清理“重复适配器/兼容 shim”的第一项。

#### R8 证据（跨进程无锁读）

- `packages/evolution-core/scripts/verify-cross-process-read.mjs`：父进程在 `HomeFence.run` 内持有 writer fence，子进程用构建后的 `lib/index.js` 打开同一 home 并 `StoreKernel.query(['state'])`，返回 bootstrap 快照；
- 这证明读路径不依赖 writer lock，且子进程只读同一 commit；已注册为 gate-88（local/ci-static，build-lib 之后运行），不再是无人执行的证据。
- 尚未做：子进程读与崩溃恢复的组合、HMR 重挂载、fresh npm profile 真机验收。

补充：`v2-provider.spec` 新增“head 已提交但 marker 写入丢失”的恢复测试——`migrateStateToV2` 从 head 重建 marker 并返回 `store-v2-recovered`，commitId 不变；证明迁移的 commit point 是 head，不是 marker。

补充：store-service-plugin 增加 HMR 用例——dispose 旧 fiber 后重新挂 store-plugin，`evolutionStore` 仍可解析；provider/service 都不缓存旧 IO/fence。

#### R8 独立复核后修复（P1）

- P1-1：`restructure` / `extract` / `applyMulti` 现在也在公开方法边界 flush tree manifest；`tree-manifest-boundary` 增加 restructure 判据（新 commit、新 tree ref）。
- P1-4：`migrateStateToV2` 整体在 `state.lock` 内执行（源读取、head bootstrap、marker 写入），与 v1 写者使用同一把锁。
- P1-5：head 已存在但 marker 丢失时，恢复路径重读 legacy source 并与 head 文档逐字节比较；不一致直接拒绝恢复，避免崩溃窗口内的 v1 写被静默作废。
- P1-2：`usageSidecarIoIfV2` 统一包 usage/suppressed；`SkillUsageRegistry` 与 curator 的私有 `this.io` 都改用它，`mutateUsage`/`loadSuppressedNames` 不再写第二份文件；测试 `usage-sidecar-v2.spec` 证明 domain 有值且 base 文件不存在。
- P1-3：`migrate state` 新增 `--skills-root` / `--memory-root` / `--discovery-root` / `--feedback-path`，把自定义根/路径传给 `migrateStateToV2`；默认路径不变，未传时仍按 `<home>` 约定。
- 测试：marker 恢复成功/拒绝两例通过；restructure manifest 通过；usage-sidecar-v2 通过；`tsc` core/curator/discovery/commands 0。
- P1-6：跨进程无锁读 drill 注册为 gate-88（overlay tree, local/ci-static），有 family-facts 声明与 no-drill reason；本地已运行通过。
- P1-7（部分）：新增 gate-89 `verify-store-surface`，host command ↔ surface command 双向闭包；`--self-test` 注入未登记命令并证明必红；gate-manifest / check-registry 通过。
- P1-8（部分）：surface registry 补齐 merge 子命令（scan/pair/status/report/cancel/runs/doctor/reconcile/pending/candidates/approve/reject/resume/skipped/discard/undo）、usage observation 与漏掉的 UI action；gate-89 现校验 29 host commands ↔ 45 command ids（子命令按父命令归属）。
- 未修：剩余 3 个静态门禁（read-lock/head/single-source 深度）、多数 surface 仍无真实消费者（service 目前只被 doctor/run-registry 使用），继续按复核清单处理。
- 这是首个真实 dispatch 消费者；其余 host command/tool/UI 仍走 legacy 路径。
- 验收判据：tree unit 后 query 的 `tree.manifest` 非空；manifest 条目与 unit ops 的 path/hash/delete 一一对应；metadata commit 失败只产生告警，不回滚已提交的树；并发两个 unit 各自得到独立 commit tree ref。


## 6. 域与读写分类

并不是所有东西都塞进 MVCC。按语义分三类，避免过度设计。

### 6.1 快照域（MVCC）

- `state`：review sessions、pending、curator state；
- `merge`：merge rows、schema state、staging index 摘要；
- `runs`：run registry 快照；
- `usage`：usage map；
- `feedback`：feedback store；
- `discovery`：domain map/projection/journal/snapshot 的合并视图；
- `memory`：memory 索引/元数据（正文大文件可继续按 target 原子写）；
- `reports`：报告引用（报告正文可放 object 或保持文件，commit 存 digest）。

这些域由同一 commit 发布。

### 6.2 追加域（append-only）

- `activity`、event log、usage observation 事件。

保留 JSONL/segment，不进入 commit：

- 追加写由单 writer serial queue 完成；
- 读按“读到 EOF 的不可变前缀”返回；
- 轮转产生新 segment，旧 segment 不可变；
- commit 只引用当前 segment 的 id/offset（可选），不复制日志；
- 读日志不需要锁，不需要 MVCC。

### 6.3 大对象域

- 技能正文、support file、报告正文、历史版本 blob。

继续用内容寻址 object 或平台/文件系统原子写：

- 写入前先写 blob（`objects/<sha>` 或 `.archive`）；
- commit 只引用 sha；
- 读按 sha 读，无锁；
- 删除由 GC 做引用计数。

## 7. 技能树与 UnitKernel

技能树不是简单的 JSON，不能强行塞进 store。

保留：

- `UnitKernel` 的 lock/claim/journal/snapshot/recover；
- `HomeFence` 的跨进程树锁；
- `SkillLibrary` 的 `prepare/commit` 两阶段；
- 写时 authority accessor（0.61.0 已落地）。

新增：

- 每次成功的 tree unit 产生一个 **tree manifest object**：`{unitId, entries:[{path, blobSha, mode}], digest}`；
- commit 的 `tree` 字段引用该 manifest；
- query 返回 `tree`；模型/UI 读技能时先读 manifest 再读 blob；
- 迁移期仍可读 materialized 文件；manifest 是长期权威；
- tree unit 的 journal 是恢复权威，commit 不替代它；
- tree unit 与 metadata commit 的先后：tree unit 提交成功 → metadata commit；若 metadata commit 失败，tree unit 已是可见写，必须由 recovery 标记/重试，不静默丢失。

## 8. 统一端口

### 8.1 插件内部

```ts
interface EvolutionStore {
  query<T>(request: StoreQuery): Promise<StoreSnapshot<T>>
  mutate<T>(request: StoreMutation<T>): Promise<StoreCommitResult<T>>
  watch?(listener: (commitId: string) => void): () => void
}

type DomainId =
  | 'state' | 'merge' | 'runs' | 'usage'
  | 'feedback' | 'memory' | 'discovery' | 'reports'

interface StoreSnapshot<T = Record<DomainId, unknown>> {
  readonly commitId: string
  readonly domains: T
  readonly tree: TreeRef | null
}

interface StoreMutation<T> {
  readonly domains: readonly DomainId[]
  readonly expectedHead?: string
  readonly source: 'tool' | 'command' | 'ui' | 'background'
  readonly mutate: (previous: T) => T | Promise<T>
  readonly tree?: TreeUnitRef
}
```

实现骨架（`evolution-core/src/store/store-kernel.ts`）：

```ts
async query<T>(domains: readonly DomainId[]): Promise<StoreSnapshot<T>> {
  const head = await this.readHead()                 // no lock
  const commit = await this.readCommit(head.commitId)
  const values = await Promise.all(domains.map(id =>
    this.readObject(commit.domains[id])))
  return { commitId: commit.commitId, domains: zip(domains, values), tree: commit.tree }
}

async mutate<T>(request: StoreMutation<T>): Promise<StoreCommitResult<T>> {
  return this.writer.runExclusive(async () => {       // one writer, cross-process
    const previous = await this.readHeadCommit()
    if (request.expectedHead && previous.commitId !== request.expectedHead) {
      throw new StoreConflict(previous.commitId)
    }
    const values = await request.mutate(previous.values)
    const domains = await this.writeChangedObjects(previous.domains, values)
    const commitId = this.nextCommitId(previous.commitId)
    const commit = { commitId, parent: previous.commitId, domains, tree: request.tree }
    await this.writeCommit(commit)
    await this.writeHead({ commitId, commitSha256: sha(commit) })  // atomic
    return { commitId, values }
  })
}
```


- `query` 只读，不锁；
- `mutate` 是唯一写入口，内部取 writer lock；
- `StoreMutation` 声明 domains、mutation、expectedHead、source；
- 不在 `commands.ts`/tool handler/UI route 里直接调用 `io.readText/writeText`。

### 8.2 命令/工具/UI 同源

每个用户意图只定义一次：

```ts
type CommandSpec = {
  id: string
  readOnly: boolean
  query?: (snapshot) => View
  mutate?: (snapshot, input) => StoreMutation
  tool?: ToolDefinition
  uiRoute?: string
}
```

- 模型工具调用 `commands.run(spec, input)`；
- host 命令调用同一个 `commands.run`；
- UI 按钮调用同一个 remote command；
- read-only 页面调用 `commands.query(spec, input)`；
- 禁止 UI route 自己拼 `readText`，禁止 tool handler 自己写 sidecar。

### 8.3 Remote/UI

- `GET` 只返回 query 结果 + `commitId`；
- `POST` 只接受 command id、input、可选 `expectedCommit`；
- 所有 UI 按钮都映射到 command id，不直接访问路径；
- 前端收到 `commitId` 后可用它做 stale 检测；提交冲突返回结构化 `store-conflict`，UI 刷新后重试；
- Settings/credentials 按钮例外：继续走平台 `remote.credentials` / `settings`，不进入 family store（secrets 永不进快照）。

## 9. 全量读写表面矩阵

### 9.1 模型工具

| 工具 | 读 | 写 | 目标域 | 迁移方式 |
|---|---|---|---|---|
| `skill_manage` | list/read/history/review | create/update/patch/delete/archive/restore/pin/unpin/write_file/remove_file/restructure | tree + state（pending/history） | tree 走 UnitKernel + manifest；pending 走 store commit |
| `memory` | recall/read/list | remember/forget/write | memory | memory 索引进 store；正文 blob |
| `skill_search` | search/catalog/domain view | — | discovery | query 只读 |
| `merge_stage` | cards/plan | stage/commit | merge | 子代理只 prepare；commit 在 host |
| maintenance probe | facts/scan | — | state/merge 摘要 | query |
| review child tools | proposal/read | 只读提案 | state | query |
| usage observation | — | 事件记录 | activity/log | append log |

### 9.2 host 命令

| 命令 | 读/写 | 域 | 迁移 |
|---|---|---|---|
| `pending` / `params` / `doctor` / `mutations` / `skill history` / `skills health` / `maintain status/report` / `replay` | R | state/merge/runs/reports | query |
| `approve` / `reject` / `release` | W | state + tree unit | command mutation |
| `migrate state` | W（一次性） | store head + legacy marker | 迁移命令单独 writer |
| `curator run/pause/resume/scope` | W | state | command mutation |
| `restore` / `skill restore/undo/pin/unpin` | W | tree + state | UnitKernel + commit |
| `learn` / `review` / `propose` | W | run/report/state | command mutation + tree |
| `skills refresh` | W | discovery | command |
| `maintain` / `maintain handoff/cancel` | W | runs/reports/state | command |
| `offload` / `condense` | W | tree/history | UnitKernel |
| `merge ...` 全部 | R/W | merge/runs/reports | merge command bus |
| learning-graph | W | activity/learning graph | append + snapshot |

`/evolution merge` 的完整命令面同样逐条登记，不允许“全部”这种模糊项：

```text
scan | pair <a> <b> [--force] | status [id] | report [id] | cancel [id]
runs | doctor | reconcile | pending [--expired] | candidates [--retry] [id]
approve <id> | reject <id> | resume [id] [--clear <reason>] [--retry]
skipped [--restore <id>] | discard <id> | undo <target> <run>
```

`/evolution` 的 host 命令面：

```text
merge, pending, approve, reject, release, doctor, curator, mutations,
migrate state, restore, skill restore/history/undo/pin/unpin,
propose, skills refresh/health, learn, review, maintain,
maintain status/report/handoff/cancel, offload, condense, replay
```


### 9.3 UI/按钮

| 界面/按钮 | 读 | 写 | 端口 |
|---|---|---|---|
| 设置 → 检索增强 Key | describe | set/unset | 平台 `remote.credentials`，不进 store |
| 设置 → 参数/行 | describe | save | 平台 settings，不进 family store |
| 合并建议页 | view/rows/body/history/runs | approve/reject/retry/undo/restore/discard/skipped/scan/pair | merge command bus |
| 审批页 | pending/preview | approve/reject/release | state command |
| 技能历史 | skills/versions/diff/body/health | undo/restore | tree + state |
| 技能健康 | rows | refresh | discovery/query + command |
| 诊断 | diagnostics | — | query |
| 设置导航 | openSettings | — | 平台 slot |

所有按钮通过 `command id`，不直接读 `.json`。

## 10. 平台侧改动

不需要改平台内核，也不需要新增跨进程共享读锁。

使用现有公开 seam：

- `@deepseek-ai/dsh-atomic-write` 的 `withFileLock`（由现有 `HomeFence` 持有，不为 store 另建锁文件）和 `writeFileAtomic`（object/head）；
- `ctx.fs`/`EvolutionIoLike` 的 read/create/rename；
- `ctx.settings` / `remote.credentials`：平台自己的域，不复制、不缓存 secret；
- `ctx.tools` / `ctx.commands`：只作为 transport，handler 调 store command bus；
- `ctx.fs` 的 target 锁只用于对象文件发布，不用于读者；reader 直接读完整对象；
- 不在平台侧新增 “snapshot service”；`Home MVCC Store` 是 family 内聚于 `evolution-core` 的机制，避免平台为单一插件扩大 API。

如果未来平台提供 `ctx.fs.watch`/版本化读取，可作为 store 的底层优化；当前设计不依赖它。

## 11. 插件侧改动清单

### `evolution-core`
- 新增 `store/store-kernel.ts`：head/commit/object 读写、writer lock、CRC/幂等、GC、legacy bootstrap；
- 新增 `store/domains.ts`：域 schema、版本、迁移函数；
- `EvolutionIoLike` 增加 `writeTextAtomic?` / `createTextIfAbsent` 使用约定（不改变后端接口，优先平台原子写）；
- 删除 `EvolutionState.withStateLock` 的读侧使用；state provider 保留为 legacy adapter；
- `SkillLibrary` 的 tree manifest 生成接入 store；
- `mutation-authority`/`home-fence` 只服务 writer/tree，不进入 query。

### `evolution-state` / domain
- 读 path 改为 `store.query('state')`；
- 删除读锁；domain provider 只作为迁移读 adapter；
- 一次 migration 生成第一个 commit；
- marker 绑定 commitId；回退 pin legacy provider，不删 head。

### `evolution-merge`
- merge state、runs、报告引用进 store；
- `MergeUnitTransactions` 的 fence 只用于 tree unit；metadata commit 在 unit 后；
- recovery 使用 commitId + unit journal；
- 所有 view 从 `store.query` 派生。

### `evolution-commands`
- run registry、report index、maintain 状态改 store 域；
- 所有 command 走 `commands.run` 统一入口；
- 删除 `ctx.get` authority 构造时快照（已做 use-time accessor，保留）。

### `evolution-usage` / `evolution-activity` / `evolution-feedback`
- usage/feedback：快照域；
- activity：append segment + 可选 commit 引用；
- 删除各自的 `withMergeTreeLock`/自定义 state 文件读写，统一到 kernel；
- 事件仍然 best-effort，不因 store 失败阻塞用户主路径（写日志 + fail loud on critical）。

### `evolution-skill-discovery`
- domain map/projection/snapshot 合并为一个 `discovery` 域；
- 读走 snapshot，写由 command 提交；
- 删除 manifest 的多个 fence。

### `evolution-curator` / `evolution-review` / `evolution-approval`
- 只通过 state/merge/store 读写；
- curator 的 `homeFence` 只用于 tree unit；
- review/approval 的 lease 仍是 run-level，不影响 reader。

### `evolution-host` / UI
- host routes 全改为 query/command；
- merge/settings/history/health 面板只消费 `{commitId, values}`；
- 设置 Key 走平台 credentials；
- 删除 UI 直接读文件的路径。

## 12. 迁移阶段

### Phase 0：内核与影子读
- 实现 store kernel + `verify-store-kernel`；
- 不替换读路径，只在测试/诊断中影子写 commit；
- 双读对比旧 state；差异 fail closed。

### Phase 1：state + runs
- 首个 commit 从现有 `state/store.json` bootstrap；
- read path 切到 store；
- 删除读锁；
- 旧文件保留只读；写路径切换；
- 回归：迁移/回退/双进程/崩溃。

### Phase 2：merge + reports
- merge state/run/report 引用迁入；
- unit journal 仍是恢复权威；
- 所有 merge 命令/工具/按钮切 query/command；
- 回归：merge scan/approve/undo/rebase/restart。

### Phase 3：usage/feedback/discovery/memory
- 侧车改为 store 域；
- memory 大正文 blob；
- 读路径统一；
- 删除各包私有 fence/serial。

### Phase 4：activity 日志
- 追加段格式、轮转、offset 读；
- UI/诊断读同一日志前缀；
- 保留 best-effort。

### Phase 5：tree manifest
- UnitKernel 提交生成 manifest；
- query 返回 tree，UI/模型读 manifest；
- 迁移期 materialized tree 兼容；
- 最终删除 legacy state/domain provider。

### Phase 6：删除过渡
- 删除 `withStateLock` 读侧、legacy store adapter、重复 reader；
- store-v2 成为唯一权威；
- 更新 10/11、77/78、84 和 80 台账。

## 13. 失败模型与不变量

1. **提交原子性**：head 未变 → 旧快照完整；head 已变 → 新快照完整。
2. **读者无锁**：query 不调用 `withFileLock`/`HomeFence`/`state.lock`。
3. **写者唯一**：同一 home 同一时刻只有一个 commit writer（跨进程 lock）。
4. **对象不可变**：object sha 一旦写入永不覆盖；冲突即错误。
5. **多域一致**：一个 commit 的 domain map 是完整版本；不存在“state 新、merge 旧”的混合指针。
6. **tree 先于 metadata**：tree unit 提交后才发布引用它的 metadata commit；失败可恢复。
7. **fail closed**：head/commit/object 损坏 → 报错，不返回空默认。
8. **secret 不落 store**：credentials/settings 只在平台域；store 快照不得包含 Key。
9. **迁移不双写**：迁移期 legacy 只读；新写只写 store；切换“已经发生”由 commitId 证明。
10. **唯一写锁**：只有 `HomeFence` 一个写者临界区；不存在第二个跨进程锁文件；commit 锁是它的逻辑名，不是磁盘文件。
11. **UI/tool/command 同源**：同一 command id 的读写实现只有一份。

## 14. 测试与门禁

### 单元/集成
- `store-kernel.spec`：writer crash at object/commit/head；corrupt head/object；GC；CAS；two-process writer；read during long write。
- `store-migration.spec`：legacy v1/domain/store -> commit；marker；rollback pin；fresh home。
- `store-tree.spec`：UnitKernel + tree manifest；crash between tree/commit。
- `store-surface.spec`：每个 command/tool/UI action 只调用 query/command，无 `readText/writeText`。
- `store-read-lock.spec`：长写期间 reader 在固定预算内完成且读到旧 commit。

### 静态门禁
- `verify-store-single-source`：禁止 `evolution-commands`/`evolution-merge`/`evolution-ui`/tool handlers 直接 `readText`/`writeText` 业务文件；只允许 kernel、migration adapter、平台 settings/credentials。
- `verify-store-read-lock`：query 实现不得出现 `withFileLock`/`state.lock`/`HomeFence`。
- `verify-store-head`：head/commit/object schema 与 sha 校验。
- `verify-store-surface`：command id 与 tool id、UI route 的映射闭包。
- 旧 gate `verify-state-store` 改为只检查 legacy migration；不再作为主读路径。

### 真机验收
- fresh profile：安装、诊断、合并建议、设置 Key 空/有/错误/清除、降级可见；
- 双进程：一个进程长写，另一个进程读旧 commit 不阻塞；
- 崩溃：kill -9 在 head 前后，重启恢复；
- HMR：替换 IO/authority，reader/writer 均继续工作；
- UI：按钮和工具对同一状态看到同一 commitId。

## 15. 被否方案

| 方案 | 为什么否 |
|---|---|
| 共享 read lock | 平台没有共享锁；自建 reader registry 要处理 stale reader、Windows 文件、迁移死锁；仍然是全局锁 |
| 每域 current 指针 | 多域读取需要拼指针；读者可能看到混合版本；GC/迁移复杂 |
| 只加 read timeout | 掩盖阻塞，不减少机制 |
| 每包继续自建 fence | 机制数量继续增长，无法统一 UI/工具/命令 |
| 把技能树也直接 JSON 化 | 技能是文件系统对象，会破坏外部可编辑/provider 语义；保留 UnitKernel |
| 平台新增 snapshot service | 平台不为单一家族扩大 API；family kernel 足以复用平台 atomic-write/fs |

## 16. 验收与落地顺序

1. 先做 `store-kernel` + 影子读 + 失败/崩溃测试；
2. Phase 1 完成后，D1-LOCK-READ 的独占读锁从 store 读路径移除；
3. 每迁移一个域，删除该域旧的 reader/writer，不留双写；
4. 全部表面迁移后，再删 legacy state provider 和旧 gate；
5. 只有第 1-4 步全绿、fresh web 与双进程验收通过，才进入下一版本发布。

本文是 DCR-85。实施前若发现平台 seam 不足，先补平台公开 seam 或调整本文；不得在插件里自建第二套跨进程锁。
