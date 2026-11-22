# P2：merge tab 跟随 view ledger 响应式；落地计数走共享解析

范围：07-ui-client P2-7。
- `history/client/index.ts` 的 `hasView` 每次现读 `ctx.slots.entries('evolution.workbench.view')`，不订阅；
  merge-ui 晚于 workbench 首帧注册时 tab 缺失，直到偶然重渲染；
- 同一处 `loadTaskCounts` 用裸 `fetch` + 手写 `counts.active.pending` 解析 merge view，
  与 merge-ui `api.view()` 的 wireVersion 校验构成两份契约解析。

## 设计

- `WorkbenchFace` 新增 `subscribeViews?: (listener) => () => void`；
- history apply 通过 `ctx.slots.subscribe('evolution.workbench.view', listener)` 提供；
- `WorkbenchPage` 用 `useSyncExternalStore(subscribeViews, () => hasView('merge'), ...)` 读 tab 存在性；
- 无 `subscribeViews` 的测试 host 保持原样；
- 新增 client-kit `fetchMergePendingCount`：
  - 读 `ROUTES.merge.view`；
  - 要求 `wireVersion === 1`；
  - 只读 `counts.active.pending`，非数字/失败/旧版本一律 0；
- history 的 `loadTaskCounts` 改用它，不再手写 merge 响应解析。

## 验证

- build 0；
- client-kit merge-count 2 tests；history-workbench + history-client-apply 15 tests passed；
- 新增用例：
  - `hasView` 从 false 变 true，listener 触发后 merge tab 出现；
  - wireVersion 2 / 非 200 / malformed counts 均返回 0。

## 回退

恢复现读 entries + 内联 fetch；无数据/schema 变更。
