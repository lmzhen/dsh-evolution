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

