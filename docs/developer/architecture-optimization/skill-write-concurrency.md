# Skill 写入并发与防双写：综合优化方案

> 状态：**设计提案（未实施）**
> 范围：`skill_manage` 的 create / update / write_file / patch / remove_file，以及所有直接调用 `SkillLibrary` 的写路径（AUX、curator、merge、learning graph、extract）。
> 目标：后台多 session/agent 并发修改或创建 skill 时，结果可解释、无静默丢更新、无静默语义合并；长期只保留一个写入权威层。

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
