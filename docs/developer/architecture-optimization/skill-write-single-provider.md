# Skill 写入单 Provider 收敛方案

> 状态：**设计提案（未实施）**
> 范围：`skill_manage` 全部写动作、审批 replay、curator / merge / undo / learning-graph 等直接调用 `SkillLibrary` 的写路径。
> 上游基线：`harness-rc3` 的 `fs-local`、`fs-observation-policy`、`tool-fs`、`tool-str-replace-editor`。
> 问题台账与历史决策：见同目录 [skill-write-concurrency.md](skill-write-concurrency.md)。

## 1. 结论

当前实现已经借用了上游最关键的三个原语：

- per-target promise lock；
- owner 隔离的 observation；
- `createIfAbsent` / `replaceIfVersion` + stale-before-match。

但**没有借到上游的“单 provider 权威”结构**。结果是：

- body update/patch 有 observation；
- support patch、section patch 仍绕过 observation；
- `write_file` 的 absent 分支没有 `createIfAbsent` intent；
- 同一个 target 同时存在多套锁；
- approval 的 anchor 按 action 分别手写，天然容易漏。

本方案不再逐条补漏。目标是把 `SkillLibrary` 改造成类似 `LocalFileSystem` 的唯一写入 provider，把 `SkillWriteService` 改造成类似的 intent 层，tool 只做参数、审批和展示。

一句话：

> **所有 skill 写入都变成一个带显式 intent 的 `SkillWritePlan`，由唯一的 provider 在同一把 target lock 下校验并提交。**

## 2. 设计原则

1. **一个写入口**：`SkillLibrary.apply(plan)`。tool 不直接调用任何内容 mutator。
2. **一个 target 身份**：realpath / nearest-ancestor 解析一次，observation、锁、unit、审批共用。
3. **一个锁表**：in-process per-target 锁只放在 provider；service 不持锁。
4. **intent 必填**：不存在“无 anchor 的 update/patch/support write”公共 API。
5. **观察只由读和写结果产生**：写前不再把“读过名字”重新读成当前版本。
6. **审批存计划**：pending 记录保存完整 `SkillWritePlan`，replay 不再按 action 拼 anchor。
7. **unit 是唯一提交单位**：单文件写也是一个 op 的 plan；多文件写是多个 op 的 plan。
8. **结构操作单独 gate**：restructure / merge / extract 继续走 RootGate；普通文件写不再叠加 root 串行。

## 3. 目标架构

```text
tool-skill-manage（adapter）
  参数校验 / 审批 staging / 展示 / read gate
  不直接调用 SkillLibrary 的内容 mutator
        │
        │ SkillWritePlan
        ▼
SkillWriteService（authorization）
  readBody / readSupport
  observation → intent
  plan(action, args, owner)
  apply(plan)
        │
        │ SkillWritePlan（ops + intents）
        ▼
SkillLibrary（provider / kernel）
  唯一的 target lock table
  apply(plan)
  UnitTransaction / audit / history / CAS
        │
        ▼
IO + MutationUnit + transact + HomeFence
  durable temp + fsync + rename
  跨进程 file lock
```

角色对应：

| 本家族 | 上游 |
|---|---|
| `SkillLibrary` + `MutationUnit` | `LocalFileSystem` + `fsio.writeFileAtomic` |
| `SkillWriteService` + `SkillObservationStore` | `fs-observation-policy` + `tool-fs` 的 intent 组装 |
| `tool-skill-manage` | `tool-fs` 的参数层 |
| `SkillWritePlan` | `FsWriteIntent` / `FsEditRequest` 的上层组合 |

不直接用平台 `ctx.fs` 替换 skill provider：平台 fs 有 target lock 和 observation，但没有 skill history、audit、多文件 unit、merge undo；换过去会把两套事务混在一起。这里只借鉴语义，不复制对象。

## 4. 核心类型

### 4.1 复用已有原语（读完代码后的修正）

本方案最初草案把 `SkillWriteIntent` 当成新类型引入；阅读现有实现后修正：仓库已经有三个可复用的底层原语，不能重复造。

- `packages/evolution-core/src/skill-write-intent.ts`
  - `SkillWriteIntent`：`createIfAbsent` / `replaceIfVersion` / `editIfVersion`；
  - `decideSkillWrite()`：锁内对 current 做版本判断，`editIfVersion` 先比版本再匹配 old_string；
  - `decideLiteralEdit()`：唯一的 literal patch 语义。
- `packages/evolution-core/src/write-kernel.ts`
  - `WriteKernel.writeOne/commit/restore`：CAS、单 target 写、多 target 预检、只补偿本 unit 已写目标。
- `packages/evolution-core/src/mutation-unit.ts`
  - 已使用 `WriteKernel`，并提供 UnitTransaction、audit、history、跨进程 target lock、journal、恢复。

因此，本方案**不再新增底层 intent / CAS / 写内核**：

- plan 层只负责“领域动作 + 期望版本”；
- provider 在锁内把 plan op 转成现有 `SkillWriteIntent`，交给 `decideSkillWrite()`；
- 提交继续走 `MutationUnit` → `WriteKernel`；
- 不复制 `decideSkillWrite` 的 stale-before-match 逻辑，也不复制 `WriteKernel` 的补偿逻辑。

这是一次设计修正，不改变“单 provider”的结论；它避免计划文档与实际代码出现两套 intent。

### 4.2 plan 层类型

```ts
type SkillWriteExpect =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly version: string }

type SkillWriteOp =
  | { readonly kind: 'createSkill'; readonly skill: string; readonly content: string; readonly managed?: boolean }
  | { readonly kind: 'write'; readonly target: SkillTarget; readonly content: string; readonly expect: SkillWriteExpect; readonly create?: boolean }
  | { readonly kind: 'patch'; readonly target: SkillTarget; readonly oldString: string; readonly newString: string; readonly replaceAll: boolean; readonly expect: { readonly kind: 'present'; readonly version: string } }
  | { readonly kind: 'patchSection'; readonly target: SkillTarget; readonly section: SkillSectionEdit; readonly expect: { readonly kind: 'present'; readonly version: string } }
  | { readonly kind: 'remove'; readonly target: SkillTarget; readonly expect: { readonly kind: 'present'; readonly version: string } }

interface SkillWritePlan {
  readonly origin: WriteOrigin
  readonly ops: readonly SkillWriteOp[]
  readonly summary?: string
  readonly stagedAt?: string
}

interface SkillWriteOutcome {
  readonly op: SkillWriteOp
  readonly target: SkillTarget
  /** H1 wrapper leaves these empty; H5 fills them from the provider outcome. */
  readonly before?: string | null
  readonly after?: string | null
  readonly version?: string
  readonly noop?: boolean
}

interface SkillWriteResult {
  readonly ok: boolean
  readonly message: string
  readonly outcomes: readonly SkillWriteOutcome[]
  readonly warnings?: readonly string[]
  readonly stale?: true
  readonly noop?: boolean
  readonly normalizedFrontmatterFields?: readonly string[]
  readonly path?: string
}
```

plan op 到现有 intent 的映射固定：

| plan op | 现有 intent |
|---|---|
| `write` + expect absent | `createIfAbsent(next)` |
| `write` + expect present | `replaceIfVersion(expected, next)` |
| `patch` | `editIfVersion(expected, oldString, newString, replaceAll)` |
| `remove` | `deleteIfVersion(expected)`（扩展现有 intent；或 provider 内同一套版本判断） |
| `patchSection` | 锁内读 body → 版本判断 → `selectSections` → `replaceIfVersion(expected, next)` |
| `createSkill` | 走现有 `create` 路径，语义是 createIfAbsent + managed marker |

要点：

- plan 层不再出现 content 之外的 intent 分支；
- `createSkill` 与普通 `write` 分开，因为 create 需要 `.hermes-managed`、保护、审计等现有语义；
- patch 的 section/support 是显式 op，不再由 tool 分流；
- approval 保存 plan，而不是保存一堆 `staged_from_sha256` 特判字段；
- 旧 `SkillWriteIntent` 保持为底层决策原语，不把一个类型同时当“领域动作”和“锁内决策结果”。


## 5. Provider 执行算法

`SkillLibrary.apply(plan)` 是唯一写入口，顺序固定：

1. 校验 name / path / protection / caps；
2. 由 `SkillTargetResolver` 为每个 op 解析 target identity；
3. 收集全部 target keys，去重、字典序排序；
4. 一次性获取 per-target lock（多 op 只获取一次，不嵌套）；
5. 锁内读取每个 target 的当前 bytes；
6. 逐 op 校验 `expect`，并构造现有 `SkillWriteIntent` 交给 `decideSkillWrite()`：
   - absent：current 必须 absent；
   - present：current 必须 present 且 content hash 匹配；
   - patch 先比版本，再匹配 old_string；
   - section 先比版本，再做 `selectSections`；
7. 计算所有 next bytes，完成结构/内容校验；
8. 交给 UnitTransaction 一次提交；
9. 提交 audit、history、mutation event；
10. 返回每个 target 的 `before`、`after`、`version`。

任何一步失败：

- 整个 plan 不写；
- 不自动 rebase；
- 不部分提交；
- 补偿只针对本 unit 已写入的目标。

单文件更新只是 `ops.length === 1` 的 plan；不再有独立的简单写路径。

## 6. 锁与 target 身份

### 6.1 一个锁表

- 删除 `SkillWriteService.locks`；
- `SkillTargetLocks` 移到 provider 的 root 级 owner；
- 每个 root 只允许一个 lock table；
- `MutationUnit` 的跨进程 `TargetLockSet` 仍在 unit 内部，用同一组 target keys；
- RootGate 只保护结构操作，不再为普通写叠加 per-root 串行。

锁顺序：

```text
RootGate（仅结构操作）
  → SkillTargetLocks（provider，按 key 排序）
  → MutationUnit TargetLockSet（跨进程，按 key 排序）
  → transact / HomeFence
```

释放顺序与上游一致：内层先释放，外层后释放。

### 6.2 target identity

target identity 不能是 `name::relPath` 文本拼接。采用上游 `resolveLocalTarget` 的最近存在祖先 realpath 算法：

- 已存在文件：realpath(file)；
- 不存在文件：realpath(最近存在祖先) + 缺失后缀；
- 非 Node / fake IO：fallback 到规范化逻辑路径，并在 observation 中标记 weaker identity。

所有地方只允许 `SkillTargetResolver` 产生 target identity：

- `SkillObservationStore`；
- `SkillTargetLocks`；
- `MutationUnit` 的 targetKeys；
- approval 的 expected version；
- audit / history snapshot。

这样 symlink、大小写 alias、相对路径别名不会各自拿一把锁。

## 7. observation 与 intent

### 7.1 observation 的两个来源

1. **读**：
   - 平台 `fs/observed`；
   - `SkillWriteService.readBody/readSupport`；
   - 只记录实际读到的 bytes 的 content hash。

2. **写结果**：
   - `apply(plan)` 返回 `after`；
   - service 直接用 `after` 的 content hash 记录 present；
   - 不再在写后重新读文件。

写前禁止：

- 用 `readNames` / foreground 在 `executeCore` 里 `readBody` 制造 observation；
- 把“读过名字”当成“读过版本”。

### 7.2 legacy `skill` 读缺口

平台 `skill` 工具目前不产生 `fs/observed`，这是已知平台缺口。

本方案的处置：

- 不在 tool 写路径里局部兼容；
- 该兼容收敛到一个独立 `LegacySkillReadAdapter`，只在读发生的位置记录 observation，并标记 `source: 'legacy'`；
- 长期最优是上游让 `skill` read 也发出 `fs/observed`；插件侧无法凭空恢复读时版本；
- 在该缺口关闭前，文档明确写“legacy skill 读的 CAS 为 best-effort”，不把弱保证伪装成强保证。

### 7.3 写成功后的 observation

`SkillWriteService`：

```ts
const result = await library.apply(plan)
if (result.ok) {
  for (const outcome of result.outcomes) {
    observations.record(owner, outcome.target, {
      kind: 'present',
      version: outcome.version,
    })
  }
}
```

不再 `await readBody(...)`。observation 刷新失败不能把已提交的写变成失败；最多返回 warning。

## 8. 审批

### 8.1 存 plan，不存 action 特判

staging：

```ts
const plan = await service.plan(owner, action, args)
const staged = await approval.request({ kind: 'skill', plan, ... })
```

pending 记录保存 `plan`，每个 op 自带 intent。

replay：

```ts
const result = await service.apply(storedPlan)
```

任一 op stale 则整个 plan 拒绝；不自动重放旧 patch。

### 8.2 旧 pending 记录

没有 `plan` / 没有 intent 的旧记录：

- 明确拒绝；
- 提示重新发起写入；
- 不做无 anchor 回放。

这是安全方向的有意破坏性变更，发布说明必须写明。

## 9. 内部 system writer

curator、merge、undo、learning-graph 不是 session 读路径，不应强行走 observation 服务。

它们使用同一 provider，但用显式 intent：

```ts
interface SystemSkillWriter {
  apply(plan: SkillWritePlan): Promise<SkillWriteResult>
}
```

- 版本来自它们自己的 snapshot / anchor；
- 不构造伪 session observation；
- 仍经过同一锁、同一 unit、同一 audit/history。

这样“所有写只经 provider”成立，但不会把系统写强行塞进用户读模型。

## 10. tool 层

`tool-skill-manage` 的写动作收敛成表驱动：

```ts
interface SkillWriteAction {
  plan(args, owner): Promise<SkillWritePlan>
  present?(result): ...
}
```

流程：

1. 参数校验；
2. `service.plan(owner, action, args)`；
3. 审批开启 → `stage(plan)`；
4. 否则 → `service.apply(plan)`；
5. 展示结果。

删除：

- `patch` 按 `file_path` / `section` 的 library 分流；
- 每个 action 手写的 `staged_from_sha256`；
- 写前 `readBody/readSupport` seed；
- tool 对 `SkillLibrary` 内容 mutator 的直接调用。

## 11. 问题到方案

| 问题 | 方案 |
|---|---|
| support patch 绕过 observation | `patchSupport` op，必须 `editIfVersion` |
| section patch 无 read 要求 | `patchSection` op，必须 body observation |
| `write_file` absent 并发覆盖 | `createIfAbsent` intent，provider 锁内拒绝已存在 |
| legacy 读写前制造 observation | observation 只在读/写结果产生 |
| 写后 re-read 失败反向报错 | provider 返回 `after`/`version`，service 直接记录 |
| 多套 per-target 锁 | 只保留 provider 一套 |
| targetKey 非 realpath | `SkillTargetResolver` 统一 realpath |
| approval anchor 分支多 | approval 存 plan |
| 简单写与多文件 unit 两套路径 | 全部变成 plan，UnitTransaction 唯一提交 |
| 内部 system 写绕过 | `SystemSkillWriter.apply(plan)` |

## 12. 文件级改造

### `packages/evolution-core`

- `skill-store.ts`
  - 新增 `SkillWriteIntent` / `SkillWriteOp` / `SkillWritePlan` / `SkillWriteResult`；
  - 新增 `apply(plan)` 作为唯一内容写入口；
  - 现有 `update/patch/patchSection/writeSupportFile/removeSupportFile` 改为 private / `apply` 内部实现；
  - target lock table 放到 root 级 owner；
  - 删除重复的简单写包装。
- `skill-write-service.ts`
  - 删除 `locks`；
  - 新增 `plan()` / `apply(plan)`；
  - 新增 `patchSupport` / `patchSection`；
  - `writeSupport` absent 分支使用 `createIfAbsent`；
  - 写后 observation 使用 outcome。
- `skill-observation.ts`
  - target identity 改为 realpath/nearest-ancestor；
  - observation 增加 source：`fs/observed`、`read`、`write`、`legacy`。
- `mutation-unit.ts`
  - 只接收 plan 产生的 ops/targetKeys；
  - 多 target 排序与逆序释放保持。
- `io.ts`
  - 可选 realpath / identity 解析；
  - fake 后端 fallback。

### `packages/tool-skill-manage`

- `index.ts`
  - 写动作表驱动；
  - 删除 library 写分流；
  - 删除写前 observation seed；
  - 删除 per-action staged anchor 分支。
- `skill-actions.ts` / `write.ts`
  - 只保留参数与展示语义。

### 其他包

- `evolution-curator`
- `evolution-merge`
- `evolution-activity`
- `evolution-merge-ui`

改用 `SystemSkillWriter.apply(plan)`；保留各自的 snapshot/anchor 来源。

### 文档

- 本文作为目标方案；
- [skill-write-concurrency.md](skill-write-concurrency.md) 保留问题台账与历史 Phase；
- 落地后在主文档追加 Phase H 记录与 supersede 说明；
- 新增文档登记到 [README.md](README.md) 文档索引。

## 13. 分步落地

| 阶段 | 内容 | 工作量 | 完成判定 |
|---|---|---|---|
| H1 | 新增 `skill-write-plan.ts`（plan 层类型，复用 `skill-write-intent.ts`）；`SkillLibrary.apply(plan)` 先支持单 op 转发现有 mutator，多 op 明确返回未实现；tool 路径不变 | M | 编译、定向测试通过；行为不变 |
| H2 | tool 全部写动作走 plan；补 support patch/section patch/write_file create | M | P0/P1 回归消失 |
| H3 | approval 存 plan；删除 per-action anchor 分支 | M | 旧 pending 明确拒绝 |
| H4 | 删除 service 锁，收敛到 provider target lock；target identity realpath | M–L | 锁表只剩一份 |
| H5 | observation 只由读/写结果产生；legacy 适配隔离 | M | 写后观察失败不改写结果 |
| H6 | curator/merge/undo/learning-graph 迁移到 SystemSkillWriter | L | 内部写走同一 apply |
| H7 | 门禁、文档、真机验收、发布 | M | P0=0/P1=0 |

依赖：不新增第三方依赖；包边界不变；先做 H1–H3 即可消灭当前 P0/P1，不等待 target identity 大改。

风险：

- approval pending 记录兼容：旧记录拒绝，需要发布说明；
- target identity realpath 增加一次 IO：对一次写可接受；
- 内部调用者迁移量大：按 H1–H6 分步，不一次性推。

## 14. 验收矩阵

必须新增或保持：

1. 两 session 同时 `write_file` 同一 absent support：
   - 一个成功，另一个 `SKILL_ALREADY_EXISTS` / `SKILL_NOT_OBSERVED`；
   - 文件只写入一次。
2. 两 session 同时 patch 同一 support 不同区域：
   - 未重读的第二个 `SKILL_STALE_VERSION`；
   - 重读后可成功。
3. 无读直接 `patch.section`：
   - `SKILL_NOT_OBSERVED`。
4. approval stage 后目标被改：
   - approve 返回 `SKILL_STALE_VERSION`，不落盘。
5. 多文件 unit 任一 target stale：
   - 整个 unit 不写；undo 只回滚本 unit。
6. 写成功但 observation 刷新失败：
   - tool 仍返回成功 + warning。
7. symlink/alias 指向同一文件：
   - 同一 target lock、同一 observation。
8. 两个 session 并发 create 同名 skill：
   - 一个成功，另一个 `SKILL_ALREADY_EXISTS`。

## 15. 静态门禁

新增 arch guard：

- `tool-skill-manage` 不得调用 `SkillLibrary` 的 `update/patch/patchSection/writeSupportFile/removeSupportFile`；
- 全仓只允许 provider 构造 `SkillTargetLocks`；
- 所有 `SkillWriteOp` 必须有 `intent`；
- target identity 只能由 `SkillTargetResolver` 产生；
- approval pending 记录必须带 plan。

## 16. 明确不做

- 不新增第三套锁；
- 不把 mtime 当 version；
- 不自动 rebase / 不静默合并 / 不 last-writer-wins；
- 不复制平台 `fs-local` 的锁对象进插件；
- 不强制内部 system writer 使用 session observation；
- 不为旧 pending 记录保留无 anchor 回放；
- 不在 tool 层为单个 action 增加特判。

## 17. 为什么这是整体最优

短期看，plan/intent 类型和 provider 迁移会增加代码；长期看，它删除的是：

- support/section/body 三套 patch 分叉；
- 多套 per-target 锁；
- per-action approval anchor；
- 写前 seed、写后 re-read 的两段特判；
- tool 与 library 双重写入口。

最终只留下：

- 一个 `apply(plan)`；
- 一个 target lock table；
- 一个 observation store；
- 一个 approval plan。

这比继续在现有分支上补 P0/P1 更少补丁、更少未来的同类 bug。

## 18. H1 落地记录（2026-11-21）

已按本节设计完成 H1：

- 新增 `packages/evolution-core/src/skill-write-plan.ts`，导出 `SkillWriteExpect` / `SkillWriteOp` / `SkillWritePlan` / `SkillWriteOutcome` / `SkillWriteResult`；
- 从 `evolution-core/skills` 导出；
- `SkillLibrary.apply(plan)` 支持单 op，转发现有 `create/update/patch/patchSection/writeSupportFile/removeSupportFile`；
- `createSkill` 与普通 `write` 分开，保留 create 的 managed/保护/审计语义；
- 多 op 明确返回未实现，不部分提交；
- 新增 `packages/evolution-core/tests/skill-write-plan.spec.ts`，4 项通过：write/patch/section、support createIfAbsent 重复拒绝、createSkill、multi-op 拒绝；
- overlay build 0。

H1 边界：

- tool 路径未改变，仍走旧 service/library 分支；
- `SkillWriteService.plan()`、observation→expect、approval plan、锁收敛都未开始；
- H2 才把 tool 全部写动作切到 plan；H3 approval；H4 单锁与 target identity；H5 observation。

## 19. H2 设计（tool 写动作接入 plan）

H2 只改 tool 的“直接写”路径；approval replay 仍在旧 library 分支，H3 再切 plan。

### 19.1 Service API

```ts
type SkillWritePlanResult =
  | { ok: true; plan: SkillWritePlan }
  | { ok: false; code: SkillWriteErrorCode; message: string }

planCreate(owner, name, content, origin, managed): Promise<SkillWritePlanResult>
planUpdate(owner, name, content): Promise<SkillWritePlanResult>
planPatch(owner, name, { oldString, newString, replaceAll, filePath, section }): Promise<SkillWritePlanResult>
planWriteSupport(owner, name, filePath, content): Promise<SkillWritePlanResult>
planRemoveSupport(owner, name, filePath): Promise<SkillWritePlanResult>
apply(plan, owner?): Promise<SkillWriteServiceResult>
```

### 19.2 action → plan 映射

| tool action | plan op | observation |
|---|---|---|
| create | `createSkill` | 不需要，createIfAbsent |
| update | `write` + expect version | 必须 present |
| patch body | `patch` + expect version | body 必须 present |
| patch support | `patch` + expect version | support 必须 present |
| patch section | `patchSection` + expect version | body 必须 present；忽略 file_path |
| write_file absent | `write` + expect absent | 允许未观察；kernel 用 createIfAbsent |
| write_file existing | `write` + expect version | 必须 present |
| remove_file | `remove` + expect version | 必须 present |

`write_file` 的“未观察且不存在”分支仍要读一次当前状态来决定 absent/present；这次读不写 observation，不构成写授权，真正的拒绝由 kernel 的 `createIfAbsent` 完成。

### 19.3 tool 改动

- `executeCore` 的 create/update/patch/write_file/remove_file，在 `owner !== undefined && stagedAnchor === undefined` 时统一：
  1. `service.plan...`
  2. `service.apply(plan)`
  3. 结果转 `SkillActionResult`
- 删除 tool 内 `library.update/patch/patchSection/writeSupportFile/removeSupportFile` 的直接分支；
- `patch.section` 不再绕过 service；
- `patch(file_path)` 不再绕过 service；
- approval replay（`stagedAnchor` 或 owner undefined）暂留旧路径，H3 改为重放 plan。

### H4a 落地记录（2026-11-21）

- 删除 `SkillWriteService` 的私有 `SkillTargetLocks`；
- legacy service 方法（updateBody/patchBody/updateSupport/removeSupport）直接调用 library，锁只在 provider；
- tool 全部 plan 路径仍经 `SkillLibrary` 的 target lock；
- tool 全包 115 passed，overlay build 0。

H7s 发布后 npm web 验收：新建 `h7post` 独立 profile，从 registry 安装全部 22 个 `@lmzhen/*@0.59.6`；`dsh web --profile h7post --port 3085` 启动无 mixed-family 警告，页面 200；安装的 core 0.59.6 含 `SystemSkillWriter`。确认发布字节可用。

H7r 发布完成：修复 virtual-root IO 下两个 SkillLibrary 实例的 target lock key 回退（root 不存在时用逻辑 key，恢复 shared-root-queue G1/1.4），tag `v0.59.6` 指向 `67255012`，GitHub release run 44926000840 **success**（pack/validate/cohort/desktop/publish/verify 全绿）；npm 已可查 `@lmzhen/dsh-evolution-all@0.59.6` 与 `@lmzhen/dsh-tool-skill-manage@0.59.6`。

H7q 最终发布确认：用户于 2026-11-22 明确选择 **0.59.6 补丁版** 并确认“现在发布”。独立复核（bc434345..HEAD）结论：新 P0=0、新 P1=0，原 P1-1/P1-2 仍关闭，可进入发布候选。发布动作：推送 main 后创建 tag `v0.59.6`，由 release 工作流按 tag 版本打包/发布 22 个包。

H7p 发布候选验收：最终定向套件 32 files / 320 tests passed；`run-gates local` pass=57 fail=0 cannotDecide=4(registered) skipped=1；`prepare-release --scope @lmzhen --version 0.59.5 --dev-build` 产出 22 个 tarball；`smoke-packed-install` 22 个 tarball 全部可 import 且 bundle patch 存在；`audit-release-tarballs --version 0.59.5` OK。

H7o 最终定向测试稳定复跑：skill-write-service 的未读拒绝用例在满载下 30s 超时，提升该用例超时到 60s（仅测试夹具，不改行为）；全量定向套件复跑 32 files / 320 tests passed，无失败。

H7n 已完成 K6：`SkillWriteService.apply` 在写成功后记录 outcome observation 时捕获异常，已提交写不会因 observation 缓存失败变成工具失败；新增故障注入测试（observation.record 抛错，create 仍 ok 且文件存在）。

H7m 已完成真实 approve 成功回放：新增测试依次暂存并 approve create/update/patch/write_file/remove_file，五个 plan 全部落地且 remove 后文件消失。至此真实 approve 的拒绝（stale/policy）与成功路径均有覆盖。K6 故障注入仍缺，机制上已无写后 re-read。

H7l 双 web host 尝试：启动第二个 lab web host（同 profile，端口 3084）与 3083 并行，两个 isolated Chromium 各自新建会话，分别写同一 `references/web-race5.txt` A/B。A(host1) 写入成功；B(host2) 在“加载技能”后停于“深度求索中 1 秒”，30 秒内无写入，手动停止。结论：模型/宿主请求在共享 home 下串行，双 web 模型会话无法制造并发窗口；provider 并发已由 headless 跨进程与 K2/K7/K8 覆盖，web 并发证据按 DEFERRED 记录。

H7k 双 web 独立会话第三次尝试：两个 isolated Chromium 各自点“新建会话”成功，分别发送 write_file A/B 到同一 `references/web-race3.txt`。A 在 4 秒内完成并落盘 A；B 的会话进入“深度求索中 1 秒”后长时间未推进，60 秒内无写入，手动停止。观察到的是一次成功写入、无双写；但 B 的模型请求未在验收窗口内并发执行，无法证明双 web 写入竞态，归因为 host/模型请求排队而非 provider 双写。

H7j 双 web 独立会话第二次尝试（未通过）：两个 isolated Chromium 各自点击“新建会话”后填 prompt，但 UI 仍停留在旧 conversation，发送后只看到旧 `web-race.txt` 记录，新 `web-race2.txt` 未产生。判断为新建会话点击未命中/两种客户端共享选中态，需改用 API 或每客户端独立 profile 后再验。

H7i 双 web 客户端尝试（未通过）：两个 isolated Chromium 同时打开 lab host，未先各建独立会话，两个 composer 实际写入同一已选会话；结果只落一个 `references/web-race.txt` 内容 A，另一条消息排队，不能作为“双 session”证据。下一步必须在两个浏览器各自先点“新建会话”，再并发发送。

H7h 真机 web 单会话证据：isolated Chromium 打开 lab host `http://127.0.0.1:3083`，新建会话后模型调用 `skill` 读取 `race-h7` 并成功 `skill_manage write_file` 写 `references/webrace.txt`（回复 DONE-WEB-A，无错误）。这证明 npm tarball 安装的 web profile 能完成真实 skill read→write 链路；**双 web session 并发**证据仍未拿到（单次会话 4 秒完成，第二次未及时并发）。

H7g 验收矩阵补齐：新增 K2（两 owner 同 support patch 同一 observation，恰一成功、另一 SKILL_STALE_VERSION、磁盘只落一个改动）、K7（目录 junction alias 与真实路径共享 observation/lock，恰一成功且 target 文件只变一次）、K8（tool 级两 owner 并发 create 同名 skill，恰一成功、磁盘只有胜者内容）。K6 故障注入未做，但机制已无写后 re-read，create-tree-reads 读计数作为间接证据。

H7f 独立复核 P1 修复：① `patchCore` 的 outcome `after` 从 `writeContent` 改为真正落盘的 `onDisk`，避免 patch 成功后同一 owner 立刻假 stale；新增 support 尾随换行回归。② approval plan replay 在 `apply` 前重跑执行点门禁（policy-protection、patch summary、descriptionStrict），并用真实 `approve()` 补“暂存后加入 protectedSkillNames → 拒绝”证据。`run-gates local` 复跑 pass=57/fail=0/cannotDecide=4/skipped=1。

H7e 门禁第一轮：`run-gates local --concurrency 6` 结果 pass=56、fail=1（gate-46 check-taxonomy 陈旧，因新增 skill-write-plan.spec 未重新生成）、cannot-decide=4（gate-01 缺 overlay typescript、gate-29 缺 plane home、gate-81 空健康语料、gate-75 CI 路径）、skipped=1；已重生成 `packages/scripts/reports/check-taxonomy.json`（spec 总数 507→508）。其余 arch/doc-facts/test-lines/构建均绿。

H7d 已获得跨进程 npm 包写证据：在 lab profile（file tarball 0.59.5）上用两个并发 headless 进程对同一 `race-h7` 做 skill read + sleep barrier + patch/update；history 每次只增加一个版本，另一个写入被 old_string/版本检查拒绝，未出现双写。`dsh web --profile h7lab --port 3083` 页面 200，证明 npm 包可在 web profile 装载；双 web session 的 create/patch 并发仍待补。

H7c 验收准备（进行中）：用 `prepare-release --scope @lmzhen --version 0.59.5 --dev-build` 生成 22 个发布 tarball；在 `D:\dsh-homes\web\profiles\h7lab` 用 pnpm 安装 file tarball，启动独立 web host `http://127.0.0.1:3083`（token 略）。首轮发现同版本 0.59.5 的 peer 依赖被 pnpm 解析到 registry 旧 core，lab 内用本地 tarball 覆盖旧 core 目录后 host 启动成功；这是本地同版本安装的解析现象，不是发布链代码缺陷。真机并发 create/patch 验收待完成。

H7b 已完成：`planFromStaged` 对 patch/remove 的 absent anchor 也生成 plan；现在所有暂存内容写入（create/update/patch/write_file/remove_file）都有完整 plan，approve 不再有空 plan 内容写入。

H3c 已完成：tool 的 create/update/patch/patch.section/write_file/remove_file 全部走 plan；旧 anchor/直接路径改为读当前 bytes 构造显式 expect 后 `SkillWriteService.apply`，tool 不再调用 library 内容 mutator。新增 arch guard N40。

H7a 已完成：新增 arch guard N38（`SkillTargetLocks` 只能由 provider 构造）与 N39（`SkillTarget.targetKey` 字面量只能出现在 observation target factory）；其余 L 项（tool 直调 library mutator、pending 必须带 plan）待 H3c/审批清理后再加，否则会以基线债形式存在。

H6c 已完成：`remove` op 增加可选 `unitId`，provider 透传给 `removeSupportFile`；curator manual unit-undo loop 的 support remove/write 与正文恢复全部迁到 `SystemSkillWriter.apply`。curator/src 已无直接 library 内容 mutator 调用。

H6b 已完成：curator snapshot `writeSkill` 改为读当前 bytes 后构造显式 plan；unit-undo 的 `updateSkill`/`writeSupportFile`/`removeSupportFile` sink 回调全部改走 `SystemSkillWriter`；剩余直接 `removeSupportFile` 的 `undoUnitId` 路径与 manual unit-undo 循环留 H6c（plan op 尚无 unitId 字段）。

H6a 已完成：新增 `SystemSkillWriter.apply(plan)`（无 session observation，仍走 provider 锁/unit/audit）；merge 的 restoreTarget/restoreSupportFile/restoreSource 迁移为显式 snapshot plan；curator 单技能 undo 的正文恢复迁移为显式 anchor plan；新增 provider 测试。curator 的 snapshot restore 与 unit-undo support 回调仍直接用 library，H6b 继续。

H5b 已完成：删除写前 legacy seed；`installSkillObservationListener` 增加 `session/event` 桥：记录 `skill` 工具的 tool/call，在 tool/result 文本中解析 skill 内容与 base dir，读取 SKILL.md 并校验渲染 instructions 等于当前 body 后，以 `skillHostIdentity` 记录 read-time observation。非 directory provider、stale body 不记录。剩余缺口：平台 `skill` 工具仍不发 fs/observed，桥依赖渲染文本格式，列为 DEFERRED 上游推动项。

H5a 已完成：`SkillActionResult.after` 由 core mutator 在成功提交时返回（create/update/patch/patchSection/write_file/remove_file）；`SkillLibrary.apply` 用 after 生成 `SkillWriteOutcome.version`；`SkillWriteService.apply` 直接从 outcome 记录 observation，不再为 plan 写后 re-read；`create-tree-reads` 的 post-write read 计数下降为 1。legacy `skill` 读的写前 seed 仍在，H5b 再隔离/移除。

H3b 已完成：approval replay 优先用 `args.plan`；`WriteRunner` 增加 `context.replayed`，approve 路径对无 plan 的旧内容写入明确拒绝；plan replay 前重新 `applyLimits()`，避免绕过收紧后的 cap；update 目标缺失用 `write` + `expect absent` + `create:false` 保留 update-only 语义。per-action anchor staging 分支尚未删除（H3c）。

H4b4 已完成：`MutationUnitOptions.targetKeyResolver` 在 apply/recover/undo 三处 lock acquire 前统一 canonical 化；`SkillLibrary.commitUnit` 与 `withMutationLock` 均注入 `canonicalLockKeys`，跨进程 unit targetKeys 与 in-process/observation identity 使用同一 `skillpath:<hash>`。

H4b 完成；下一阶段 H5。

H4b3 已完成：observation store 只以 `identityKey` 为键，不再同时记录逻辑键；`fs/observed` listener 用 `realpathSync.native` 生成与 `SkillLibrary.canonicalTargetKey` 相同的 identity（修复 Windows 8.3 短路径与异步 realpath 不一致）。unit targetKeys 仍未 canonical 化，H4b4 处理。

H4b2 已完成：`SkillTarget` 增加可选 `identityKey`；`SkillLibrary.identify` 用同一 `canonicalTargetKey` 生成；service read/plan 使用 identify；平台 `fs/observed` listener 用 `skillHostIdentity` 记录 identity；observation store 以 identity 为主键，并暂时保留逻辑键兼容旧测试/旧记录。unit targetKeys 仍逻辑键，H4b3 统一。

H4b1 已完成：`SkillLibrary.withTarget` 把逻辑 `skill::name::path` 解析为 realpath（缺失文件用最近存在祖先）并 sha256 成 `skillpath:<hash>`，绑定进程内 per-target 锁；观测/审批 targetKey 与跨进程 unit key 仍是逻辑键，H4b2 再统一。

H4b 待做：target identity 进入 observation/approval/unit；fake IO 明确 weaker identity。

### 20. H3 设计：approval 保存并重放 plan

H3 分两步：H3a 先让新暂存记录带 plan、replay 走 plan；H3b 再拒绝无 plan 的旧记录。

H3a 已完成：

- 新增 tool 侧 `planFromStaged(operation, origin)`：把带 anchor 的 create/update/patch/write_file/remove_file 转成 `SkillWritePlan`；
- approval `args` 增加 `plan`；
- replay runner 优先 `skillWriteService.apply(plan)`，无 plan 才走旧 `executeCore`；
- update 目标缺失（anchor absent）暂无 plan，继续旧路径；H3b 再决定是拒绝还是新增 update-only op。

H3b 待做：

- 旧 pending 无 plan 明确拒绝并要求重新发起；
- 删除 per-action `staged_from_sha256` staging 分支，planFromStaged 改为 service 生成；
- approval preview 改为 plan diff；
- 测试旧记录拒绝与新 plan 重放。

### 19.5 H2 落地记录（2026-11-21）

已按本节完成 H2：

- service 新增 `planCreate/planUpdate/planPatch/planWriteSupport/planRemoveSupport` 与 `apply(plan, owner?)`；
- tool 的 create/update/patch/write_file/remove_file 在直接写路径统一 plan 化；
- `patch.section` 与 `patch(file_path)` 不再绕过 service；
- support absent 使用 `createIfAbsent`；
- 保留 `normalizedFrontmatterFields` / `path` / `noop`，旧结果字段不丢失；
- 新增 support/section 未读拒绝、读后成功、并发 support create 测试；
- 既有 tool 定向 91 passed，overlay build 0。

H2 边界：approval replay 仍是旧路径；observation 写后仍 re-read；锁仍在 service/library 两处。

### 19.4 H2 验收

- support patch 未读 → `SKILL_NOT_OBSERVED`；读过 → 成功；
- section patch 未读 → `SKILL_NOT_OBSERVED`；读过 → 成功；
- `write_file` 并发创建同一 absent support：一个成功，另一个 `SKILL_ALREADY_EXISTS` / `SKILL_STALE_VERSION`；
- update/patch/body 既有测试不回退；
- H1 plan seam 测试继续通过；
- overlay build 0、定向测试通过。


