# Phase C 设计：UnitKernel 接管 WriteKernel

范围：把 `write-kernel.ts` 的字节写原语并入目标架构的 `UnitKernel`，增加 `prepare` 与 `commitPrepared` 两阶段，保留 `MutationUnit` 的 journal/claim/lock 不变。第一步只统一“字节写 + 多目标预检/补偿”原语；多文件 journal 迁移在后续组。

## 1. 已读依据

- `11-target-architecture.md` §4.2：UnitKernel `plan/prepare/commit/recover/undo`；prepare 只读，commit 唯一写点。
- `10-system-framework.md`：I2/I4/I5。
- `01-core-write.md`：`WriteKernel` 是当前字节写内核；`MutationUnit` 是 journal/recovery 层。
- 当前实现：
  - `packages/evolution-core/src/write-kernel.ts`：`WriteKernel` 整类；`writeOne`/`commit`/`restore`/`compensate`。
  - `packages/evolution-core/src/mutation-unit.ts:4,268,292,561,576,583`：唯一消费者，仅用 `writeOne`/`restore`；`MutationUnit` 自身已有 lock/claim/journal/snapshot/recover。
  - `packages/evolution-core/src/write.ts`：`export * from './write-kernel.ts'`。
  - 无直接 `WriteKernel` 测试；行为由 `skill-store`/`mutation-unit` 测试覆盖。
- 平台/`EvolutionIo`：`io-platform.ts` 已提供 `transact`/`createTextIfAbsent` 语义（Phase B）。

## 2. 定性

| 问题 | 结论 |
|---|---|
| `WriteKernel.commit` 内部先预检再写 | 没有独立 prepare API；调用方无法在 commit 前零写检查 |
| `WriteKernel` 与 `MutationUnit` 两个写 owner | 目标要求一个 UnitKernel；`WriteKernel` 仅被 `MutationUnit` 使用，可合并 |
| 多文件 journal | 本轮不动；`MutationUnit` 继续拥有 journal/snapshot/claim |

不变量：`prepare` 不允许任何写；`commitPrepared` 仍然是唯一写点并只补偿本次已写目标；失败结果保留错误列表。

## 3. 设计

### 3.1 新文件 `unit-kernel.ts`

从 `write-kernel.ts` 迁移并改名：

```ts
export interface UnitTarget { path; expected; next; skill? }
export interface UnitKernelError { code: 'cas-conflict'|'write-failed'|'compensation-blocked'|'transact-not-invoked'; message; target }
export interface UnitKernelResult { ok; changed; errors; warnings? }
export interface PreparedUnit { readonly targets: readonly UnitTarget[] }

export class UnitKernel {
  prepare(targets): Promise<{ ok: true; prepared: PreparedUnit } | { ok:false; errors: UnitKernelError[] }>
  commitPrepared(prepared): Promise<UnitKernelResult>
  commit(targets): Promise<UnitKernelResult> // = prepare + commitPrepared
  writeOne(...) / restore(...)
}
```

- `prepare` 只 `io.readText`，逐 target 比较 `expected`；任一漂移返回 `cas-conflict`，不写；
- `commitPrepared` 不再做预检，按 target 顺序 `writeOne`；失败时 `compensate(written)`；
- `commit` 保留旧 API 语义，内部走 prepare+commitPrepared；
- `restore`/`writeOne` 逻辑从旧类逐字迁移，不改语义；
- `write.ts` 改为 `export * from './unit-kernel.ts'`；
- 删除 `write-kernel.ts`（无其他 source 消费者）。

### 3.2 MutationUnit

- import `UnitKernel` 替代 `WriteKernel`；
- 字段/构造参数同步；
- 其余 `applyOp`/rollback/undo 行为不变；
- 不在这一轮把 `MutationUnit.apply` 拆成 prepare/commit（journal/snapshot 语义另组处理）。

### 3.3 测试

新增 `unit-kernel.spec.ts` + fake `EvolutionIoLike`：

- `prepare` 成功不写任何字节；
- `prepare` 遇到 stale 返回 conflict，不写；
- `commitPrepared` 写全部目标；
- 第二个目标失败时只回滚第一目标，错误包含 compensation；
- `commit` 包装路径与旧行为一致；
- `createIfAbsent` 冲突 → cas-conflict。

## 4. 回退与边界

- 回退：恢复 `write-kernel.ts` 并把 `write.ts` export 改回；`MutationUnit` import 回退。
- 不改 journal/claim/lock/snapshot；`MutationUnit` 仍是当前多文件 unit 的 owner。
- 不声明 UnitKernel 已含 recover/undo；这些在后续组从 `MutationUnit` 迁入。

## 5. 实现结果（2026-11-22，未发布）

- `write-kernel.ts` 已重命名为 `unit-kernel.ts`，类/类型改为 `UnitKernel`/`UnitTarget` 等；
  `MutationUnit` 改为使用 `UnitKernel`；`write.ts` 导出同步。
- 新增 `prepare()` 与 `commitPrepared()`；`commit()` 内部走 prepare+commitPrepared。
- 新增 `unit-kernel.spec.ts` 4 tests：prepare 零写、stale 零写、commitPrepared、
  后一目标失败只补偿前一目标。
- 回归：unit-kernel + skill-store + io-platform.domain = 3 files / 72 tests passed；build 0。
- `MutationUnit` 的 journal/claim/lock/recover 仍未迁入 UnitKernel；下一步处理。
