# C3 设计：跨面 in-flight owner 判据改为 `hasOwner()`

范围：P1-3（审计 04-merge-undo）：merge runtime 的 `isOwnerActive` 用本进程 `runs.find()`，`foreign` 只在启动时 `load()` 一次；另一面在本进程启动后新起的 run 被判 inactive，重复起 run。

## 1. 已读依据

- `audit-2026-11-22/04-merge-undo.md:36-42`：位置、机制、影响、修法。
- `packages/evolution-merge/src/index.ts:357-360`：`isOwnerActive` 读 `runs.find`。
- `packages/evolution-core/src/run-registry.ts:433`：`hasOwner()` 先 `ensureLoaded()` 再 `find`，会重读共享 runs 索引，按 pid 判定 orphan。
- `packages/evolution-merge/src/runtime.ts:178-209`：pair/verify 的 in-flight 判定使用 `isOwnerActive`。
- `packages/evolution-merge/tests/gates/rg0b-runtime-owner.spec.ts`：`hasOwner` 已覆盖 live/settled/orphan。
- 平台/runs 共享语义：`runs.json` 是跨面索引；本进程 registry 的 `foreign` 只在 `load` 刷新。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| `runs.find` 本进程缓存 | I1 单一事实源 | 跨面 owner 判据陈旧；重复模型 run/staging；行 CAS 防双合并，不直接损坏树 | 只在两面同时/先后操作同一 pair；影响成本与幂等 |

修法一行：`isOwnerActive` 改为 `async (runId) => await runs.hasOwner(runId)`。`hasOwner` 有 `ensureLoaded`，且已按 pid/orphan 语义测试。不是新增 API。

## 3. 测试

- 现有 `rg0b-runtime-owner.spec.ts` 已覆盖 `hasOwner` 的 live/settled/dead-owner orphan；
- 新增强制落点：把 `index.ts` 的 `isOwnerActive` 改成调用 `hasOwner` 后，runtime 的 await 路径类型仍通过；
- 反例（drill）：把该行改回 `runs.find`，跨面场景会重复起 run；当前测试集不直接覆盖 index wiring，因此文档记录 drill 为“同 home 两进程/两面起 pair”。后续 owner 收敛到 `runs.hasOwner()` 单一入口时补端到端。

## 4. 回退

- 一行撤销；`hasOwner` 仍在 core 测试覆盖。
- 不改变 run 生命周期/状态机；只改判据来源。

## 5. 实现结果（2026-11-22，未发布）

- merge runtime 的 `isOwnerActive` 改为 `async runId => await runs.hasOwner(runId)`；
  owner 事实重新读共享 runs 索引，不再依赖只在 load 时刷新的 foreign 缓存。
- 回归：rg0b-runtime-owner + recovery-settle + runtime-unit = 3 files / 14 tests passed；build 0。
