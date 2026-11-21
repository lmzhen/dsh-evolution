# Skill 写入并发与防双写：综合优化方案

> 状态：**设计提案（未实施）**
> 范围：`skill_manage` 的 create / update / write_file / patch / remove_file，以及所有直接调用 `SkillLibrary` 的写路径（AUX、curator、merge、learning graph、extract）。
> 目标：后台多 session/agent 并发修改或创建 skill 时，结果可解释、无静默丢更新、无静默语义合并；长期只保留一个写入权威层。
> 后续目标方案：[skill-write-single-provider.md](skill-write-single-provider.md)（plan/intent、单 target 锁、审批 plan 与 Phase H 分步落地）。

## 1. 结论

采用平台已经验证的 **“按 session 观察 + per-target 锁 + 锁内版本 CAS + 显式 stale”** 语义，但把它落到 skill 领域，而不是照搬文件工具。

最终形态：

```text
tool-skill-manage
  └─ SkillWriteService（唯一写入权威）
       ├─ SkillObservationStore（按 owner 记录读过的版本）
       ├─ SkillIntent（createIfAbsent / replaceIfVersion / editIfVersion）
       ├─ per-target lock + 多 target 排序锁
       ├─ WriteKernel / transactIo（跨进程锁、CAS、补偿）
       └─ UnitTransaction（多文件 unit）
```

一句话：

> **后台 skill 写入不使用“锁内静默合并”；不同区域并发也会显式 stale，模型重读后重试。**

## 2. 上游权威实现解剖

上游不是“edit 工具自己防双写”，而是四层正交机制。

### 2.1 观察：按 agent.session 记录

`packages/fs/fs-observation-policy/src/index.ts`：

```ts
private observed = new WeakMap<object, Map<string, FsObservation>>()

private owner(actor: object | undefined): object | undefined {
  return actor?.agent?.session
}
```

- owner 是精确的 session；
- 读文件成功记录 `{ kind: 'present', version }`；
- 不存在记录 `{ kind: 'absent' }`；
- session A 的读不授权 session B。

### 2.2 意图：观察转成写入许可

同一个文件：

```ts
writeIntent(target, actor) {
  const prior = ...
  return prior?.kind === 'present'
    ? { kind: 'replaceIfVersion', version: prior.version }
    : { kind: 'createIfAbsent' }
}

editIntent(target, actor) {
  // 未观察 → FS_NOT_OBSERVED
  // 确认 absent → FS_NOT_FOUND
  // 观察 present → { version }
}
```

关键点：

- `edit` 必须读过；
- `write` 对已存在文件必须带版本，未观察则只能 createIfAbsent；
- 不是靠 `old_string` 代替版本。

### 2.3 执行：锁内版本比较

`packages/fs/fs-local/src/index.ts`：

```ts
// Per-targetKey tail promise: serializes mutating ops so the read→guard→write
// window can't interleave, making concurrent writes/edits deterministically
// ordered (one wins, the rest see the new version and reject as stale).
private locks = new Map<string, Promise<unknown>>()
```

`editText` 在锁内：

```ts
const existing = await this.requireFile(target, expected, 'edit')
if (expected && existing.version !== expected.version) {
  throw new FsError('file changed since it was read', 'FS_STALE_VERSION')
}
```

顺序严格是：

```text
锁
  → requireFile(expected)
  → 版本比较
  → 读当前内容
  → old_string 匹配
  → 原子写
```

因此：

- A 改第 10 行，B 改第 50 行，只要 B 读得早，B 也会 stale；
- 平台不做区域重叠判断，不做自动 rebase；
- 第二个写入者必须重读。

### 2.4 工具层：唯一匹配 / 显式错误

`packages/fs/tool-fs/src/edit.ts`：

- `old_string === new_string` 直接拒绝；
- 默认唯一匹配，多个匹配报 `FS_AMBIGUOUS_EDIT`；
- `replace_all` 显式开启才全替。

`str_replace_editor` 同样：

- `fs/edit-intent` 拿版本；
- 读当前内容、匹配 `old_str`；
- 写回用 `replaceIfVersion(intent.version)`。

### 2.5 平台机制的本质

| 层 | 职责 | 不做什么 |
|---|---|---|
| observation policy | 按 session 记版本 | 不做锁、不做写 |
| intent | 把观察变成写入许可 | 不做文本匹配 |
| fs provider | per-target 锁 + CAS + 原子写 | 不做业务语义 |
| tool | 参数、匹配、错误呈现 | 不自己维护全局锁 |

这个分层是本次重构的权威参照。

## 3. 我们当前实现与全量问题

### 3.1 当前分层

```text
tool-skill-manage/src/index.ts
  - 参数解析
  - approval / staged_from_sha256
  - 直接调用 newSkillLibrary / SkillLibrary

evolution-core/src/write-authority.ts
  - origin / protectedNames / readNames / confirm

evolution-core/src/write-gates.ts
  - read gate、protected、threat scan、open-target 等

evolution-core/src/skill-store.ts
  - per-root serial queue
  - transactIo per-directory lock
  - staged anchor / content hash
  - history / CAS residuals

evolution-core/src/write-kernel.ts
  - expected/next CAS
  - multi-target compensation
  - transact

evolution-core/src/tree-write.ts / UnitTransaction
  - 多文件单元
```

### 3.2 问题台账

#### P-1 `patch` 没有版本前置条件

`skill_manage patch` 在 skill 锁内：

```text
读当前文件
→ old_string 匹配
→ 写回
```

没有“规划 patch 时的文件版本”检查。

后果：

- 两个 session 改不同区域，第二个可以静默成功；
- 两个 session 改同一区域，只有在 old_string 不匹配时才失败；
- 部分语义冲突被“写成功”掩盖；
- fuzzy / replace_all 会放大风险。

#### P-2 整文件写只有审批路径自动带 anchor

`staged_from_sha256` 在 approval 路径生成：

```ts
const stagedAnchor = args.staged_from_sha256
  ? args.staged_from_sha256 === 'absent'
    ? { absent: true }
    : { sha256: args.staged_from_sha256 }
  : undefined
```

无 approval 的直接 `update/write_file`：

- 有 read gate；
- 有 per-root 锁；
- 但没有自动文件版本 guard。

导致“审批后写”和“直接写”的并发语义不同。

#### P-3 读观察只有名字，没有版本

`readNames` / `sessionReadSkillNames` 记录的是：

```text
这个 session 读过 skill A
```

不是：

```text
读 skill A 时 SKILL.md / support file 的版本
```

因此无法实现平台式 `replaceIfVersion`。

#### P-4 锁粒度是 per-root

`SkillLibrary` 使用 per-root serial queue：

```text
同一 skill 根下所有写入串行
```

平台是 per-target：

```text
同一文件串行，不同文件可并行
```

我们的粒度更粗：

- 不同 skill 也会互相排队；
- 吞吐低；
- 但并不能替代同一文件的版本 CAS，因为跨进程/跨 owner 仍可能交错。

#### P-5 职责分散、语义不一致

一次 skill 写可能经过：

- tool 层手工 anchor；
- write-gates read gate；
- write-authority origin/confirm；
- SkillLibrary serial + transact；
- WriteKernel CAS；
- UnitTransaction 多文件补偿。

每层都有一部分并发/授权语义，但没有一层能回答：

```text
这个 owner 在什么版本上观察了这个 target？
这次写入的 expected 是什么？
stale 时应该返回什么、由谁重读？
```

#### P-6 `update` 覆盖整文件时无法保留不同区域

这是语义事实，不是 bug：

- 整文件 update 必须 anchor；
- 第二个写入者 stale；
- 不会自动 merge。

但 `patch` 的锁内合并又和它不一致，用户/模型难以形成统一心智模型。

#### P-7 AUX 后台任务的 owner 不明确

AUX review 使用 child session / review task：

- parent 读过的 skill 不应自动授权 child 写；
- child 必须自己 read；
- review task 结束后观察状态应释放。

当前 read gate 以什么 session 为 owner 需要在重构中固定。

#### P-8 多文件 unit 与单文件 CAS 的边界不清

一个 skill 修改可能涉及：

- SKILL.md
- support files
- 引用改写
- history/ledger

单文件 CAS 无法表达：

```text
这一组文件必须基于同一个观察版本一起提交
```

需要在 unit 层做多 target CAS，而不是逐文件各自 merge。

## 4. 设计决策

### D-1 后台 skill 写入采用乐观 CAS，不做锁内静默合并

理由：

- 后台无人值守；
- 静默合并比多一次重读更危险；
- 显式 stale 可以进入模型重读/重试，也符合现有 partial/unresolved 语义；
- 不做自动 rebase 是既有冻结决策。

### D-2 观察 owner 是执行身份

```text
前台 session → session id
AUX review → review task/session id
curator/merge → 各自 run 的执行身份
```

不同 owner 不共享读观察。

### D-3 版本是内容版本，不是 mtime

```ts
type SkillVersion = string // canonical content sha256
```

理由：

- 内容不变但 mtime 变不应 stale；
- skill 是文本单元，内容 hash 更贴近语义；
- 现有 staged_from_sha256 已经是内容 hash，统一即可。

### D-4 锁按 target，不按 root

- 单文件写：per-target promise lock；
- 多文件 unit：按 targetKey 排序后一次性获取；
- 跨进程：保留 `transactIo` per-directory lock；
- 最终防线：HomeFence。

### D-5 `patch` 也必须带文件版本

顺序：

```text
锁
  → requireObservation(owner, target)
  → 版本比较
  → 读当前内容
  → old_string 唯一匹配（或显式 replace_all）
  → 写回
```

不同区域并发也一样 stale。

### D-6 `update/write_file/remove_file` 统一 `replaceIfVersion`

- 无观察 → `SKILL_NOT_OBSERVED`
- 观察 absent → `SKILL_NOT_FOUND`
- 观察 present → 版本 CAS

### D-7 `create` 使用 `createIfAbsent`

- 不允许用 create 覆盖已存在；
- 与平台 write 的未观察语义一致；
- 并发 create 只有一个赢家，另一个 `SKILL_ALREADY_EXISTS`。

### D-8 审批携带 target 版本

审批暂存记录：

```ts
targets: { targetKey, expected: SkillVersion | 'absent' }[]
```

批准后执行时再次 CAS：

- 任一 target stale → 审批失效；
- 不自动 rebase、不自动重放旧 patch；
- 返回明确 stale，让 review 重新规划。

### D-9 只保留一个写入权威层

所有写路径只走 `SkillWriteService`：

- tool-skill-manage
- curator
- merge
- learning graph
- extract
- AUX review
- 任何直接 `newSkillLibrary` 的写路径

`SkillLibrary` 退化为存储/事务实现；`WriteKernel` 作为底层 CAS 原语；`WriteAuthority` 只保留授权，不再承担观察/并发。

## 5. 目标架构

### 5.1 类型

```ts
interface SkillTarget {
  readonly skillName: string
  readonly relPath: string       // '' for SKILL.md, otherwise support file
  readonly targetKey: string     // canonical stable key
}

type SkillObservation =
  | { readonly kind: 'present'; readonly version: SkillVersion }
  | { readonly kind: 'absent' }

type SkillVersion = string       // sha256(canonical bytes)

type SkillWriteIntent =
  | { readonly kind: 'createIfAbsent' }
  | { readonly kind: 'replaceIfVersion'; readonly version: SkillVersion }
  | { readonly kind: 'editIfVersion'; readonly version: SkillVersion }

interface SkillWriteError {
  code:
    | 'SKILL_NOT_OBSERVED'
    | 'SKILL_STALE_VERSION'
    | 'SKILL_NOT_FOUND'
    | 'SKILL_ALREADY_EXISTS'
    | 'SKILL_AMBIGUOUS_EDIT'
    | 'SKILL_RESOURCE_BUSY'
  target?: SkillTarget
  displayPath?: string
  message: string
}
```

### 5.2 服务接口

```ts
interface SkillWriteService {
  // 读并记录观察；read 的成功是写的许可来源
  read(target: SkillTarget, signal?: AbortSignal): Promise<string>

  // 观察只由 read 产生；list/stat 不自动授权写
  observe(target: SkillTarget, observation: SkillObservation, owner: SkillOwner): void

  create(target: SkillTarget, content: string, owner: SkillOwner, signal?: AbortSignal): Promise<SkillWriteOutcome>

  update(target: SkillTarget, content: string, owner: SkillOwner, signal?: AbortSignal): Promise<SkillWriteOutcome>

  patch(
    target: SkillTarget,
    oldString: string,
    newString: string,
    owner: SkillOwner,
    options?: { replaceAll?: boolean; signal?: AbortSignal },
  ): Promise<SkillWriteOutcome>

  remove(target: SkillTarget, owner: SkillOwner, signal?: AbortSignal): Promise<SkillWriteOutcome>

  // 多文件 unit：所有 target 必须基于同一观察快照
  writeUnit(
    unit: SkillWriteUnit,
    owner: SkillOwner,
    signal?: AbortSignal,
  ): Promise<SkillWriteOutcome>
}
```

`SkillWriteUnit`：

```ts
interface SkillWriteUnit {
  readonly skillName: string
  readonly targets: readonly {
    readonly target: SkillTarget
    readonly expected: SkillVersion | 'absent'
    readonly next: string | null
  }[]
}
```

### 5.3 分层职责

```text
tool-skill-manage
  - parse args
  - approval confirm
  - present result
  - 不持有锁、不计算 anchor、不判断 stale

SkillWriteService
  - owner observation
  - intent
  - target locks
  - CAS
  - errors
  - unit transaction ordering

SkillLibrary / WriteKernel
  - bytes read/write
  - transactIo
  - history/ledger
  - compensation
```

### 5.4 写流程

#### read

```text
resolve target
  → read canonical bytes under no write lock
  → hash
  → observationStore.record(owner, targetKey, present/version)
  → return content
```

注意：

- `list`、`stat`、目录扫描不自动记录文件版本；
- 只记录真正读到内容的 target；
- support file 必须显式 read 才可写。

#### create

```text
intent = createIfAbsent
lock(targetKey)
  → current = read(target)
  → current !== null → SKILL_ALREADY_EXISTS
  → write
  → record observation present
```

#### update / write_file

```text
observation = requirePresent(owner, target)
  → none → SKILL_NOT_OBSERVED
  → absent → SKILL_NOT_FOUND
lock(targetKey)
  → current = read(target)
  → hash(current) !== observation.version → SKILL_STALE_VERSION
  → write
  → record new observation
```

#### patch

```text
observation = requirePresent(owner, target)
lock(targetKey)
  → current = read(target)
  → hash(current) !== observation.version → SKILL_STALE_VERSION
  → match oldString (unique or explicit replaceAll)
  → no match → SKILL_EDIT_NOT_FOUND
  → multiple and !replaceAll → SKILL_AMBIGUOUS_EDIT
  → write
  → record new observation
```

**关键：版本检查在匹配之前。不同区域也会 stale，和平台 edit 一致。**

#### remove

```text
requirePresent
lock
  → version compare
  → remove
  → record absent
```

#### writeUnit

```text
observation snapshot for every target
  → 任一 target 无观察 → 整个 unit 拒绝
  → 收集 targetKeys，排序
  → 按序获取全部锁
  → 每个 target 比较 expected
  → 任一 stale → 整个 unit 不写
  → 全部写（WriteKernel 补偿）
  → 更新观察
```

### 5.5 锁模型

```ts
class SkillLockTable {
  private tails = new Map<string, Promise<unknown>>()

  withLock<T>(targetKey: string, op: () => Promise<T>): Promise<T>

  withLocks<T>(targetKeys: readonly string[], op: () => Promise<T>): Promise<T>
}
```

要求：

- `withLocks` 先去重，再按字典序排序；
- 释放顺序与获取顺序相反；
- 锁只覆盖磁盘 read/compare/write，不覆盖模型调用或审批等待；
- 跨进程仍由 `transactIo` + per-directory lock + HomeFence 负责。

### 5.6 观察存储

```ts
class SkillObservationStore {
  private byOwner = new WeakMap<SkillOwner, Map<string, SkillObservation>>()

  record(owner, targetKey, observation)
  require(owner, targetKey): SkillObservation | undefined
  drop(owner)
}
```

- owner 是对象（session/task），WeakMap 可回收；
- 插件 dispose 清空；
- HMR 重载不保留旧观察；
- 不跨 owner 共享。

### 5.7 错误与重试语义

| 错误 | 含义 | 模型动作 |
|---|---|---|
| `SKILL_NOT_OBSERVED` | 没读就写 | 先 read，再 retry |
| `SKILL_STALE_VERSION` | 读后文件变了 | 重新 read，重新规划 |
| `SKILL_NOT_FOUND` | 目标本应存在但已不存在 | 重新 read/list，决定 create/放弃 |
| `SKILL_ALREADY_EXISTS` | create 撞到已存在 | 重新 read，改 update/patch |
| `SKILL_AMBIGUOUS_EDIT` | old_string 不唯一 | 缩小 old_string 或显式 replace_all |
| `SKILL_RESOURCE_BUSY` | 锁被其他执行者持有 | `review_wait` 或短等待 |

`SKILL_STALE_VERSION` 不是锁等待，不能映射成 `review_wait`。

### 5.8 AUX 后台 review 的 owner

```text
review task → owner = review task id（或 child session id）
```

- parent 读过的 skill 不授权 review 写；
- review 必须自己 read；
- review 结束释放观察；
- review_wait 只处理锁等待，不处理 stale；
- stale 后 review 自己在预算内重读/重试，耗尽则 partial。

### 5.9 审批

审批请求携带：

```ts
targets: {
  targetKey: string
  expected: SkillVersion | 'absent'
}[]
```

批准执行：

- 用同一 expected 做 CAS；
- stale → 明确拒绝；
- 不自动应用旧 patch；
- 不自动 re-read + 重放（那是自动 rebase，明确不做）。

### 5.10 与平台的关系

不需要改平台代码。

平台已经提供正确的语义参照：

```text
fs-observation-policy
  → fs intent
  → per-target lock + version CAS
  → typed stale
```

我们在 skill 领域实现等价物，因为 skill 有：

- 多文件 unit；
- frontmatter/引用语义；
- approval/staged snapshot；
- 跨进程 HomeFence；
- 历史/ledger。

这些是平台通用 fs 不负责的领域逻辑。

## 6. 迁移顺序

### Phase A：引入观察，不强制

1. 新增 `SkillTarget` / `SkillVersion` / `SkillObservation`；
2. 新增 `SkillObservationStore`；
3. read tool / skill read path 记录观察；
4. 不改任何写入行为；
5. 对照测试：观察只增不减，不影响写结果。

### Phase B：引入 CAS 原语

1. `SkillStore` 增加按 target 的 `replaceIfVersion` / `createIfAbsent`；
2. 复用 `WriteKernel.writeOne` 的 expected 语义；
3. 锁内比较 expected；
4. 单测并发：两个 expected 相同，只有一个成功。

### Phase C：tool 切换

1. `create` → createIfAbsent；
2. `update/write_file/remove_file` → replaceIfVersion；
3. `patch` → editIfVersion；
4. approval 的 `stagedAnchor` 由 service 统一生成；
5. 删除 tool 层手工 anchor/重复判断。

### Phase D：锁重构

1. 用 per-target lock 替代 per-root serial queue；
2. 多文件 unit 使用排序锁；
3. 保留 `transactIo` / per-directory lock / HomeFence；
4. 并发测试：不同 skill 可并行，同一 target 串行。

### Phase E：审批与 AUX

1. 审批携带 target versions；
2. AUX review owner 固定为 child/review task；
3. stale 语义接入 `review_done` 的 unresolved/partialReason；
4. 不把 stale 映射为 resource-busy。

### Phase F：所有调用方收口

1. tool-skill-manage；
2. curator；
3. merge；
4. learning graph；
5. extract；
6. AUX review child；
7. 其他直接 `newSkillLibrary` 写路径。

### Phase G：删除旧债

- 删除 `write-gates` 中重复的 read gate 并发逻辑；
- 删除 tool 层手工 staged anchor；
- 删除 per-root serial queue；
- 保留 `WriteKernel` / `UnitTransaction` / `transactIo`；
- 更新 README、架构文档、测试 taxonomy、gate。

## 7. 文件级改造面

| 文件 | 改动 |
|---|---|
| `evolution-core/src/skill-write.ts`（新） | SkillTarget/Version/Observation/Intent/Error |
| `evolution-core/src/skill-observation.ts`（新） | per-owner observation store |
| `evolution-core/src/skill-write-service.ts`（新） | 唯一写入权威 |
| `evolution-core/src/skill-store.ts` | 增加 replaceIfVersion / createIfAbsent；锁粒度重构 |
| `evolution-core/src/write-kernel.ts` | 复用，不改语义；按 target 的 expected |
| `evolution-core/src/write-gates.ts` | 保留授权/threat/protected；删除重复并发判断 |
| `evolution-core/src/write-authority.ts` | 保留 origin/confirm；增加 owner 传递 |
| `evolution-core/src/tree-write.ts` | unit 使用 SkillWriteService |
| `tool-skill-manage/src/index.ts` | 只留参数/approval/展示；删除 anchor 逻辑 |
| `tool-skill-manage/src/skill-actions.ts` | 调用 service；不再直接调 library |
| `evolution-review/src/index.ts` | AUX owner 接入 |
| tests | 并发、CAS、stale、approval、unit、AUX |

## 8. 验收矩阵

| 场景 | 期望 |
|---|---|
| 两 session 都 read，A patch 第 10 行，B patch 第 50 行 | A 成功，B `SKILL_STALE_VERSION`；B 重读后成功 |
| 两 session 改同一区域 | 第二个 stale；重读后可能 EDIT_NOT_FOUND 或成功 |
| 两 session update 同一文件 | 第二个 stale |
| 两 session create 同一 skill | 一个成功，一个 `SKILL_ALREADY_EXISTS` |
| 未 read 就 patch | `SKILL_NOT_OBSERVED` |
| old_string 多处且无 replace_all | `SKILL_AMBIGUOUS_EDIT` |
| patch 后文件被外部改 | stale，不写 |
| 多文件 unit 其中一个 stale | 整个 unit 不写 |
| 审批后目标变化 | 审批失效，stale |
| AUX child 未 read parent 读过的 skill | `SKILL_NOT_OBSERVED` |
| resource-busy | review_wait 或短等待 |
| 不同 skill 并发写 | 可并行（不再 per-root 队列） |
| 跨进程并发 | transactIo 锁 + CAS |
| HMR 重载 | 观察清空，不残留旧版本 |

## 9. 非目标

- 不做自动 3-way merge / CRDT / rebase；
- 不做“不同区域自动合并”；
- 不改变前台 inject 行为；
- 不改变 review partial/unresolved 语义；
- 不把 stale 伪装成 resource-busy；
- 不引入平台代码修改；
- 不为了并发度牺牲 CAS 的显式失败。

## 10. 风险与回退

| 风险 | 缓解 |
|---|---|
| 重读次数增加 | 只在 stale 时重读；预算内由 review 控制 |
| 观察 store 泄漏 | WeakMap + dispose 清空 |
| 锁顺序死锁 | targetKey 排序 + 逆序释放 + 超时 |
| 多文件 unit 半写 | WriteKernel 补偿 + 先全锁后写 |
| 审批后长期 stale | 审批失效并明确提示，不自动重放 |
| 与现有 readNames 重复 | 迁移期双写；Phase G 删除旧判断 |
| 老调用方绕过 service | Phase F 全量收口 + gate 检查直接 mutator 调用 |

回退：

- Phase A/B 只增不改，可单独回退；
- Phase C 按 action 粒度开关；
- 保留旧 `staged_from_sha256` 输入兼容一个版本；
- 最终删除旧路径前先跑双读对照。

## 11. 实施后的代码形态

### Before

```text
tool index
  ├─ build stagedAnchor
  ├─ read gates
  ├─ SkillLibrary.serial
  ├─ SkillLibrary.patch (lock + match + write)
  └─ WriteKernel maybe
```

### After

```text
tool index
  └─ SkillWriteService
       ├─ observe(owner, target)
       ├─ intentFor(owner, target)
       ├─ lock(targetKey)
       ├─ CAS(expected, current)
       ├─ match/edit
       └─ WriteKernel.commit()
```

工具层不再知道“版本从哪里来”，只负责：

```text
read → service.read()
patch → service.patch()
update → service.update()
create → service.create()
delete → service.remove()
```

## 12. 最终取舍

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 保持当前 patch 锁内合并 | 吞吐高、不同区域友好 | 静默语义冲突、后台不可审计 | 否 |
| 只给 patch 加 stale | 改造成本低 | 观察/锁/anchor 仍分散 | 过渡可以，终局不行 |
| 统一 SkillWriteService + CAS | 可解释、可审计、单一权威 | 重写面大、重读增加 | **采用** |
| 自动 rebase/merge | 并发体验好 | 违背冻结决策、后台风险高 | 否 |

## 13. 一句话总结

> **平台权威 = 按 session 观察 + per-target 锁 + 锁内版本 CAS + 显式 stale。**
>
> **我们的终局 = 把这套语义提升为 SkillWriteService，保留 transactIo/HomeFence/UnitTransaction，删除分散的 read gate、手工 anchor 和 per-root 锁；后台 patch 不再静默合并，不同区域冲突也显式 stale，由模型重读后重试。**

## 14. 实施记录

### 2026-11-20：DCR-1 定格为“平台版本校验后取 content hash”

新事实：

- 通用 `read` 只给平台 `FsVersion`（`dev:ino:size:mtimeNs:ctimeNs`）+ 可能截断的窗口内容；
- 读结果可能按行截断（`readMaxLineLength`）、按字节截断（`readMaxBytes`）、只读窗口；
- 因此不能从 read 结果文本安全重建“整文件 canonical bytes 的 sha256”。

决议（替代早期“双 token 并存”的待定状态）：

- observation 的最终版本仍是 **content sha256**；
- 平台 `FsVersion` 只作为**捕获栅栏**：
  1. 监听 `fs/observed` 拿到平台版本 V；
  2. 同步读文件；读前后各算一次平台版本；
  3. 只有两次都等于 V，才说明读到的是该 read 对应的字节；
  4. 对该字节取 content hash，写入 observation；
- 任一版本不一致 → 不记录 observation，下一次写必须重读。

影响：

- 通用 read 可以安全地产生 content-sha observation，不需要把平台 token 混入写 CAS；
- `SkillWriteService` / `SkillLibrary` 继续只比较 content sha；
- 平台 token 不进入 anchor、不进入审批暂存、不进入 history；
- 并发窗口在“read → fs/observed 监听器”之间发生时，宁可少授权，不产生新内容授权。

回退：

- 若某平台 backend 的 `targetKey` 不是 host path，或版本格式不同，监听器不记录；该 read 不授权写，写路径返回 `SKILL_NOT_OBSERVED`。

### 2026-11-20：Phase C.9 owner 独立与审批语义核对

已完成：

- 新增 service 测试：parent session 读 SKILL.md 后，review child 仍 `SKILL_NOT_OBSERVED`；child 自己 read 后才可写。
- 验证 observation owner 不会跨 parent/child 泄漏，满足 AUX child owner 的基本不变量。

审批 F 的现状核对：

- 现有 approval staging 已把 `staged_from_sha256` 写入 operation；
- approval replay 走 `executeCore(operation, ..., owner=undefined)`，`stagedAnchor` 交给 library；
- 既有 `v30 REV-03`、`P1-13` 测试覆盖“staging 后目标变化 → replay 拒绝”；
- 因此单 target 审批的 expected/CAS 语义已经具备；
- 多 target unit 审批仍未实现，留待 unit phase。

验证：

```text
skill-write-service: 6 passed
```

### 2026-11-20：Phase I.2 tool 级 owner 隔离证据

已完成：

- tool 级测试（两个不同 agent session）：
  1. parent create；
  2. parent 读；
  3. child 未读就 update → `SKILL_NOT_OBSERVED`；
  4. child 读后 update → 成功；
  5. parent 用旧观察 update → `SKILL_STALE_VERSION`。
- 证明 owner 隔离发生在 tool 层，不只是 `SkillObservationStore` 单测；
- review child 与 parent 同构，均以 `exec.agent.session` 为 owner。

验证：

```text
skill-observed-writes: 5 passed
overlay build:          0
```

边界：

- 这是两个普通 session 的 tool 级证据，未接真实 AUX review task；
- review child 的真实执行仍待宿主验收；
- 未 bump 版本，未发布。

### 2026-11-21：Phase H1 plan 层类型与单 op apply

读完 `skill-write-intent.ts`、`write-kernel.ts`、`mutation-unit.ts` 后修正了单 Provider 方案的第一版类型：**不新增第二套底层 intent/CAS 内核**，plan 层只表达“领域动作 + 期望版本”，provider 再映射到现有 `SkillWriteIntent` / `decideSkillWrite` / `MutationUnit`。

已完成：

- 新增 `packages/evolution-core/src/skill-write-plan.ts`
  - `SkillWriteExpect`、`SkillWriteOp`（createSkill/write/patch/patchSection/remove）、`SkillWritePlan`、`SkillWriteOutcome`、`SkillWriteResult`；
  - 从 `evolution-core/skills` 导出。
- `SkillLibrary.apply(plan)` 先支持单 op，转发现有的 `create/update/patch/patchSection/writeSupportFile/removeSupportFile`；
- `createSkill` 与普通 `write` 分开，保留 create 的 managed/保护/审计语义；
- 多 op 明确返回未实现，不部分提交；
- 新增 `skill-write-plan.spec.ts`：write/patch/section、support createIfAbsent 重复拒绝、createSkill、multi-op 拒绝，4 passed；
- overlay build 0。

边界：

- tool 路径未改变，仍走旧 service/library 分支；
- 尚无 observation→intent 的 service.plan，也未触碰 approval；
- H2 才把 tool 全部写动作切到 plan；H3 才改 approval；H4 才收敛锁。



独立复核 0.59.4 发现 P1：`patch.section` 的 approval replay 未校验 staged anchor，staging 后并发改写 body 仍可能覆盖新 section。

修复：

- section patch staging 始终锚定 SKILL.md body，忽略同时传入的 file_path；
- `patchSection(rawName, edit, origin, anchor?)` 在锁内读 md 后先校验 anchor；stale 返回 `SKILL_STALE_VERSION`；
- replay 把 `stagedAnchor` 传入 `patchSection`；
- 新增 section stale replay 回归测试。

验证：

```text
tool-skill-manage: 44 passed (section stale replay)
overlay build: 0
```

### 2026-11-21：Phase P1.13 审批 patch anchor（0.59.4）

真实 npm web 双会话验收发现：两个 patch 在同一 skill 上并发 stage，批准时第二个仍成功，文件出现重复片段。

定性：违反要求 F（approval 携带每个 target 的 expected version；批准后再 CAS；任一 stale 整个审批失效）。这是已发布 0.59.3 的 P0，需补丁版本。

修复：

- `tool-skill-manage` 的 approval staging 为 `action=patch` 计算 body / support file 的 `staged_from_sha256`；
- replay 把 `stagedAnchor` 传入 `SkillLibrary.patch`；
- `patchCore` 在写锁内先校验 anchor，再匹配 old_string；stale 返回 `SKILL_STALE_VERSION`；
- 新增回归测试：伪造 stale anchor 的 replay 必须被拒绝。

验证：

```text
tool-skill-manage approved-patch replay: 1 passed
真实 npm web：并发 create + 审批通过；并发 patch 复现旧行为后由本修复拦截
```

### 2026-11-20：Final review P0=0 / P1=0

独立复核最终结论（06215ce0）：

```text
P0 = 0
P1 = 0
```

复核探针：

- keyed + nested + serialized + 外层 fence lease：2135ms ok；
- keyed + nested 无外层 lease：2115ms ok；
- keyed + nested unserialized：1845ms ok；
- keyed + nested 3 sources：2636ms ok；
- non-keyed + nested 对照：704ms ok。

`skill-keyed-concurrency` 6/6 通过；此前 keyed 锁序（S→T）与 nested 重复取锁均闭环。

未验证：

- 真实宿主 keyed merge 全链路；
- keyedSkillLocks=true 的 npm web 并发验收（发布后）。

### 2026-11-20：Phase P1.12 nested merge 不再重复取 source lease

复核发现 b69765ba 在 keyed + nested 下外层已取 sources key，fenceHeld 分支又对同一 source 取一次，导致自死锁。

修复：

- `fenceHeld` 分支判断 `if (!keyed || sourceHeld)` → 走 archiveCore/restoreCore；
- 新增 keyed + nested commitMerge 回归（20s 内 settle）。

验证：

```text
skill-keyed-concurrency: 6 passed
overlay build: 0
```

### 2026-11-20：Phase P1.11 merge 统一 S→T 锁序

复核发现 keyed 下 consolidate 为 S→T（sources 先、target 后），merge 为 T→S（target 先、sources 后），同 target/有交集时可能互锁。

修复：

- commitMerge 在 keyed 运行时先取全部 source namespace keys；
- archive/restore 内部传 `namespaceHeld=true`，不重复取；
- 然后 target tree unit 取 target keys；
- consolidate 也已是 S→T；
- 两类结构操作现在同一锁序，字典序多 key 获取由 TargetLockSet 保证。

验证：

```text
commit-merge + fence-lease: 9 passed
overlay build: 0
```

### 2026-11-20：Phase P1.10 复核 P1 修复

复核指出两项 P1，已修：

1. `TargetLockSet.repair()` 读/删路径少了平台锁的 `.lock` 后缀：
   - 修复为 `lockPath(key) + ".lock"`；
   - 删除后再次 `readFile`，只有 ENOENT 才计入 repaired；
   - 测试 fake lock 现在真实创建 `.lock` 文件，并断言 repair 后文件消失。
2. `extract()` 的 `ensureRecovered()` 在 `rootGate.write` 内，首次调用会自死锁：
   - 移到 gate 之前；
   - `extractCore` 不再调用 recovery。

验证：

```text
authority-target-locks: 6 passed
mutation-unit:          26 passed
overlay build:          0
```

注意：本机当前在役 web/host 进程负载高，`skill-restructure.spec.ts` 即使隔离也会超过其文件级 30s timeout；这是测试预算问题，不是新死锁。

### 2026-11-20：Phase P1.9 recovery 按 snapshot 派生 target keys

- `MutationUnitOptions.targetKeysForSnapshot`：recover 从 snapshot ops 派生 key；
- SkillLibrary recover 映射：
  - absolute target → 相对 skill root；
  - 生成 `skill::name`、`skill::name::*`、support 精确 key；
- recover 不再以空 keys 回退 fence；
- 新增测试：fake lock 捕获 recover acquire 的 keys，期望 `skill::source`。

验证：

```text
mutation-unit: 26 passed
mutation-recovery + keyed concurrency: 35 passed
overlay build: 0
```

### 2026-11-20：Phase P1.8 TargetLockSet repair + recovery gate

- `MutationLockPort` 增加可选 `repair()`；
- `TargetLockSet.repair()`：
  - 只处理 release 失败记录的 key；
  - 读锁文件 pid；
  - 活进程 → skipped；
  - 死亡/ENOENT → 删除锁文件并 repaired；
- `TargetMutationLock` / `HybridMutationLock` 透传 repair；
- `SkillLibrary.recoverPreparedUnits()` 先用 `rootGate.write` 包住 recovery，并在 recovery 前尝试 repair；
  - 同进程 keyed simple 写会等 recovery 完成；
  - 跨进程 recovery 窗口仍需后续收口。

验证：

```text
mutation-recovery + authority-target-locks: 11 passed
overlay build: 0
```

### 2026-11-20：Phase P1.7 pre-tag 复跑

第二次 pre-tag 静态门禁：

```text
pass=60
fail=0
cannotDecide=7（4 已登记 + 3 未登记）
skipped=2
```

未登记 cannot-decide：

- gate-07 / gate-24：本机 180s 预算内跑不完（arch-guards 单独跑已 OK）；
- gate-18：平台契约上游比对输入不可用。

其余环境缺失：

- gate-01/05：无 harness-0.2.1 checkout；
- gate-29：无 plane home；
- gate-81：无健康语料。

结论：静态门禁无 fail；剩余为环境输入/预算，不是代码失败。

### 2026-11-20：Phase E13 本地注入真机验收

按用户选择做本地注入 web 验收（不是 npm 发布）。

装配：

- 新 profile `accept`：
  ```text
  @deepseek-ai/dsh-base
  @deepseek-ai/dsh-headless
  @deepseek-ai/dsh-credentials-local
  @deepseek-ai/dsh-llm-deepseek
  @lmzhen/dsh-evolution-all
  ```
- 从 `harness-rc3/packages/evolution` 注入本地构建：
  - evolution-core；
  - tool-skill-manage；
  - evolution-review；
  - evolution-merge；
  - evolution-activity；
- patch 覆盖：
  - `evolution-authority.config.keyedSkillLocks: true`；
  - `evolution-skill-catalog.config.root: D:/dsh/_keyed-acceptance-skills`；
  - `agent-preset-registry.selectedDefault: evolution`。

`--dump-config` 确认 keyedSkillLocks=true 已生效。

真机结果：

1. 单 headless host：
   - `skill_manage create host-keyed` 成功；
   - `skill_manage update host-keyed` 成功；
   - 最终 SKILL.md body 为 `second body`。
2. 两个 headless host 进程并发：
   - 各自 create 不同 skill `host-keyed-a` / `host-keyed-b`；
   - 两个进程 exit 0；
   - 没有死锁/资源忙错误。

边界：

- 两个 headless host 未断言“并行耗时”，只证明 keyed 装配下真实 host 可并发完成；
- 同 skill 双写 stale 仍由工具/服务测试覆盖；
- 真机写落到 `D:/dsh-homes/web/skills`（SkillLibrary 根不是 catalog root），验收后已移出到 `D:/dsh/_keyed-acceptance-artifacts`；
- web profile 注入前已备份，验收后已还原；
- `accept` profile 已安全移除（先删 junction，再删目录）。

### 2026-11-20：Phase P1.6 定向测试稳定化

13 个定向 spec 并行跑时出现 30s 超时（7 条），全部为高负载超时；改用 `--maxWorkers=1` 后：

```text
Test Files  13 passed
Tests       125 passed
Duration    352.26s
```

结论：

- 无死锁回归；
- 本机并行负载会把 8–14s 的 create 推到 30s 预算外；
- 发布/CI 应使用 `maxWorkers=1` 或更高 testTimeout 跑 pre-tag 定向套件。

### 2026-11-20：Phase P1.5 pre-tag 静态门禁

本轮跑完整 pre-tag 静态门禁（69 条）：

- pass 59；
- fail 2（已修）；
- cannot-decide 6（4 条已登记环境缺输入，2 条超时）；
- skipped 2。

已修：

1. gate-06 dependency closure：
   - `skill-observations.ts` 的 `dsh-fs` 类型导入恢复；
   - `tool-skill-manage` peerDependencies 声明 `@deepseek-ai/dsh-fs`；
2. gate-46 check-taxonomy：
   - 14 个新增 spec 补 `// @tier fast`；
   - 重新生成 `packages/scripts/reports/check-taxonomy.json`。

验证：

```text
verify-dependency-closure: OK（0 undeclared）
gen-check-taxonomy --check: OK（5 lanes）
overlay build: 0
```

剩余 cannot-decide：

- gate-01/05：本机没有 harness-0.2.1 平台 checkout；
- gate-07/24：verify-arch-guards/verify-arming 180s 超时（单独跑 arch-guards 已 OK）；
- gate-29/81：本机缺 prepare 专有输入/健康语料。

### 2026-11-20：Phase P1.4 观察版本探针不再吞读错

`skillPlatformVersion` 原实现 `try/statSync catch -> undefined` 被 arch guard N14 判为“durable-read failure served as absent”。

修复：

- 使用 `statSync(path, { bigint: true, throwIfNoEntry: false })`；
- 缺失/非文件返回 undefined；
- EACCES/EIO 等真实读错继续抛出，不再伪装 absent。

验证：

```text
verify-arch-guards --strict: OK（42 rules clean）
skill-observations: 5 passed
overlay build: 0
```

### 2026-11-20：Phase P1.3 superseded — first-occurrence 契约保留

P1.3 曾让「old_string 多次出现」返回 `SKILL_AMBIGUOUS_EDIT`，但 tool 现有契约明确是：

- 默认替换第一次出现；
- 结果消息报告 `FIRST of N occurrences` 并提示 `replace_all=true`；
- 既有 tool 测试与 0.59.2 发布行为依赖该契约。

决定：回退该行为，保留 first-occurrence + 计数提示；`SKILL_AMBIGUOUS_EDIT` 仍保留在 service 错误词汇中，但当前库层不产生。

若要改成默认唯一匹配，需要单独 DCR 并同批更新 tool 描述、审批预览与测试，不能静默改变已发布行为。

### 2026-11-20：Phase P1.3 ambiguous edit 可达

- `SkillLibrary.patch` 在 `replace_all=false` 且 exact old_string 出现多次时返回 `ambiguous: true`；
- `SkillWriteService.actionResult` 映射为 `SKILL_AMBIGUOUS_EDIT`；
- 新增测试：重复锚点拒绝；`replace_all=true` 成功；
- 默认唯一匹配语义落地，显式 `replace_all` 才全替。

验证：

```text
skill-write-service: 7 passed
overlay build: 0
```

### 2026-11-20：Phase P1.2 consolidate 全程持 source keys

- consolidate 在 keyed 模式下，于 root gate 内先获取所有 source 的 namespace keys，再进入 serial/body；
- 内部 archive/restore 增加 `namespaceHeld` 参数，外层已持 keys 时不再重复获取；
- 目标 body 仍由 tree unit 的 target keys 保护；
- 非 keyed 模式不取外层 lease，避免 root fallback 自锁。

验证：

```text
keyed concurrency: 5 passed
overlay build: 0
```

注意：默认非 keyed 的 consolidate 在批量高负载下仍会接近 30s 测试超时；隔离单条 25s 通过，属于既有测试时间预算问题，不是新死锁。

### 2026-11-20：Phase P1 默认 public archive fence 恢复

独立复核 P0=0 后的 P1 修复：

- public archive/restore 在非 keyed（默认 HomeFence）端口下恢复取 fence lease；
  - root gate 外层 → fence lease 内层 → core；
  - audit 已 `fenceHeld=true`，不会再自死锁；
  - rootHeld/nested 非 keyed 仍跳过，由外层 fence 覆盖；
- commitMerge `serialized=true` 不再新取 rootGate，避免 serial→fence→gate 与 gate→serial 的相反顺序。

验证：

```text
serial + keyed + commit-merge + fence-lease: 17 passed
overlay build: 0
```

剩余 P1：

- consolidate sources 逐 archive 窗口；
- release 失败后锁文件残留、无 repair 消费；
- keyed 空 keys 回退 fence / recover keyless；
- `SKILL_AMBIGUOUS_EDIT` 不可达；
- 真实 npm web 并发验收未做。

### 2026-11-20：Phase P0.6 merge 恢复改用 fence.run

修复独立复核指出的既有 P0：

- `unit-protocol` 的 `withRecoveryFence` 从 `fence.acquire()` lease 改为 `fence.run()` ALS；
- `rollback` 拆为 `rollbackLocked`：
  - 有 fence → `fence.run(lock => rollbackLocked)`；
  - 无 fence → 继续使用 `acquireTreeFence` fallback；
- 这样 backend 的 update/writeSupport/restore 在 ALS 持树下走 `holdsTree()` no-op，不再二次请求 HomeFence lease。

验证：

```text
library-adapter + recovery-settle + unit-claim + undo-fence: 14 passed
overlay build: 0
```

边界：

- 尚未用真实 `skillLibraryUnitBackend` 构造崩溃快照并跑 rollback/finalize end-to-end；
- 需独立复核复验 P0=0。

### 2026-11-20：Phase P1 fail-closed keyed probe

- `keyedTargetLocks()` 不再用 `try/catch` 吞 `lockPort()` 的装配错误：
  - 有注入端口 → 读 `keyed`；
  - 无注入端口且非测试 → 调 `lockPort()` 显式抛错；
  - 测试 fallback → 非 keyed。
- 防止“生产无 mutationLock”时 archive/restore 静默绕过 fence。

验证：

```text
overlay build: 0
```

仍待：

- merge 启动恢复 rollback/finalize 在 fence lease 下调单写会自死锁（既有 P0，非本轮引入）；
- 默认模式 public archive/restore 目前不再取 fence lease，需在 rollback 改 `fence.run` 后恢复；
- 其余 P1 见独立复核报告。

### 2026-11-20：Phase P0.4 nested merge 不再重取 fence

复验发现：nested merge 的 namespace lease 在默认 fence 装配下会再次请求同一 HomeFence（merge 单外层用 fence lease，lease 不建 ALS，holdsTree 判不到），生产 merge 必挂。

修复：

- `MutationLockPort` 增加 `keyed?: boolean`；
- `TargetMutationLock` / `HybridMutationLock` 标记 `keyed=true`；
- `SkillLibrary.keyedTargetLocks()` 判断注入端口；
- archive/restore 只在 keyed 端口下取 namespace lease，fence 端口直接走 root gate/core；
- nested commitMerge 同样只在 keyed 下取 namespace lease；
- 新增回归：外层持 HomeFence lease 时 nested commitMerge 20s 内成功。

验证：

```text
commit-merge-fence-lease + commit-merge: 9 passed
overlay build: 0
```

### 2026-11-20：Phase P0.3 lease 内 audit 自死锁修复

独立复核复验 P0 后，又发现并修复一个 P0：

- `setPinned` 持 mutation-lock lease 后调用 `audit`，audit 仍以 `fenceHeld=false` 再取 fence；
- 该 lease 的 ALS 不覆盖调用方，`HomeFence.run()` 判不到重入，排在自己未释放的 tail 后 → 永久死锁；
- archive/restore 同类。

修复：

- pin/unpin audit 传 `fenceHeld=true`；
- archive/restore 的 public 与 rootHeld 路径统一 `archiveCore(..., true, ...)` / `restoreFromArchiveCore(..., true)`；
- nested commitMerge 的 archive/restore 在 `fenceHeld=true` 分支也取 namespace lease，关闭 merge sources 的 keyed 互斥缺口。

验证：

```text
skill-store-authority-lock + commit-merge: 16 passed
commit-merge: 8 passed
overlay build: 0
```

仍留 P1：

- consolidate sources 是逐 archive 持 namespace，不是全局持 key；
- release 失败后锁文件可能残留，需重启恢复；
- keyed 空 keys 仍回退 fence；
- `SKILL_AMBIGUOUS_EDIT` 在 service 映射下不可达；
- 真实 npm web 验收未做。

### 2026-11-20：Phase P0.2 keyed archive/simple 并发回归

- 新增 keyed hybrid 测试：
  - `archive(a)` 与 `update(b)` 同时启动；
  - 10s 内都 settle；
  - archive 成功、update 成功；
- 覆盖 P0-1 在 keyed 路径下的 ABBA 风险。

验证：

```text
skill-keyed-concurrency: 5 passed
overlay build: 0
```

### 2026-11-20：Phase P0.1 独立复核死锁修复

独立复核发现 3 个 P0，已修复：

**P0-1 archive/restore 取锁顺序**

- 旧：先 target namespace lease，后 rootGate.write；
- simple 写先 rootGate.read，后 target/namespace；
- 两者形成 ABBA 死锁，默认配置即可触发；
- 修复：archive/restore 统一为 rootGate.write 外层，namespace lease 内层；
- 新增回归：archive + 不同 skill update 并发必须在 10s 内 settle。

**P0-2 commitMerge 内部 archive 重入门**

- 旧：`rootHeld = options.serialized`，commitMerge 自己持门时内部 archive 仍 `rootHeld=false`；
- 修复：commitMerge 外层始终持 rootGate（serialized 只决定是否再走 serial），内部 archive/restore 固定 `rootHeld=true`；
- 既有 commit-merge 8 tests 全过。

**P0-3 TargetLockSet release 失败泄漏**

- 旧：release 抛错时跳过 releaseGate/tail 删除，同 key 后续永久挂起；
- 修复：release 的 `done` 用 try/finally，失败记录 `lastReleaseError` 但不阻断 gate/tail；
- 多 key 回滚逐 key try/catch；
- 新增回归：release 抛错后同 key 可再次 acquire。

**配套修复**

- setPinned 恢复 namespace mutation lock，避免 pin 与 update 的 protection 竞态；
- MutationAuthority 的 TargetLockSet 改为实例级复用，不再每次 getter 新建；
- commitMerge/consolidate 不再在外层重复取 lockPort（会与内部 unit 的 root fallback 自锁）；
- archive/restore 的 `rootHeld=true` 分支自己取 namespace key，保证 consolidate/commitMerge 的 sources 也有 keyed 互斥；
- `SKILL_STALE_VERSION` 等 code 进入 tool message，review executor 的 errorKind 分类在生产路径可命中；
- authority plugin 增加 schemastery Config schema，拼错开关会在 loader 报错。

验证（P0 修复后）：

```text
skill-store + commit-merge + serial + consolidate
+ keyed + target locks + mutation unit: 9 files / 133 tests passed
overlay build: 0
```

仍保留的已知边界：

- P1-3：平台 `skill` 工具读不产生 `fs/observed`，因此“用 skill 工具加载→写”仍会 NOT_OBSERVED；这是平台观察事件缺口，不在本层伪造授权。
- consolidate 的 sources 是逐个 archive 时持 namespace key，不是整个 consolidate 全程持全部 key；目标 body unit 一次性持 target keys。跨步骤窗口仍需真实宿主并发验收。
- 生产 keyed 默认仍 false。

### 2026-11-20：Phase J.1 activity 区分 stale/busy

已完成：

- `EvolutionReviewAction` 增加可选 `errorKind`：
  ```text
  stale | busy | unobserved | ambiguous | not-found
  ```
- `review-executor` 对 tool error 归类：
  - `SKILL_STALE_VERSION` → `stale`；
  - `SKILL_RESOURCE_BUSY` / `resource-busy` → `busy`；
  - `SKILL_NOT_OBSERVED` / `SKILL_AMBIGUOUS_EDIT` / `SKILL_NOT_FOUND` 分别归类；
- review busy 分支直接写 `errorKind: busy`；
- activity v3 原样序列化 actions，因此记录可区分 stale/busy；旧记录无该字段仍可读。

验证：

```text
review-executor: 16 passed
activity store/version gate: 29 passed
overlay build: 0
```

边界：

- UI 尚未展示 errorKind；本步只保证 activity/report 数据可区分；
- 未 bump 版本，未发布。

### 2026-11-20：Phase I.1 stale 不映射 wait 证据

已完成：

- `review-executor` 单测：
  - 写入工具返回 `SKILL_STALE_VERSION`；
  - runner 原样作为 tool error 交给模型；
  - `waitCount === 0`；
  - actions 中没有 `review_wait`；
  - 模型下一步正常 `review_done`。
- 对比既有测试：
  - `resource-busy` 才生成 review_wait 引导；
  - review_wait 成功路径 waitCount=1。

验证：

```text
review-executor: 16 passed
overlay build:   0
```

边界：

- 这证明 runner 不把 stale 当 wait；
- SkillWriteService 的显式错误码仍是最终权威；
- 未 bump 版本，未发布。

### 2026-11-20：Phase E.15 多 target 单元全量 CAS 证据

已完成：

- `MutationUnit` 测试：
  - 两个 target 的 write；
  - B 的 expected 与当前值不一致；
  - 整个 unit 失败；
  - A 保持原值，B 保持并发写入后的值；
  - 无部分写入。
- 验证：
  ```text
  mutation-unit: 25 passed
  overlay build: 0
  ```

边界：

- 这是 unit kernel 证据；真正多文件业务 unit（restructure/extract）已有同构事务；
- 审批 side 仍是单 target staged record：当前 tool 一次只暂存一个 target，`staged_from_sha256` 单 anchor 足够；多 target 审批 unit 尚未暴露；
- 未 bump 版本，未发布。

### 2026-11-20：Phase E.14 HMR 观察清空证据

已完成：

- 新增测试：plugin context dispose 后，所有 owner 的 skill observation 清空；
- 依赖 `installSkillObservationListener` 的 `ctx.effect(() => () => store.clear())`；
- 清空后同 session 的写会重新得到 `SKILL_NOT_OBSERVED`，不会沿用旧观察。

验证：

```text
skill-observations: 5 passed
overlay build:      0
```

边界：

- 这是观察生命周期测试，不涉及 keyed 生产开关；
- 未 bump 版本，未发布。

### 2026-11-20：Phase E.12 全量定向回归

在 keyed opt-in 装配（默认关闭）完成后跑全量定向套件：

```text
Test Files  11 passed
Tests       113 passed
Duration    200.50s
```

覆盖：

- tool-skill-manage；
- observed writes；
- SkillWriteService；
- root gate；
- store serial / consolidate；
- target locks / keyed authority；
- mutation unit；
- keyed concurrency。

结论：配置开关未引入回归；下一步只剩真实 npm web 并发验收与默认开启决策。

### 2026-11-20：Phase E.12 authority plugin 配置开关

已完成：

- `evolution-authority` 增加配置：
  ```ts
  interface Config { keyedSkillLocks?: boolean }
  ```
- 默认 false，保持旧 HomeFence 行为；
- true 时构造 `MutationAuthority({ keyed: true })`，其 `mutationLock` 变为 Hybrid keyed；
- 装配层无需改 `mutationLockFrom`。

验证：

```text
build 0（配置类型编译通过）
```

下一步：

- 在测试 profile 打开 `keyedSkillLocks: true`；
- 跑 tool/structural 全量；
- 真实 web 并发验收；
- 通过后才考虑默认开启。

### 2026-11-20：Phase E.11 MutationAuthority keyed opt-in

已完成：

- `MutationAuthorityOptions.keyed?: boolean`（默认 false）；
- `MutationAuthority.mutationLock`：
  - keyed=false → 原 HomeFence root lock；
  - keyed=true → `HybridMutationLock(TargetMutationLock(TargetLockSet(home)), root)`；
- `mutationLockFrom` 不改，仍返回 authority.mutationLock，因此装配层只需设置 keyed。
- 2 个测试：
  - keyed=true：keyed acquire 不碰 fence；keyless acquire 走 fence；
  - keyed=false：即使带 keys 也走 fence。

验证：

```text
mutation-authority-keyed: 2 passed
overlay build:            0
```

边界：

- 默认 keyed=false，生产行为不变；
- 打开后结构/恢复 keyless 走 fallback；
- 需要全量回归与真实 web 验收后才默认开启。

### 2026-11-20：Phase E.10 hybrid keyed 装配验收

已完成：

- SkillLibrary 测试装配：
  ```ts
  new HybridMutationLock(
    new TargetMutationLock(new TargetLockSet(home)),
    { acquire() { throw new Error('unexpected keyless mutation lock') } },
  )
  ```
  fallback 故意抛错，确保没有遗漏 targetKeys。
- 4 个测试全部通过：
  - 不同 skill update 真实并行；
  - 同 skill update 串行；
  - 手动持有 namespace lease 时同 skill update 等待；
  - consolidate 在 keyed hybrid 下不自死锁。

验证：

```text
skill-keyed-concurrency: 4 passed
overlay build:           0
```

关键结论：

- simple/结构操作都填了可用的 target keys；
- 没有触发 keyless fallback；
- consolidate 内部 archive/restore 走 rootHeld，未重复取 namespace；
- keyed 模式已经具备生产候选条件。

生产切换仍暂缓：

- 需要把 Hybrid lock 装配到 MutationAuthority；
- 需要全量 tool/structural 回归；
- 需要真实 npm web 并发验收。

### 2026-11-20：Phase E.9c 剩余结构操作填 namespace keys

已完成：

- restructure UnitTransaction：`[skillNamespaceKey(name)]`；
- extract UnitTransaction：`[skillNamespaceKey(source), skillNamespaceKey(target)]`；
- tree-change kernel（commitMerge/consolidate 共用）：按 landing 里的 skills 去重后填 namespace keys；
- archive/restore 已有单独 namespace lock；
- 生产 root lock 仍忽略 keys，因此行为不变。

验证：

```text
skill-keyed-concurrency + tool observed: 7 passed
overlay build:                            0
```

边界：

- consolidate 是否走 tree-change kernel 的 key 需要再用 keyed 装配实测；
- 生产仍 fallback root lock；
- 未 bump 版本，未发布。

### 2026-11-20：Phase E.9b archive/restore 持 namespace key

已完成：

- `archive` / `restoreFromArchive` 在外层通过 `lockPort().acquire([skillNamespaceKey(name)])` 持 keyed namespace 锁；
- rootHeld 内部路径不重复取锁；
- keyed 装配测试：
  - 手动持有 skill namespace lease；
  - 同 skill update 被阻塞；
  - release 后 update 成功。

验证：

```text
skill-keyed-concurrency: 3 passed
overlay build:           0
```

边界：

- consolidate/commitMerge/restructure/extract 的 UnitTransaction 还没有 namespace keys；
- 这些结构操作内部 archive 走 rootHeld，不重新取 namespace；需要外层结构操作补 keys；
- 生产仍 fallback root lock；
- 未 bump 版本，未发布。

### 2026-11-20：Phase E.9a namespace key 进入 simple 写

已完成：

- 新增 `skillNamespaceKey(name)`：
  ```text
  skill::<name>::*
  ```
- create/update/patch/writeSupport 的 keyed targetKeys 现在同时包含：
  - 精确 target key；
  - skill namespace key；
- 这样结构操作只要拿 namespace key，就能与同 skill 的 simple 写互斥；
- 不同 skill 的 namespace key 不同，仍可并行。

验证：

```text
skill-keyed-concurrency + tool observed: 6 passed
overlay build:                            0
```

边界：

- 结构操作尚未把自己的 namespace key 填进 UnitTransaction；
- 因此 keyed 模式下结构 vs simple 仍未互斥；
- 生产仍用 fallback root lock；
- 未 bump 版本，未发布。

### 2026-11-20：Phase E.8 HybridMutationLock

已完成：

- `HybridMutationLock`：
  - `targetKeys` 非空 → `TargetMutationLock`；
  - `targetKeys` 空 → fallback（HomeFence root lock）。
- 这样 simple 写可以走 keyed；结构/恢复/无 key 的 unit 仍走 root；
- 2 个测试：keyless → fallback；keyed → 不碰 fallback。

验证：

```text
mutation-authority-target-lock: 5 passed
overlay build:                  0
```

边界：

- 结构操作仍然没有 targetKeys，继续走 fallback；
- 因此结构操作与 keyed simple 之间仍没有跨进程互斥；
- 下一步必须把结构操作的 namespace/target keys 填进 UnitTransaction。

### 2026-11-20：Phase E.7 keyed 装配实证

已完成：

- 测试用 `SkillLibrary` 注入：
  ```ts
  new TargetMutationLock(new TargetLockSet(home))
  ```
  作为 mutationLock；
- 两个不同 skill 的 update：
  - 通过 SlowIo 统计同时在途 IO；
  - `maxActive > 1`，**真实并行**；
- 同一 skill 的两次 update：
  - `maxActive === 1`，**真实串行**；
- 既有 root gate / target lock / CAS 全部保留。

验证：

```text
skill-keyed-concurrency: 2 passed
overlay build:           0
```

关键结论：

- keyed 路径已经能提供不同 skill 的跨进程并行；
- 同 skill 的 target lock + keyed mutation lock 仍串行；
- 生产尚未切换，因为结构操作/恢复仍依赖 HomeFence root lock；
- 需要 hybrid lock（空 keys 回退 HomeFence，有 keys 用 TargetLockSet）后才能生产启用。

### 2026-11-20：Phase E.6 SkillLibrary 填 target keys

已完成：

- `withMutationLock(task, targetKeys?)`；
- create 传 `skill::name`；
- update UnitTransaction 传 `skill::name`；
- patch UnitTransaction 传 body/support key；
- writeSupport UnitTransaction 传 support key；
- patch no-op / 既有行为不变；
- 生产 HomeFence lock 忽略 targetKeys，因此行为仍与之前一致。

验证：

```text
tool observed + skill-store-cas: 8 passed
overlay build:                    0
```

边界：

- 还没有用 `TargetMutationLock` 装配 SkillLibrary；
- root gate/target lock 与 HomeFence 仍同时存在；
- 未 bump 版本，未发布。

### 2026-11-20：Phase E.5 UnitTransaction 传递 target keys

已完成：

- `MutationUnitOptions.targetKeys?: readonly string[]`；
- MutationUnit 在 apply / revert / undo 三处 `lock.acquire()` 传入 targetKeys；
- 测试：
  - keyed lock 收到 `['skill::source']`；
  - 未配置时收到 `undefined`，保持旧行为。

验证：

```text
mutation-unit: 24 passed
overlay build: 0
```

边界：

- SkillLibrary 还未填 targetKeys；
- 生产 HomeFence global lock 忽略 keys；
- keyed 模式需显式装 `TargetMutationLock`；
- 未 bump 版本，未发布。

### 2026-11-20：Phase E.4 MutationLockPort 支持 target keys

已完成：

- `MutationLockPort.acquire(targetKeys?: readonly string[])`；
- 新增 `TargetMutationLock` 适配 `TargetLockSet.acquireLease`；
  - 空 key 集合直接拒绝，避免无锁写；
- 3 个测试：空 key 拒绝、同 key 串行、不同 key 并行。

验证：

```text
mutation-authority-target-lock: 3 passed
overlay build:                  0
```

边界：

- 还没有 UnitTransaction/SkillLibrary 调用方传 targetKeys；
- 生产仍用 HomeFence global lock；
- 未 bump 版本，未发布。

### 2026-11-20：Phase E.3 target lock lease

已完成：

- `TargetLockSet.acquireLease(keys)`：
  - 返回可跨 await 持有的 lease；
  - 多 key 排序获取，失败时释放已获取 key；
  - release 幂等；
  - 保留 in-process per-key FIFO 与跨进程 file lock。
- 新增 2 个测试：
  - 同 key 第二个 lease 等待第一个 release；
  - 多 key lease 释放后可重新获取，队列清零。

验证：

```text
authority-target-locks: 5 passed
overlay build:          0
```

边界：

- 仍是 kernel，没有接 MutationLockPort；
- 生产 HomeFence global lock 未改；
- 未 bump 版本，未发布。

### 2026-11-20：Phase E.2 target lock kernel

已完成：

- `authority.ts` 新增 `TargetLockSet`：
  - `<home>/.authority/targets/<sha256(key)>.lock`；
  - 多 key 去重 + 字典序获取；
  - 进程内按 key FIFO；
  - 跨进程 platform file lock；
  - `size` 泄漏断言。
- 3 个单测：同 key 串行、不同 key 并行、多 key 反向顺序不死锁。

验证：

```text
authority-target-locks: 3 passed
overlay build:          0
```

边界：

- 只是 kernel，尚未接入 MutationAuthority / UnitTransaction；
- HomeFence global tree lock 仍包住所有 skill 写；
- 未 bump 版本，未发布。

### 2026-11-20：Phase E.1 scoped authority 设计

目标：让不同 skill target 的写入跨进程并行，同时保留同 target 互斥与结构操作互斥。

### 锁模型

```text
HomeAuthority
  tree global lock      <home>/.authority/home.lock
  target lock(file)      <home>/.authority/targets/<sha256(targetKey)>.lock
  state lock             <home>/.authority/state.lock
```

- targetKey 是 `skill::name` 或 `skill::name::path`；
- 每个 target 一个 lock file；
- 不同 target 的 lock file 独立，因此不同 skill 可以并行；
- 结构操作需要锁住它影响的全部 target：
  - archive/restore：目标 skill 的 body key（以及该 skill 所有 support key？见下）；
  - consolidate/commitMerge：target + 所有 sources；
  - restructure/extract：source + target；
- 多 target 按字典序获取，逆序释放，避免死锁。

### 结构操作与 support 的问题

一个 skill 的 support 文件与 body 共享目录，archive 会移动整棵树。因此：

- archive/restore 除了 body target，还需覆盖该 skill 的所有 **已知 support key**；
- 未知/新增 support 在 archive 时可能漏锁；
- 解决：结构操作额外持有一个 **skill namespace lock**（`skill::name::*`），simple support 写同时持 namespace lock 的 shared 语义；
- 平台只有 exclusive file lock，没有 shared；因此先采用简化协议：
  - simple 写：target lock；
  - 结构操作：skill namespace lock（exclusive）+ 所有已知 target lock；
  - simple support write 在 target lock 之外再取 namespace lock（exclusive）——会与同 skill body 写串行，但不同 skill 仍并行。

### HomeAuthority API 变更

```ts
runExclusive(scope, body)
runTargets(targetKeys: readonly string[], body)  // sorted exclusive target locks
runNested(...)
```

- `runTargets` 内部：去重 → 排序 → 逐个获取 keyed file lock → 执行 → 逆序释放；
- in-process FIFO 按 key；不同 key 不排队；
- state 锁仍在 target 锁内层；
- global tree 锁只用于 snapshot/retention/跨树操作，不再包住普通 skill 写。

### MutationAuthority / UnitTransaction 接线

- `MutationLockPort.acquire(targetKeys?: readonly string[])`；
- SkillLibrary 为每次 simple 写传一个 key；
- UnitTransaction 把 `targetKeys` 传给 lock port；
- 结构操作传 skill namespace key + 已知 support keys；
- recovery / snapshot 继续使用 global tree lock。

### 失败与回退

- 旧部署若没有 keyed lock API：回退到 global tree lock（当前行为）；
- 任一 key 获取超时 → AuthorityBusyError；
- 结构操作锁集不完整 → 拒绝并明确提示，不降级为无锁；
- 迁移期间不混用 global + keyed；
- 全量测试覆盖同 target/不同 target/跨进程/结构阻塞。

### 2026-11-20：Phase D.5f 剩余串行的真实位置

新事实（读 `authority.ts` / `mutation-authority.ts`）：

- simple mutator 移除 serial 后仍无并行，根因不在 SkillLibrary：
  ```text
  MutationAuthority.mutationLock
    → HomeFence.acquire()
    → HomeAuthority.runExclusive('tree')
    → 固定锁文件 <home>/.authority/home.lock
  ```
- 该锁是 home-wide、跨进程唯一；所有 `UnitTransaction` / create / update / patch / support 写都经过它。
- 因此 per-target lock 只能做进程内同 target 串行，不能带来跨进程并行。

设计选择：

1. **保留 HomeFence root 锁**（当前）：正确性最好，跨进程简单，但没有并行收益；
2. **Scoped authority**：为每个 skill target 建独立锁文件，同时保留一个全局 tree intent 锁；
   - 结构操作取全局 exclusive；
   - simple 取 target lock，并检查全局 intent；
   - 需要跨进程读写锁语义，不能只用单文件 lock；
   - 是新的 authority 层重构，不是 SkillLibrary 局部改动。

当前决定：

- 不把 HomeFence 偷偷降级成进程内锁；
- 先把 scoped authority 作为独立设计项，不在本轮改；
- 现有 target lock / root gate 保留，作为未来 scoped authority 的进程内部分。

### 2026-11-20：Phase D.5e simple mutator 移除 root serial

已完成：

- `setPinned` / `create` / `update` / `patch` / `writeSupportFile` / `removeSupportFile` 移除 `this.serial(...)`；
- 现在 simple 写锁顺序：
  ```text
  rootGate.read
    → target lock
      → core / UnitTransaction
  ```
- `restructure` / `extract` 改持 root exclusive；extract 拆出 `extractCore` 供持门调用；
- 结构操作 `archive` / `restore` / `commitMerge` / `consolidate` 继续 root exclusive；
- root serial 仍保留给结构操作和尚未迁移路径。

验证：

```text
tool-skill-manage + observed writes: 46 passed
skill-store-serial + consolidate:   17 passed
overlay build:                      0
```

重要事实：

- 移除 serial 后仍**没有实际并行写**：
  - UnitTransaction / create 仍使用 per-root mutationLock；
  - 该锁是跨进程 root 互斥，简单目标锁无法绕过；
- 因此这一步消除了 root serial 的重复排队，但真正并行还差“per-target mutation lock”。

下一组：

- D.5f：把 `lockPort()` 的 root 文件锁替换为 per-target mutation lock；
- 保留 transactIo / HomeFence；
- 不同 target 并行、同 target 串行、跨进程同 target 仍互斥。

### 2026-11-20：Phase D.5d simple mutator 持 root shared

已完成：

- `setPinned` / `create` / `update` / `patch` / `writeSupportFile` / `removeSupportFile` 增加 root shared 外层；
- 锁顺序固定为：
  ```text
  rootGate.read
    → root serial
      → target lock
        → core
  ```
- `consolidate` 外层持 root exclusive；
- consolidate 内部的 archive/restore 改为 `rootHeld=true` 内部路径，避免重新取门；
- 结构操作仍同时持有 serial，simple 仍同时持有 serial，所以本轮**仍无并行收益**，但 root gate 已覆盖读写两侧。

验证：

```text
skill-store-serial + skill-consolidate: 17 passed
tool observed + skill-write-service:   10 passed
overlay build:                          0
```

边界：

- simple 还没有移除 serial；
- restructure/extract 尚未持 root exclusive；
- 删除 serial 前必须先给 restructure/extract 补门；
- 未 bump 版本，未发布。

### 2026-11-20：Phase D.5c archive/restore/commitMerge 持 root exclusive

已完成：

- `archive` / `restoreFromArchive` 增加 `rootHeld` 参数：
  - 默认取 `rootGate.write`；
  - 已持门调用方传 `rootHeld=true` 走内部路径，避免 non-reentrant deadlock。
- `commitMerge`：
  - `serialized:true` → 视为已持门，直接执行；
  - 否则 `rootGate.write` + serial；
  - 内部 archive/restore 传 `rootHeld`，不再重新取门。
- 既有 `skill-store-serial` / `skill-consolidate` 测试全部通过，consolidate 未自死锁。

验证：

```text
skill-store-serial + skill-consolidate: 17 passed
overlay build:                          0
```

边界：

- simple mutator 仍只走 root serial，尚未持 root shared；
- 因此 root gate 尚未与 simple 写互斥；
- restructure/extract 尚未持 root exclusive；
- 未 bump 版本，未发布。

### 2026-11-20：Phase D.5b.1 support 写/删持 target lock

已完成：

- `writeSupportFile`：在现有 UnitTransaction 外持 `skill::name::path` target lock；
- `removeSupportFile`：在 root serial 内持同一 target key；
- 这样 service 与 library 对 support 文件的锁键完全一致。

验证：

```text
tool observed writes: 4 passed
overlay build:        0
```

边界：

- 结构操作（archive/restore/consolidate/commitMerge）仍无 root exclusive gate；
- root serial 仍保留；
- 尚无并行收益；
- 未 bump 版本，未发布。

### 2026-11-20：Phase D.5a simple mutator 持 target lock

已完成：

- `SkillLibrary` 增加过渡 targetLocks；
- `setPinned` / `create` / `update` / `patch` 在现有 root serial 内再持对应 targetKey 锁：
  - `pin::name`；
  - `skill::name`；
  - support patch 使用 `skill::name::path`；
- 这一轮**不删除 root serial**，只让 library 与 service 共享同一 targetKey 语义；
- 结构操作（archive/restore/consolidate）仍走旧 serial，避免 non-reentrant deadlock。

验证：

```text
skill-store-cas + tool observed writes: 8 passed
overlay build:                           0
```

边界：

- target lock 与 root serial 同时存在，尚无并行收益；
- writeSupportFile / removeSupportFile 的 target lock 与 structural gate 在下一轮接；
- 未 bump 版本，未发布。

### 2026-11-20：Phase D.4 锁替换前的重入地图

替换 per-root serial 前，先固定现有调用图（避免把 deadlock 从 serial 搬到 gate）：

| 入口 | 当前临界区 | 内部是否调用其它 mutator | 新锁归属 |
|---|---|---|---|
| `create` | serial + mutationLock | `createCore` 不调 mutator | root shared + body target |
| `update` | serial | `updateCore` | root shared + body target |
| `patch` | serial | `patchCore` | root shared + body/support target |
| `writeSupportFile` | serial?（当前无 serial，内部 unit） | `writeSupportFileCore` | root shared + support target |
| `removeSupportFile` | serial | `removeSupportFileCore` | root shared + support target |
| `setPinned` | serial | `setPinnedCore` | root shared + marker target |
| `archive` | 无 serial（调用方负责） | `archiveCore` | root exclusive |
| `restoreFromArchive` | 无 serial | `restoreFromArchiveCore` | root exclusive |
| `consolidate` | serial | 内部调用 `archive()` | root exclusive；archive 必须走“已持门”内部路径 |
| `commitMerge` | serial（除非 serialized:true） | `archive()` / `restoreFromArchive()` | root exclusive；nested 走内部路径 |
| `restructure` / `extract` | mutation unit / 调用方锁 | `archive` / `update` | root exclusive 或统一 unit 锁 |

关键约束：

1. `SkillRootGate` 与 `SkillTargetLocks` 都不可重入；
2. consolidate/commitMerge 不能再调用会重新取根的 `archive()`；必须抽 `archiveUnderExclusive()` 或让 archive 接受 `rootHeld: true`；
3. `commitMerge` 的 `serialized:true` 语义要改为 `rootHeld:true`；
4. 结构操作必须先取 root exclusive，再取 target 锁；simple 操作只取 root shared + target；
5. 跨进程 `transactIo`/HomeFence 保持在 gate 内层，不能反向获取 gate；
6. 迁移期间 serial 与 gate 不能同时生效，否则同一写会双重排队且重入风险翻倍；
7. 先按 mutator 分组切换，每组跑定向并发测试；全部切换后再删 ROOT_SERIAL。

下一组实施顺序：

- D.5a：create/update/patch/writeSupport/removeSupport/setPinned 切 root shared + target；
- D.5b：archive/restore 切 root exclusive，consolidate/commitMerge 改内部路径；
- D.5c：restructure/extract/unit 操作接入；
- D.5d：删除 ROOT_SERIAL，保留 transact/HomeFence。

### 2026-11-20：Phase D.3 root shared/exclusive 门

已完成：

- 新增 `packages/evolution-core/src/skill-root-gate.ts`：
  - 单文件写持 shared lease；
  - archive/restore/consolidate 持 exclusive lease；
  - 排队公平：已有 waiter 时新 reader 不插队；
  - non-reentrant 约定。
- 4 个单测：shared 并行、writer/reader 互斥、writer 活跃时 reader 不进入、租约不泄漏。

边界：

- 门已作为原语存在，尚未替换 SkillLibrary 的 per-root serial；
- 还没有把 simple mutator 改成 shared + per-target lock；
- 未 bump 版本，未发布。

### 2026-11-20：Phase D.2 service 持有 target lock

已完成：

- `SkillWriteService` 注入 `SkillTargetLocks`；
- `updateBody` / `patchBody` / `updateSupport` / `removeSupport` 在 library mutator 外层持有对应 targetKey 锁；
- 当前 library 内部仍有 per-root serial，所以这一步是过渡层：
  - service 的 target lock 保证同一 target 的 service 写串行；
  - 不同 target 是否并行仍受 library serial 限制；
  - 验证语义正确后再拆 library per-root serial。

验证：

```text
skill-write-service + skill-target-locks: 9 passed
overlay build:                            0
```

边界：

- 尚未替换 library 内部 serial；
- 多文件 unit 尚未接入 withLocks；
- 审批 replay 仍走旧路径。

### 2026-11-20：Phase D.1 per-target 锁原语

已完成：

- 新增 `packages/evolution-core/src/skill-target-locks.ts`：
  - `withLock(targetKey, task)`；
  - `withLocks(targetKeys, task)`：去重 + 字典序获取；
  - `size` 泄漏断言；
  - 多 target 获取按序、释放逆序；
- 4 个单测：
  - 同 target 串行；
  - 不同 target 并行；
  - 相反顺序的多 target unit 不死锁；
  - 去重且队列清空。

边界：

- 这是纯锁原语，尚未替换 SkillLibrary 的 per-root serial；
- 尚未与 transactIo / HomeFence 组合；
- 未 bump 版本，未发布。

### 2026-11-20：Phase C.8 remove_file 接入 observation

已完成：

- `SkillWriteService.removeSupport`：
  - `requirePresent(owner, support target)`；
  - 未观察 → `SKILL_NOT_OBSERVED`；
  - absent → `SKILL_NOT_FOUND`；
  - 版本通过 anchor 交给 `removeSupportFile`；
  - 成功后记录 `absent`。
- `tool-skill-manage` 的 `remove_file` 在 owner + 非 replay 时走 service；
- tool 测试新增：
  - ownerA 写 support 后，ownerB 未读 remove → NOT_OBSERVED；
  - ownerA 观察后 remove → 成功。

验证：

```text
tool observed writes: 4 passed
overlay build:        0
```

边界：

- approval replay 仍走 staged anchor；
- create / unit / AUX owner / per-target lock 仍待后续。

### 2026-11-20：Phase C.7 收紧 fallback（取代 C.6 的过渡结论）

已完成：

- tool-skill-manage 的 update / body patch / write_file 在 owner 存在时不再检查“是否有 observation”，直接进入 service：
  - 无 observation → `SKILL_NOT_OBSERVED`；
  - 有 observation → content anchor + stale；
- create 成功后立即 `observeBodyWrite`；
- write_file 对“新 support 文件”由 service 做 createIfAbsent；已存在但未读的 support 文件仍拒绝；
- patch no-op 不再在 service 层提前拒绝，保留 library 的 `noop:true` 语义；
- `SkillActionResult` 的 `noop` 通过 service result 透传，usage patch_count 不再误增；
- 测试 helper 的 `fakeAgent` 改为稳定 session，模拟真实长生命周期 owner。

验证：

```text
tool-skill-manage:                 42 passed
skill-write-service:               5 passed
tool observed writes:              3 passed (含未读拒绝、第二写者 stale)
overlay build:                     0
verify-doc-facts:                  0 violations
```

边界：

- 审批 replay（无 owner / staged anchor）仍走旧路径；
- create / remove_file / unit / AUX owner 的收口仍在后续 Phase；
- 未 bump 版本，未发布。

### 2026-11-20：Phase C.6 写后观察与 fallback 收紧评估


已完成：

- `SkillWriteService` 的 update / patch / updateSupport 成功后重新 `read` 并记录新观察；
- tool 的 create / write_file fallback 成功后调用 `observeBodyWrite` / `observeSupportWrite`；
- 同一 owner 连续写不再因为“写后未重新观察”而假 stale。

验证：

```text
tool-skill-manage + observed writes: 44 passed
overlay build:                      0
```

fallback 收紧评估：

- 尝试直接把“无 observation”全部改为 `SKILL_NOT_OBSERVED`；
- 现有测试里 `fakeAgent(undefined)` 每次调用都生成新的 session 对象，create 与后续 patch 不是同一 owner，因此测试表现为“未读”；
- 这暴露的是测试 fixture 不模拟真实长生命周期 session，不是 service 逻辑错误；
- 该过渡结论已被 Phase C.7 取代：测试 helper 已改为稳定 session，fallback 已收紧。

### 2026-11-20：Phase C.5 tool 级 observation/CAS 证据


已完成：

- 新增 `tool-skill-manage/tests/skill-observed-writes.spec.ts`：
  - 创建 skill → 无 observation 的 update 走旧路径成功（过渡 fallback）；
  - 同一 owner 收到 `fs/observed` 后 update 成功，磁盘内容为 observed 版本；
  - 两个 owner 都观察同一版本 → 第一个 update 成功，第二个返回 stale（中文“读取之后被改动过”）。
- 这证明 tool 层已经真实走通：
  ```text
  platform read → fs/observed → store(content hash)
  → tool update → SkillWriteService → library.update(anchor)
  → 第二个 owner stale
  ```

验证：

```text
skill-observed-writes: 2 passed
tool-skill-manage:     42 passed
overlay build:         0
```

边界：

- 无 observation 仍是旧路径，fallback 尚未收紧；
- `remove_file` / create / approval / unit / AUX owner 尚未切；
- 未 bump 版本，未发布。

### 2026-11-20：Phase C.4 tool 层开始消费 observation

已完成：

- `tool-skill-manage` apply 内创建唯一：
  - `SkillObservationStore`
  - `installSkillObservationListener(ctx, library.root, store)`
  - `SkillWriteService(library, store)`
- `executeCore` 增加可选 `owner`（`exec.agent?.session`）；
- `update` / body `patch` / `write_file` 在以下条件走 service：
  - 有 owner；
  - 没有 approval 的 `staged_from_sha256`（replay 仍走旧 anchor）；
  - 该 owner 对目标已有 observation。
- 其余情况保持现有 library 路径：这是**过渡期 fallback**，用于不读直写、审批 replay、无 session 的旧路径。
- `skill-observations` listener 现在接收外部 store，避免 plugin 内部两个 store。

验证：

- `tool-skill-manage.spec.ts`：42 passed（含 no-op、replace_all、审批 replay、staged anchor 回归）；
- build 0。

边界：

- 有 observation 时：走 service + content anchor + 锁内 stale；
- 无 observation 时：仍走旧 read gate/旧路径，尚未实现 goal E 的“未读一律 NOT_OBSERVED”；
- `remove_file` / create / approval / unit / AUX owner 仍未切；
- 未 bump 版本，未发布。

### 2026-11-20：Phase C.3 通用 read 的 content observation

已完成：

- `skill-observations.ts` 的 `fs/observed` listener 不再直接记录平台 token；
- 新增 `skillPlatformVersion(hostPath)`：用 Node bigint stat 复现平台 `dev:ino:size:mtimeNs:ctimeNs`；
- listener：
  1. 映射 host path → skill target；
  2. 平台版本匹配后才同步读文件；
  3. 读后再校验版本；
  4. 记录 `contentHash(bytes)`；
- 任一版本不一致、读失败、非 skill 文件、无 actor 都不记录；
- 测试更新为真实临时文件 + 真实平台版本：content hash 记录、owner 隔离、非 skill/absent/无 actor、版本漂移不记录。

边界：

- 这是 observation 层的安全读取，不是写路径；
- 大文件 / 非本地 backend 未覆盖：不记录（宁缺勿错）；
- tool 层仍未切换到 service。

### 2026-11-20：Phase C.2 服务改用现有 mutator 的锁内 anchor

已完成：

- `SkillLibrary.patch` 增加可选 `WriteAnchor` 参数；
- `patchCore` 在锁内读当前内容后、literal 匹配前检查 anchor：
  - 不一致 → `stale` / `anchor`；
  - 与 `update` / `writeSupportFile` / `removeSupportFile` 的 anchor 语义一致。
- `SkillWriteService` 不再走原始 `writeFileCas`：
  - `updateBody` → `library.update(..., { sha256: observed })`；
  - `patchBody` → `library.patch(..., { sha256: observed })`；
  - `updateSupport` → `library.writeSupportFile(..., { sha256: observed })`。
- 这样 service 复用了已有的：
  - protection / badName / frontmatter / threat / limits 校验；
  - UnitTransaction、audit、mutation event、history；
  - serial + mutation lock + transact。
- 新增服务测试仍全部通过：未读、owner 隔离、第二个 stale、absent support、patch/no-op。

边界：

- service 尚未被 tool 层调用；
- `patchBody` 的 no-op 在 service 层先返回 `SKILL_INVALID`，不改 library 现有 noop 语义；
- `create` / `remove` / 审批 / unit 尚未接入；
- 平台 FsVersion 与 content sha 已在 DCR-1 定格：平台版本仅作捕获栅栏，observation 使用 content sha。

### 2026-11-20：Phase C.1 SkillWriteService 读观察 + CAS

已完成：

- 新增 `packages/evolution-core/src/skill-write-service.ts`
  - `SkillWriteService`：readBody / readSupport 记录 owner 观察；
  - updateBody / patchBody / updateSupport 从观察取 expected，调用 `SkillLibrary.writeFileCas`；
  - 错误码：`SKILL_NOT_OBSERVED` / `SKILL_NOT_FOUND` / `SKILL_STALE_VERSION` / `SKILL_ALREADY_EXISTS` / `SKILL_AMBIGUOUS_EDIT` / `SKILL_EDIT_NOT_FOUND` / `SKILL_INVALID`；
  - 尚未接管 create / remove / 审批 / unit / tool 层。
- 5 个服务测试：
  - 未读写拒绝；
  - owner 隔离；
  - 两 owner 同版本，第二个 stale；
  - absent support 观察 + 写拒绝；
  - patch 成功 / no-op 拒绝。

边界：

- 服务是新增层，tool 层仍走原有路径；
- `writeFileCas` 的版本仍按 contentHash 计算；平台 FsVersion 只在 observation 捕获栅栏中使用。
- 没有改变任何现有 create/update/patch 行为。

### 2026-11-20：Phase B.2 存储层锁内 CAS 原语

已完成：

- `SkillLibrary.writeFileCas(rawName, filePath, intent)`：
  - 复用 `serial` + `withMutationLock`；
  - 有 `transact` 时在事务回调内读、决策、写；
  - 无 `transact` 时在同一锁内 read → decide → write；
  - 目标版本在存储层按 `contentHash(current)` 计算，调用方传入 content version；
  - 不写 audit/event，不替代现有 create/update/patch；
- 4 个并发测试：
  - 两个同 expected 的 replace，只有一个成功，另一个 stale；
  - 两个 createIfAbsent，只有一个成功；
  - 版本变化时不同区域 edit 仍 stale；
  - 多匹配 edit 拒绝。

边界：

- 这是 Phase B 的底层原语，尚未被 tool 层调用；
- 现有 create/update/patch 行为未变；
- `transact` 缺失时仍只有进程内锁，跨进程语义沿用现有 IO 配置；
- 平台 FsVersion 只在 observation 捕获栅栏中使用；写 CAS 统一用 content version。

### 2026-11-20：Phase B.1 纯写意图原语

已完成：

- 新增 `packages/evolution-core/src/skill-write-intent.ts`
  - `SkillWriteCurrent`：present(version, content) / absent；
  - `SkillWriteIntent`：createIfAbsent / replaceIfVersion / editIfVersion；
  - `decideSkillWrite(intent, current)`：纯决策，无 IO、锁、session；
  - `decideLiteralEdit()`：版本校验后唯一匹配 / 显式 replaceAll；
  - `skillContentVersion()`：LF 归一 sha256。
- 语义与平台 edit 对齐：
  - **先版本，后 old_string**；不同区域但版本变化仍 stale；
  - 默认唯一匹配；
  - 未匹配 / 歧义 / 空 old_string / no-op 都是 typed refusal；
  - version 在纯原语中保持 opaque，调用方决定平台 FsVersion 还是 content sha。
- 7 个单测：create、replace、版本先于匹配、唯一/多匹配、replaceAll、非法输入、内容版本。

边界：

- 尚未接入 SkillLibrary/tool；
- 尚未有锁；
- 尚未改变任何现有写入行为。

### 2026-11-20：Phase A.4 平台观察订阅

已完成：

- 新增 `packages/tool-skill-manage/src/skill-observations.ts`
  - `installSkillObservationListener(ctx, root)`；
  - 订阅平台 `fs/observed`；
  - owner = `actor.agent.session`；
  - 只接受 `present` 观察，交给 `recordFsSkillObservation`；
  - store 随插件 effect dispose 清空。
- `tool-skill-manage` apply 时安装 listener；
- 3 个集成测试：同一 session 记录 body/support 版本、不同 session 不共享、非 skill 路径/absent/无 actor 不记录。

边界：

- listener 只记录，**不参与写入判定**；
- store 目前是 tool plugin 内部对象，尚未暴露给 SkillWriteService；
- 平台 `FsVersion` 只用于 observation 捕获栅栏；写 CAS 使用 content version。

### 2026-11-20：Phase A.2 平台观察入口映射

已完成：

- 新增 `packages/evolution-core/src/skill-observation-source.ts`
  - `skillTargetFromHostPath(root, hostPath)`：把平台 `fs/observed` 的 host path 映射为 `SKILL.md` / support-file target；
  - 拒绝 root 外路径、root 自身、root 直属文件、相对路径；
  - `recordFsSkillObservation(store, owner, root, observation)`：把平台 version 记为 present observation。
- 7 个单测：body/support 映射、root 外拒绝、root 自身/直属文件拒绝、非法输入、非 skill 文件不记录、平台 token 保持 opaque。

边界（刻意不做的）：

- 尚未订阅 `fs/observed`；只是纯映射/记录入口；
- 尚未决定 observation version 的最终模型；
- 尚未改变任何写入行为。

Phase A.3 需要先解决的设计选择：

- 平台 `fs/observed` 的版本 token 是同步可得的，但不等于 skill 内容 sha；
- 读工具可能是部分读，不能从结果文本安全推导整文件内容 hash；
- 因此必须先定：
  1. 平台 opaque `FsVersion` 作为 freshness token，写路径走平台 fs 的 CAS；或
  2. 内容 sha256 作为唯一 version，并只在能同步取得完整内容时授权。
- 本选择会影响 `SkillWriteService` 的 CAS 落点，不能在代码里混用两种 token 语义。

### 2026-11-20：Phase A.1 观察模型落地

已完成：

- 新增 `packages/evolution-core/src/skill-observation.ts`
  - `SkillTarget` / `skillTarget()` / `skillBodyTarget()` / `skillSupportTarget()`
  - `SkillContentVersion`：复用 `mutations.contentHash`，LF 归一后 sha256
  - `SkillObservation`：`present(version)` / `absent`
  - `SkillObservationStore`：按 owner WeakMap 隔离、`record` / `get` / `requirePresent` / `clear`
- 从 `evolution-core/skills` 子路径导出；
- 新增 9 个单测：body/support target 归一、路径逃逸拒绝、owner 隔离、absent、CRLF 同 hash、重读覆盖、clear。

边界（刻意不做的）：

- 本阶段**没有记录 read 观察**，也没有改变任何写入行为；
- 没有引入锁、CAS、enforcement；
- 现有 read gate / staged anchor / SkillLibrary 行为保持不变。

下一步 Phase A.2 的开放问题：

1. 通用 `read` 工具（平台 `read`）如何把“读到内容”变成 observation：
   - 平台 `fs/observed` 事件是同步 recorder，只带 `FsVersion`，不带内容；
   - 不能让异步读取成为写的授权来源（产生竞态）；
   - 需要在 `fs/observed` 的 opaque version 与 skill content sha 之间选一个统一版本模型，或在平台读结果投影中取内容 hash。
2. `skill_manage` 自己的 `list/review` 读路径是否算 observation：
   - 只授权“读到的那一个 target”，不把目录扫描扩大成整树授权；
   - support file 必须显式 read。
3. HMR/dispose 清空 owner 的接入点：
   - `SkillObservationStore` 已提供 `clear()`，生命周期挂载待 Phase A.2 设计。

约束更新：

- 路径归一必须拒绝 `..` 和绝对路径，不能把不同 target 折叠成同一个 key；
- 版本比较必须先于 `old_string` 匹配，不能在 Phase A.2 提前改变写入顺序；
- 任何 observation 的授权来源必须同步可得；fire-and-forget 的异步 hash 不能作为安全许可。

