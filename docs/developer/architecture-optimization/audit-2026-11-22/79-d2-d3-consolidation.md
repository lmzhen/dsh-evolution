# D2/D3 阶段记录：UnitKernel 收口与平台端口生成（第一段）

## D2：MutationUnit 公共名退役，UnitKernel 成为唯一多文件事务入口

### 已做

- 旧的低层字节写类从 `unit-kernel.ts` 移到 `target-writer.ts`，改名为 `TargetWriter`；它只保留单 target CAS/写入/补偿原语，不再是公共事务入口。
- 旧的 `MutationUnit` 文件与类改名为 `UnitKernel`：
  - 仍拥有 lock/claim/journal/snapshot/recover/undo；
  - `skill-store`、`write.ts`、`mutation-authority`、`mutation-storage-adapter` 全部改为 `UnitKernel`/`unit-kernel.ts`；
  - 旧 `mutation-unit.ts` 删除。
- 测试同步：低层测试改为 `target-writer.spec.ts`，多文件测试改为 `unit-kernel.spec.ts`；`unit-engine-single-source` 断言唯一公共 `UnitKernel` 在 core。

### 验证

```text
target-writer: 4 tests
unit-kernel: 27 tests
mutation-context/crash/recovery/unit-engine: 9 tests
build-lib: 0
approval.spec: 37 tests passed
run-gates local: 61 pass / 0 fail / 3 cannot-decide
全量 family suite: 447 files / 2448 tests passed（1205.48s）
```

### 已补：真正的 prepare/commit 两阶段

- `prepare(request)` 获取 lease/claim、读取全部 target、校验 CAS/write-validation，**不写 journal、snapshot、audit、event**；返回持有 lease 的 `PreparedMutation`；
- `commit(prepared)` 是唯一持久写阶段：journal/snapshot prepared → 写 target → unit-written/committed → hooks；失败回滚并释放 lease；
- `apply()` 变为 prepare + commit；`release()` 允许调用方在未 commit 时释放；
- 新增测试：prepare 后文件/journal/snapshot 零变化；release 后可重新 prepare；
- unit-kernel: 29 tests passed；全量 447 files / 2450 tests passed（1124.72s）。

### 仍未做

- `plan(input: SkillIntent)` 仍由 SkillWriteService 负责，UnitKernel 接收的是 `MutationRequest` 而不是领域 `UnitPlan`；
- 旧 journal 的只读迁移器未写；
- PlanService 的 tool/approval/system 全链路尚未全部改到 UnitKernel。

## D3：可机械派生的平台端口改为生成

### 已做

- 新增 `packages/scripts/contract-ports.json` 与 `gen-contract-ports.mjs`；
- 生成 `evolution-platform/src/contract/ports.generated.ts`：
  - `CommandsPort = Pick<CommandRuntime, 'register'>`；
  - `ToolsPort = Pick<ToolsService, 'register' | 'guard' | 'restrict'> & { get/resolve/execute }`；
  - `WorkingDirectoryPort = Pick<WorkingDirectoryService, 'ensure'>`；
- 手工 `commands.ts`/`tools.ts` 只做再导出，不再手抄这几个方法签名；
- `contract-ports.spec.ts` 运行 `--check`，生成物漂移会红。

### 未做

- SettingsPort 仍手写：平台的 `configure` 第二参是 `Fiber`，家族端口是 `unknown`，`describe` 是可选服务；直接 `Pick` 会破坏适配器类型，需先统一 owner 类型；
- 其余 ports 仍是 family-facing 子集；
- 客户端 route 生成与 configForms 单源仍属于 Phase E。

## 附带修复：approve 并发 dedupe 的位置

全量套件在 D2/D3 后暴露 `runs the replay exactly once when approve is called concurrently` 偶发失败：`approve` 把 `dedupe` 放在 `withApprovalLease` 内，第二个并发调用先抢 lease 失败，无法共享第一个的执行结果。

- 把 `dedupe(approve:id)` 移到 lease 外；并发调用共享同一个 promise，lease 内只执行一次；
- approval.spec 37 tests passed；顺序二次 approve 仍由 V4-18 覆盖为 ok:false。

## 下一步

D2 的 prepare/commit 两阶段与 D3 剩余端口生成继续，完成后才重新进入发布门。
