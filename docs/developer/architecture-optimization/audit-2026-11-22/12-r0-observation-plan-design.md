# R0 设计：失败读取的证据形状与 plan prepare 副作用

范围：P0-1（read-before-write 门禁）、A1（多 op plan create 的 prepare 副作用）。
目标架构关系：两者都是 R0 止血项；目标架构最终会用平台 `fs/observed` + UnitKernel 替换当前 observation/plan sink，因此本设计只修“当前 seam 的根因”，不把临时路径固化成新 API。

## 1. 已读依据

- `audit-2026-11-22/README.md`：P0-1、A1 与原始证据。
- `audit-2026-11-22/10-system-framework.md`：I2（单一写权威）、I3（先观测后变更）、I4（因果顺序）、M2/M3。
- `audit-2026-11-22/11-target-architecture.md`：平台拥有 observation；UnitKernel prepare 零持久副作用。
- `audit-2026-11-22/01-core-write.md`：A1 代码行；`02-tool-skill-manage.md`：P0-1 代码行。
- 当前实现：
  - `packages/evolution-core/src/tool-dispatch.ts`：`readDispatchRecord` / `firstResultBlock` / `ToolDispatchSignal`。
  - `packages/evolution-core/src/write-gates.ts`：`READ_BEFORE_WRITE`。
  - `packages/tool-skill-manage/src/skill-observations.ts`：skill 读桥与 `fs/observed`。
  - `packages/evolution-core/src/skill-store.ts`：`createCore`、`commitUnit` plan sink、`applyMulti`。
  - 测试：`tool-skill-manage/tests/write-gates.spec.ts`、`evolution-core/tests/skill-write-plan.spec.ts`、`skill-observed-writes.spec.ts`。
- 平台实现：
  - `harness-rc3/packages/core/tools/src/batch.ts:255-265`：`tool/result` 的 `message` 是 `createToolResultMessage`。
  - `harness-rc3/packages/llm/llm/src/message.ts:299-307`：`isError` 在 `message.isError`。
  - `harness-rc3/packages/fs/fs-observation-policy/src/index.ts`：observation owner = `actor.agent.session`；读/写 intent 的角色。

## 2. 定性

| 问题 | 不变式 | 定性 | 风险边界 |
|---|---|---|---|
| P0-1 失败读取被计为成功 | I3 先观测后变更 | 安全门禁绕过；可让非前台写入盲改未读内容；测试假绿 | 不是“所有读都失败”，是失败/取消/普通 Error 的 result payload；修复必须同时覆盖 skill 读桥和 usage 计数 |
| A1 create audit 在 prepare 落盘 | I2 单一写权威 / I4 因果顺序 | 多 op plan 的成功重复与拒绝幻影；影响审计/历史/事件，不影响技能字节 | 当前无生产 multi-op 调用方，但新增路径把错误模型暴露；修复必须保持单 op create 的既有行为 |

两者都属于“当前 seam 的根因”，不需要 DCR：目标架构仍保留 P0-1 的最终形态（平台 observation）与 A1 的最终形态（UnitKernel prepare 零副作用）。

## 3. 设计

### 3.1 P0-1：把平台结果的失败标志读对

`readDispatchRecord` 的 native result 分支：

- 在 `data.message` 的类型中补 `isError?: unknown`；
- `outcome.ok` 改为：
  ```ts
  const messageFailed = data.message?.isError === true
  outcome: { ok: data.isError !== true && data.error === undefined && messageFailed === false && block?.isError !== true }
  ```
- 保留 payload 顶层 `isError` 和 `error` 的兼容，覆盖旧日志/外部 emitter；
- `firstResultBlock` 的 `tool-result` 分支保留，用于 PTC/旧形态；
- 不改变 `ToolDispatchSignal` 公共形状；不改变 PTC 分支；
- `skill-observations.ts` 无需另写判定：它消费 normalizer 的 `signal.ok`；usage 也消费同一 fold。

测试：

- 更新 `write-gates.spec.ts` 的 `readFrames`/`fileReadFrames`，把失败标志放到 `message.isError`（平台真实形状）；
- 保留一条“旧 payload 顶层 isError”兼容测试，证明旧日志仍判失败；
- 新增/保留“失败 skill 读 → 非前台写入被 E-318 拒绝”的真实形状用例；
- 若测试支持，直接构造 `createToolResultMessage` 形状，避免手写。
- 验收：失败 skill 读不进入 read 集合；成功读仍通过；PTC 分支不回归。

### 3.2 A1：prepare 期间不直接 audit/notify

`createCore` 当前的直接副作用：

```ts
await this.audit(...)
this.notifyMutation(...)
```

改为在 `PLAN_SINK` 收集上下文存在时跳过：

```ts
const inPlanPrepare = PLAN_SINK.getStore() !== undefined
if (!inPlanPrepare) {
  await this.audit(...)
  this.notifyMutation(...)
}
```

- 单 op create（无 plan sink）保持原行为；
- 多 op create 的 audit/notify 由 `applyMulti` 最终 unit 的 `hooks.committed` 统一产生（现有代码已在 hook 中逐条 audit/notify）；
- `createCore` 的其他副作用：marker 写入只在 `origin !== 'foreground' || managed`；`applyMulti` 已拒绝 managed/non-foreground create，因此多 op 的 foreground create 不会在 prepare 写 marker；
- `cleanupPaths`/`hooks.undone` 仍只由真实 unit 使用；假 unit 不执行；
- 如果后续 op 失败或 commit CAS 漂移，prepare 不再产生 audit/version/event 幻影。

测试：

- `skill-write-plan.spec.ts` 的 multi create 用例增加：执行后 `listMutations()` 恰一条 create、`evolution/skill-mutated` 事件恰一条（用现有事件收集/测试支持；若无事件收集，至少断言 audit 条数）。
- 增加一个 negative：多 op create + 后续 stale op 失败后，`listMutations()` 不含 create 记录，文件不存在。
- 单 op create 的审计/事件行为不变（现有 create 测试）。

## 4. 影响面与回退

- P0-1：只改 `tool-dispatch.ts` 的类型读取与一行判定；影响 skill read 门禁、usage view、review skill signal；不改 API/存储。
- A1：只改 `createCore` 的两个直接副作用调用；影响 `applyMulti` create 审计/事件，单 op 不变。
- 回退：两处都是小范围、无 schema 变更，可独立 reflog 回退；失败不会损坏技能字节。
- 目标架构后续：P0-1 最终由 `fs/observed` 替换；A1 最终由 UnitKernel prepare/commit 合约覆盖，本设计不新增永久 API。

## 5. 验收命令

```bash
node node_modules/vitest/vitest.mjs run \
  packages/evolution/tool-skill-manage/tests/write-gates.spec.ts \
  packages/evolution/tool-skill-manage/tests/skill-observed-writes.spec.ts \
  packages/evolution/evolution-core/tests/skill-write-plan.spec.ts \
  packages/evolution/evolution-core/tests/skill-write-service.spec.ts
node packages/scripts/verify-arch-guards.mjs packages --strict
```

完成后再进入下一组（B5/D1/F1-F2 或 HomeFS Phase B），不把 R0 止血误当目标架构完成。

## 6. 实现结果（2026-11-22，未发布）

- P0-1：`readDispatchRecord` 已补 `data.message.isError`，并保留 payload 顶层 `isError` 的旧日志兼容；
  `write-gates.spec.ts` 的失败读夹具改为平台真实 `message.isError` 形状，新增 legacy 形状用例。
- A1：`createCore` 在 `PLAN_SINK` 收集期间不再直接 audit/notify；由 `applyMulti` 最终 unit 的
  `hooks.committed` 统一产生。新增多 op create 审计恰一条、后续 op 被拒不留 create 记录两个断言。
- 验证：5 个测试文件 / 126 tests passed；arch guards 42 clean；doc facts/test-lines 0 violation。
- 未运行全量套件；未发布。
- 目标架构后记：P0-1 最终由平台 `fs/observed` 替换；A1 最终由 UnitKernel prepare/commit 合约覆盖；
  本批不新增永久 API。
