# C2 设计：staging 代际隔离与 closeRow 清树

范围：P1-2（审计 04-merge-undo）：重试复用同一 staging 树，上一代残留 support 文件进入本次 commit；reject/discard 不清树导致下次 approve `staging already exists` 必失败。

## 1. 已读依据

- `audit-2026-11-22/04-merge-undo.md:22-26`：位置、机制 a/b、触发、修法。
- 当前实现：
  - `new-child-authoring.ts:63-86`：`existing.kind==='present'` 只 `setStageTreeTarget`，不清 `merged/`；
  - `staged-tree.ts:41-67`：枚举 `merged/<target>` 下全部文件；
  - `staging.ts:71-73`：同名 stage 目录已存在时 `createStaging` 直接拒绝；
  - `runtime.ts` reject/discard/skipped restore/resume clear/pair cleanup/source-gone 只删行，不 `dropStage`；
  - `scan-run.ts` / `round2-outcome.ts` 已对部分失败路径 `dropStage`，但 terminal 集合不一致。
- 测试：`new-child-authoring.spec.ts`、`runtime.spec.ts`、`stage-cleanup.spec.ts`。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| 复用旧 merged/ | I1/I4 | 旧 support 被当作本次产物提交（likely，可由测试复现） | 重试/重复 approve；提交内容污染 |
| reject/discard 不清 stage | I8 | 下次 approve createStageTree 必失败；行进入 approved 后只能 resume | pending/approved 生命周期；不损坏树但功能失败 |

根因是 **stage 树没有与“一次 authoring 尝试”绑定**。完整修法是 stageKey 代际化 + manifest；本轮先实现等价隔离：
- 每次 authoring 前清空 `merged/`（target 由本次决定）；
- 所有关闭行的路径统一 `dropStage`（index + tree）。

这不改变 stageKey 格式/磁盘 schema，避免迁移；后续 UnitKernel/Projection 阶段可把 generation 写进 manifest。

## 3. 设计

### 3.1 `resetStageTree`

`domain/stage-aggregate.ts` 新增：

```ts
resetStageTree(io, home, ref): Promise<void> // 删除 <home>/merge/runs/<ref>/merged
```

- 只删 `merged/`，保留 `manifest.json`、`.stage`、`sources/`；
- ref 先过 `safeRunTree`，拒绝遍历；
- `new-child-authoring` 的 existing=present 分支：先 reset，再 set target；
- reset 失败返回 `staging-reset`（retryable，retryFrom agent2），不继续打开 child。

### 3.2 closeRow 清树

`runtime.ts` 新增本地 `dropRuntimeStage(io, home, row, now)`：

- ref 优先 `row.stagingRef`，否则读 staging-index；
- 调用 `dropStage` 删除 index + tree；
- 在所有“行离开 active 生命周期”的路径调用：
  - reject（pending→skipped）
  - discard（pending/approved/fuse→superseded）
  - skipped restore
  - resume clear
  - pair 覆盖可替换行
  - approve 的 source-gone 清理

### 3.3 测试

- new-child-authoring：预置旧 `merged/umbrella/references/old.md`，复用 stage 后 channel 看到空树；写入 SKILL 后树中无 old.md；结果 merged。
- runtime：reject 带 staging-index/tree 的 pending 行后，index 和 tree 都消失。
- 现有 reject/restore/cleanup 测试回归。

## 4. 边界

- 不改 stageKey（仍 pair-derived）；隔离由“每次 authoring 清空 + 关闭行清树”保证；
- 不清理 sources/（child 仍需读取）；不改变 manifest schema；
- approve 复用已存在 stage 的路径仍由 `setStageTreeTarget` 决定 target；本轮不处理 legacy 无 manifest 树。

## 5. 实现结果（2026-11-22，未发布）

- `stage-aggregate` 新增 `resetStageTree`（safe ref，只删 merged/）；new-child-authoring 复用 present
  stage 前先 reset，失败返回 `staging-reset`。
- `runtime` 新增 `dropRuntimeStage`，在 reject/discard/skipped restore/resume clear/pair cleanup/
  source-gone 路径删除 staging index + tree。
- 测试：new-child-authoring 旧 support 被清空；runtime reject 清 index/tree；
  new-child-authoring + runtime.spec = 2 files / 11 tests passed。
