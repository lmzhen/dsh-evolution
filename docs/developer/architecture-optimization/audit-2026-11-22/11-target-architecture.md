# 目标架构：一个内核、一条写链、一个投影、一条证据链

对象：`D:\dsh\dsh-evolution-mirror` @ `564431ac`。
依据：[10-system-framework.md](10-system-framework.md)、[README.md](README.md) 与 8 份分报告。
约束：插件侧重写；平台侧只消费公开 service/事件，不 fork 平台。允许删除/合并包、破坏旧内部 API、重写核心路径；不保留“先双写再迁移”的长期兼容层。

> DCR-85 修订（2026-11）：4.1 HomeFS 仍是 Phase B 的最终文件边界；过渡期 store-v2 直接消费 `ctx.evolutionIo`（单文件原子写）而不等待 HomeFS。4.4 StateStore 的具体读写语义改为 **Home MVCC Store**：写入串行提交不可变 `head/commit/objects`，读者无锁；`StateStore.transact` 仍保留为写入口，但不再以读锁作为一致性手段。详见 [85-versioned-snapshot-read.md](85-versioned-snapshot-read.md)。

## 1. 目标

把当前“23 个包 + 5 层锁 + 2 套 CAS + 3 套路由/状态机”的家族，收敛为：

```text
一个 HomeFS 边界
  + 一个 UnitKernel（prepare/commit/settle）
  + 一个 PlanService（tool/approval/system 共用）
  + 一个 StateStore（唯一事实源）
  + 一个 ProjectionSchema（host/UI 同源）
  + 一条 Assurance（测试/门禁/发布证据）
```

这不是把现有模块重新命名，而是把**平台已经做对的东西交给平台，把平台没有的“技能语义 + 多文件事务 + 审批 + 生命周期”收敛成插件内核**。

## 2. 第一性决策

### 2.1 什么应该由平台拥有

平台 `fs` 已经拥有：

- target identity：`resolve()` 返回不透明 `FsTarget`，后端用 realpath / nearest-existing-ancestor；
- per-target in-process lock + read→guard→write 临界区；
- `FsWriteIntent{createIfAbsent|replaceIfVersion}`；
- `createIfAbsent` 的 hardlink no-replace 发布；
- `editText`/`patchText` 的版本检查与字面匹配同临界区；
- `fs/write-intent`、`fs/edit-intent`、`fs/delete-intent`、`fs/observed` 策略槽；
- `fs-local` 的 tmp + fsync + rename、Windows transient rename retry；
- `atomic-write` 的 lock takeover claim。

这些不应在插件里再实现一遍。当前 `WriteKernel`、`createTextIfAbsent`、`SkillTargetLocks`、`SkillObservationStore`、`SkillRootGate` 的相当一部分是在重造平台。

### 2.2 什么必须由插件拥有

平台没有“技能/合并/审批/生命周期”的领域语义：

- 技能 frontmatter、名称/路径/体积/内容威胁校验；
- 技能目录结构（SKILL.md + support files + history + archive）；
- 多文件 unit：merge、extract、restructure、undo 的 prepare/commit/rollback/recovery；
- 审批 plan 的持久化、replay、幂等；
- 跨进程的 unit lease/claim；
- 技能历史与审计；
- merge/review/curator 状态机；
- UI 投影与 i18n。

插件应只拥有这些，并且只通过 `HomeFS` 与 `UnitKernel` 落盘。

### 2.3 平台只能“使用”，不能被“复制”

- 平台 `fs-local` 的锁/版本/原子写是唯一文件系统实现；插件侧的 `HomeFS` 是**适配器**，不是第二套实现。
- 平台 `fs-observation-policy` 是唯一“读后写”授权来源；插件不自建 `SkillObservationStore` 作为第二事实源。
- 平台 `ui-settings` 的 `ConfigFormSnapshot` 是 UI 表单唯一形状；插件不自造 `stale/reason/readback`。
- 平台 `credentials` 是唯一秘密来源；插件用 `resolve/describe/set` 消费固定 refs，不自建 secret 存储，不把秘密写入 cfg、report、日志或客户端快照（检索增强见 84）。
- 平台 `rpc-host` 的 route 注册是唯一 HTTP 入口；插件不从 `body` 字符串推 `decision`。
- 平台 `llm` 的 finish 终态是唯一取消信号；插件不把 `aborted` 当成功。

## 3. 目标包结构

保留“平台契约/引擎冻结/组合”三类，其余按机制合并：

```text
packages/
  evolution-platform/     # adapter + 由平台类型派生的 ports；不再手工镜像 19 个 contract 文件
  evolution-kernel/       # HomeFS、UnitKernel、StateStore、EffectLedger、Recovery
  evolution-skills/       # 技能读模型、校验、plan、history、archive
  evolution-approval/     # 跨域审批：plan 存储、replay、decision audit
  evolution-merge/        # merge domain + engine bridge + undo
  evolution-lifecycle/    # curator + review + maintenance + activity
  evolution-memory/       # memory
  evolution-web/          # host routes + client-kit + UI；host/client 分区
  evolution-composition/  # host/all/agent 组合行
  evolution-merge-engine/ # vendored 引擎，实质冻结；仅声明式凭据传输补丁
```

删除/吸收：

- `evolution-state` → `evolution-kernel/state`；
- `evolution-adapter` / `evolution-platform-contract` → `evolution-platform`（contract 由生成器输出 `ports.generated.ts`，不再两份手工文件）；
- `evolution-skill-discovery` / `evolution-skill-health` → `evolution-skills`/`evolution-web` 的子路径；
- `evolution-client-kit` → `evolution-web/client-kit`；
- `evolution-ui` 拆为 `evolution-web/host` + `evolution-web/client`，不再一个包同时挂两半；
- `evolution-preset`、`evolution-host`、`evolution-all` → `evolution-composition` 的 bundle 行；`evolution-preset` 不再保留活包；
- `evolution-agent` 的 `agent.cordis.yml`/`bases.json` 作为 legacy fixture 删除，不随包发布。

包数从 23 降到约 10，但这不是目标本身；目标是**每个包只有一种变化原因**。

## 4. 目标内核接口

以下为设计契约，不是最终文件布局。

### 4.1 HomeFS：唯一文件边界

```ts
interface HomeFs {
  resolve(path: string): Promise<FsTarget>              // 平台 FsTarget
  stat(target: FsTarget): Promise<FsInfo | undefined>
  readText(target: FsTarget): Promise<string>
  readBytes(target: FsTarget, max: number): Promise<Uint8Array>
  listDir(target: FsTarget): Promise<FsDirEntry[]>
  writeText(target, content, intent?: FsWriteIntent): Promise<FsWriteOutcome>
  editText(target, edit, expected?: {version: FsVersion}): Promise<FsEditOutcome>
  patchText(target, hunks, expected?): Promise<FsEditOutcome>
  deleteFile(target, expected?): Promise<FsDeleteOutcome>
  transact<T>(path: string, fn: (current: string|null) => Promise<string|null>): Promise<T>
}
```

实现策略（二选一，按平台公开能力落地）：

1. **首选**：复用 `@deepseek-ai/dsh-fs-local` 的 `LocalFileSystem`，用 child fiber 把它绑定到 `DSH_HOME` 作为 host FS；插件只依赖 `@deepseek-ai/dsh-fs` 的类型。
2. **兜底**：若平台不提供可嵌入的 host provider，新增唯一 `home-fs.ts`，逐条实现同一 `FileSystem` 契约（realpath、per-target tail lock、tmp+fsync+rename、hardlink createIfAbsent、retry、`FsError` 码）。禁止在其它文件再写任何 `writeFile/rename/link/open`。

关键：`HomeFs` 是**唯一**直接接触 `node:fs` 的插件模块。审计数据中的 `EvolutionIoLike`、`io-node`、`io-registry`、`write-kernel`、`createTextIfAbsent`、`atomicWriteFiles` 全部收敛/删除。

### 4.2 UnitKernel：唯一多文件事务

```ts
interface UnitPlan {
  unitId: string
  origin: 'foreground' | 'background_review' | 'system'
  ops: FsWriteOp[]       // target + expectedVersion/absent + final bytes
  audit: AuditItem[]
}

interface UnitKernel {
  plan(input: SkillIntent): Promise<UnitPlan>       // 纯函数 + 只读预检，不写盘
  prepare(plan: UnitPlan): Promise<PreparedUnit>    // 锁内读全部 target，验证 CAS，零副作用
  commit(prepared: PreparedUnit): Promise<UnitResult>
  recover(unitId: string): Promise<RecoveryResult>
  undo(unitId: string): Promise<UndoResult>
}
```

- `prepare` 内**只读**：`readText`/`stat`；所有 `expected` 必须匹配；不写 audit/event。
- `commit` 是唯一写点：按 target 字典序调用 `HomeFs.writeText/editText/patchText/deleteFile`；`FsWriteIntent` 显式传入；写成功后写 journal、snapshot、audit、event。
- 多文件不是平台保证的原子事务：插件以 **unit lease**（见 4.3）+ 每文件 CAS + journal + 补偿实现“插件写者之间的原子性”。外部平台 fs 写者在两次文件之间可插入；CAS 会让后续 op 失败并触发补偿，不承诺对外部写者的隔离。
- `recover` 统一：`finalize → rollForward → rollback` 有序尝试；每次返回结构化状态，不能静默丢弃。
- `undo` 与 `recover` 共用 `settle`，不再有 merge 专用 recovery 分支表。

### 4.3 一个 LockManager

```ts
interface Lease { release(): Promise<void> }
interface LockManager {
  acquire(scope: TargetScope | TreeScope): Promise<Lease>
}
```

- 所有插件写（单文件/多文件/结构操作）先取 `LockManager` lease；
- key 由 `HomeFs.resolve` 得到的 `targetKey` 派生，排序去重；
- 进程内 tail + 跨进程平台 `withFileLock` 在一个实现里；
- 删除 `SkillTargetLocks`、`SkillRootGate`、`TargetLockSet`、`HomeAuthority` 四套并存；
- 单文件的 `HomeFs` 内部锁保留（平台 provider 的 per-target 临界区），插件 lease 负责“unit 级互斥”；两层职责明确，不是重复实现。

### 4.4 StateStore：唯一事实源

- 所有持久状态（pending、review、curator、activity、usage、events）通过一个 `StateStore`：
  - 小状态：平台 `storage-json`（或等价）文件 + `transact`；
  - 需要跨进程一致的状态：`StateStore.transact(key, fn)` 内部用同一 file lock；
- 删除 `evolution-state` 的进程内存 domain 作为 authority；内存只能做派生 projection，不能决定 claim/resolve；
- 状态 schema 只有一个版本入口；迁移走显式 `migrate`，禁止“读旧格式时顺手兼容”散落。
- 所有 StateStore 的读写都要声明 `processScope`，doctor 在双宿主场景显示真实能力。

### 4.5 PlanService：tool/approval/system 共用

```ts
type SkillOp =
  | CreateSkill
  | WriteBody | PatchBody | PatchSection
  | WriteSupport | PatchSupport | RemoveSupport
  | DeleteSkill | Restructure | Extract
type SkillPlan = { origin; summary; ops: SkillOp[]; targets... }
```

- tool 只做参数解析 + `plan`；不直接调 `SkillLibrary` mutator；
- approval 存 `SkillPlan`（含 `FsTarget` 的 displayPath、`FsVersion` token、expected state），replay 只 `UnitKernel.commit(prepare(plan))`；
- system writer（curator/merge/undo/learning）用同一 plan 类型，显式 snapshot→intent，不伪造 session observation；
- 不再有 `staged_from_sha256`、`planFromStaged`、per-action anchor 拼装；旧 pending 无 plan 明确拒绝。

### 4.6 EffektLedger：审计/事件只在 commit 后

- `create/update/patch/write_file/remove_file` 的 audit、history、event 全部由 `UnitKernel.commit` 的 `onCommitted` 触发；
- `createCore` 不再直接 `audit/notify`；
- `prepare` 期间不允许任何 `recordMutation`、`appendEvolutionEvent`、`writeFile`、`mkdir`、marker 写入；
- 所有 `summary` 进入 plan，进入 history；不再要求模型填一个会被丢弃的字段。

### 4.7 ProjectionSchema：host/UI 单源

- host route 返回类型 → generator → client wire 类型/路由表；`HOST_ROUTES` 是唯一路径源；
- `configForms` 只声明平台真实有的 `getSnapshot/subscribe/mutate/set/unset` 与 6 个快照字段；UI 每次渲染从 seat 取 `value`，并用 `useSyncExternalStore` 订阅；
- `workspaceId` 从 `sessions.list` + `workspaces.list` 派生，不读不存在的 `workspaceId`；
- `Panel` 按 active view 启停轮询；失败态与 stale 是显式 UI 状态。

### 4.8 Assurance：一条证据链

```text
test case → lane membership → artifact hash → measured commit
         → gate report → release evidence → published bytes
```

- 每个 gate 必须有可执行 falsifier；
- local gate 的 overlay 必须校验平台/镜像版本；
- release evidence 复算 dist sha256，spike 与 measured commit/traceability 同源；
- 永久 skip 从 lane 成员移除；
- 登记表有版本 expiry，过期即红。

## 5. 关键流程

### 5.1 工具写入

```text
tool-skill-manage
  -> validate args + domain rules
  -> PlanService.plan(exec.owner)          // 观察只来自平台 fs/observed 或本次 read
  -> approval? stage(plan) : UnitKernel.commit(prepare(plan))
  -> render(result)                        // names/summary/errors 进 content，不只 value
```

- 观察：`fs.readText` / `fs.stat` 成功后由平台 policy 记录；写时 `ctx.waterfall('fs/write-intent', target, exec)` 取 create/replace intent；
- 不再有 `SkillObservationStore`、`skillHostIdentity`、`session/event` 自建读桥；
- `READ_BEFORE_WRITE` 由平台 `FS_NOT_OBSERVED` 承担；插件只保留业务级 gate（保护技能、体积、内容威胁、cross-source）。

### 5.2 approval

```text
stage: plan = PlanService.plan(...); state.savePending({ plan, ... })
approve: prepared = UnitKernel.prepare(plan); UnitKernel.commit(prepared)
```

- replay 以 `FsVersion`/expected 为唯一判据；任一 op stale → 整个 unit 不写；
- GET pending 不产生写副作用；
- decision 路由进 HOST_ROUTES 并落 `DecisionAudit`。

### 5.3 内部 system writer

```text
curator/merge/undo -> snapshot current FsTarget/version
                   -> explicit intent (replaceIfVersion/createIfAbsent)
                   -> UnitKernel plan/commit
```

- 不伪造 session observation；
- system writer 与 tool 共用 UnitKernel，不共用 owner 语义。

### 5.4 merge / multi-file

```text
plan = build merge plan (sources, target, support)
prepared = UnitKernel.prepare(plan)   // all targets read+verified under unit lease
commit prepared:
  write target via HomeFs.writeText(replaceIfVersion)
  archive sources via HomeFs.write/move/delete
  journal phases
on failure: compensate in reverse; recovery settle
```

- staging 目录以 `runId+generation` 为 key；每次新 run 不复用上一代 `merged/`；
- `closeRow()` 统一清 stage、写 receipt、settle journal；
- `recover` 与 `undo` 同一套 `settle`。

### 5.5 UI

```text
host route returns typed snapshot + revision + failure/stale
  -> generated client schema
  -> UI store subscribes; hidden = stop; error = visible
```

- 不猜 `workspaceId`，不手拼 `decision` 路由，不伪造 configForms 字段。
- 凭据编辑只走平台 `remote.credentials` + `SettingsSecretField`；凭据值不回显，不进入 config 快照（检索增强见 84）。

## 6. 旧组件去留表

| 旧组件 | 处理 | 理由 |
|---|---|---|
| `EvolutionIoLike`/`io-node` | 删除，收敛 HomeFS | 第二 IO 栈 |
| `WriteKernel` | 删除，逻辑并入 UnitKernel | 两套 CAS |
| `MutationUnit` | 重写为 UnitKernel | 当前 journal/compensation 只服务部分路径 |
| `SkillTargetLocks`/`SkillRootGate` | 删除，并入 LockManager | 锁层五合一 |
| `HomeAuthority`/`TargetLockSet` | 删除/并入 LockManager | 跨进程锁统一 |
| `SkillObservationStore`/`skillHostIdentity` | 删除，用平台 policy | 观察双源 |
| `SkillLibrary` 4k 行 | 拆为 catalog/validation/plan/history 纯模块 | 上帝类 |
| `skill-store` direct mutators | 删除公共写 API | 单一写权威 |
| `planFromStaged`/`staged_from_sha256` | 删除 | 审批 plan 不完整 |
| `evolution-state` domain-cache provider | 删除/改 StateStore | 跨进程陈旧 |
| `evolution-platform-contract` + adapter 手工镜像 | 合并并生成 ports | 契约双源 |
| `evolution-preset` 活包 | 删除/移入 composition fixtures | 退役包仍活 |
| `HOST_ROUTES.body.replace(...)` | 删除 | 路由单源 |
| `configForms` 假字段 | 删除 | 不手抄平台 |
| `release-evidence` 旧 spike | 删除旧数据，重测绑定 | 证据链 |
| `_recovery-coordinator` 分支表 | 删除，改 `settle` | 恢复单源 |
| merge 两套状态机 | 合并为 `recordRound2Outcome` | 状态机重复 |
| UI host/client 混装 | 拆 `evolution-web/host` + `client` | 边界清晰 |

## 7. 迁移路线（大重写但可回退）

### Phase A：冻结旧写链

- 冻结 `SkillLibrary`/`MutationUnit` 写 API；只允许新 UnitKernel 进入。
- 加“旧路径零新增调用” arch guard。
- 先补 P0-1、B5、D1 的相关测试，不修实现。

### Phase B：HomeFS + 单文件写

- 引入 `HomeFS`（优先平台 fs-local，否则唯一 adapter）。
- tool 单文件 write/patch/write_file/remove_file 切到 HomeFS；保留旧路径 feature flag 仅用于对照测试，不双写。
- 验收：并发 create 只一个；8.3/别名 identity；aborted LLM；failed read→FS_NOT_OBSERVED。

### Phase C：UnitKernel + 多文件

- 将 merge/undo/extract/restructure 移到 UnitKernel。
- `prepare` 零副作用；`commit` 唯一写；`settle` 统一 recovery。
- 删除旧 MutationUnit/journal 分支；保留旧 journal 的只读迁移器。
- 验收：崩溃注入八点、staging 代际、rollback 全部 target。

### Phase D：StateStore + approval

- pending/review/curator/activity 全部走 StateStore；删除 domain 缓存写 authority。
- approval 存完整 SkillPlan；所有动作 plan 化；旧 pending 拒绝重发。
- 验收：双宿主 claim 不双执行；restore 不吞 pause；review 失败回滚 debt。

### Phase E：平台接缝与 UI

- `evolution-platform` 生成 ports；`internal/config` 4.1；LLM finish 分类；configForms/workspace 真形状。
- host route/payload/client 类型生成；UI active view/error/subscription。
- 验收：平台契约 strict 全绿；无手拼路由/假字段；P0-1 UI 行为与显示一致。

### Phase F：删旧与拆包

- 删 `evolution-state`、旧 core 写文件、退役 preset；拆 `evolution-web`。
- 更新 docs/README/INSTALL/RELASE evidence；运行全量门禁和真机验收。
- 不再保留“旧兼容层”。

## 8. 边界与不承诺

- **不修改平台源码**。若 `fs-local` 不能作为 host provider 嵌入，HomeFS 仍按 `FileSystem` 契约实现，但只有这一处实现；不以 fork 平台为代价。
- **多文件 unit 不承诺对外部平台 fs 写者的隔离**：平台 fs 没有 multi-file transaction；插件承诺插件写者互斥 + 每文件 CAS + 崩溃恢复。此边界必须写进 plan/README，不能宣称“全库原子”。
- **不重写 merge-engine vendored 引擎**；只改桥接与事务。
- **不为了少包而合并边界**：包数目标约 10，但以“一种变化原因”为准；若合并导致跨域反向依赖，保持拆包。
- **不保留长期双写/旧 API 适配**；迁移期只保留 feature flag 与只读旧 journal 迁移器，一个版本内删除。

## 9. 验收判据

目标架构完成不以“测试全绿”单独判定，还要满足：

1. 全仓只有一处 `node:fs` 直接写文件（HomeFS）；arch guard 可机械检查。
2. 只有一处多文件事务入口（UnitKernel）；所有 mutator 只能产出 plan。
3. 只有一处 observation 授权（平台 `fs/observed`）；没有第二套 contentHash observation。
4. 只有一处 route 声明（HOST_ROUTES）；客户端无 `.replace`/手写路径。
5. 只有一处 configForms 快照形状；无平台不存在的字段。
6. `run-gates local` 的记录全部绑定当前镜像/显式 overlay 版本。
7. release evidence 的每个 spike 都复算 artifact hash 并绑定同一 measured commit。
8. 崩溃测试覆盖 prepare/commit/rollback/undo 的每个相位；失败结果可查询。
9. 平台契约 strict 无 `--accept-recorded` 差异。
10. 包依赖图无环，`evolution-skills`/`evolution-kernel` 不反向依赖 `evolution-web`/merge。

## 10. 与审计问题的闭环

| 审计根因 | 目标机制 |
|---|---|
| P0-1 失败读绕过门禁 | 平台 `fs/observed` + 真实 `message.isError`；插件不再自建 observation |
| A1 prepare 副作用 | UnitKernel prepare 纯只读；audit 只在 commit |
| A2 跨进程状态/ sidecar | StateStore + file transaction；domain 只做 projection |
| A3-A5 恢复/补偿 | UnitKernel settle；失败全部收集；repair 用平台 claim |
| B1 审批无 plan | PlanService 全动作 plan；replay 只 commit prepared |
| B5 internal/config | 平台 4.1 首参 fiber；端口由类型派生 |
| C1-C3 merge | UnitKernel + 代际 stage + pid-aware owner |
| D1 LLM aborted | 平台 finish 终态映射 |
| D2 契约漂移 | 生成 ports + strict upstream |
| E1-E7 验证失真 | 产物/树/commit 绑定的 Assurance |
| F1-F4 投影 | 单一 ProjectionSchema + 订阅/失败态 |
| 结构熵增 | 包按变化原因收敛；内核唯一；删死面 |

一句话：**把“文件编辑器的正确性”交给平台，把“技能变更的语义和事务”收敛成插件内核，把“我们相信它”建立在同一棵树上。**
