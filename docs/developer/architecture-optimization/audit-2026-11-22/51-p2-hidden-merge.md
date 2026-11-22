# P2：非活动 merge 视图不启动 host 读，也不挂 focus 监听

范围：07-ui-client P2-5。
- Workbench 把 merge 视图常驻挂载，只用 `hidden` 隐藏；
- `MergePanel` 挂载后无条件 `store.start()`，并注册 `window focus`、`visibilitychange`、自定义刷新事件；
- 用户停在 history 页时，每次切回窗口都会发 view+rows 两个 host 读。

## 设计

- `MergeView` 只在 `activeView === 'merge'` 时渲染 `MergePanel`，非活动返回 `null`；
- `MergeStore` 仍由 client apply effect 持有，unmount 不 dispose（原有生命周期测试覆盖）；
- 回到 merge tab 时重新挂载；`MergeStore.start()` 在 store 已启动时走 `refresh()`，首次挂载仍只加载一次，不在 inactive 时后台读。排序/筛选状态在 store 与 localStorage，不丢。

## 验证

- build 0；
- merge-ui 全部 15 files / 54 tests passed；
- 新增 lifecycle 用例：`activeView='history'` 时 `source.view` 0 调用；切到 `merge` 后才调用；
- 原有 unmount 不 dispose 的测试仍通过。

## 回退

恢复 hidden 常驻挂载；无数据/schema 变更。
