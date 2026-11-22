# P2：panel workspace id 从平台 sessions/workspaces 取

范围：07-ui-client P2-4。
- `panelWorkspaceId` 依次看 `workspace.workspaceId`、`uiWorkspace.currentWorkspaceId`；
- 平台 rc.5 没有 `workspace` 服务，`uiWorkspace` 也没有这两个字段；
- 结果恒 undefined → merge 排序恒落 `local`，所有工作区共用一份手排顺序；face 在 apply 只取一次，切工作区也不刷新。

## 设计

- `panelWorkspaceId` 按平台自己的写法取：
  1. `sessions.list.getSnapshot().byId` 中 `retainedBy.mainView > 0` 的 session；
  2. `workspaces.list.getSnapshot().items` 中 `sessionIds.includes(sessionId)` 的 `workspaceId`；
  3. 任一服务缺失/为空 → undefined（local scope）。
- 删除两个不存在的服务字段读取。
- merge `MergeFace.workspaceId` 改为 `string | (() => string | undefined)`；注册时传 `() => panelWorkspaceId(ctx)`，Panel 每次渲染调用；测试改为函数形态。
- `MergePanel` 其它逻辑不变。

## 验证

- build 0；
- client-kit + merge-ui sorting：5 files / 14 tests passed；sorting 3 tests passed；
- 负例：无 sessions / 无 workspaces / session 无 mainView → undefined；
- 无 `workspace.workspaceId`、`currentWorkspaceId` 读取。

## 回退

恢复旧读取（回到恒 local）；无数据/schema 变更。
