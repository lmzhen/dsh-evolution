# P2：history 读 ticket 按 kind 分开，刷新不再作废展开

范围：07-ui-client P2-10。
- `useSkillHistory` 用一个 `readTicket` 管 rows / preview / diff 三类读；
- 先展开预览（ticket N+1），再点刷新（ticket N+2），预览回复按 `dropIfTicket` 丢掉；
- 行回到 `expandedOf = null`，第一次点击变成收起，读者要点两次。

## 设计

- `readTickets = { versions, preview, diff }`，每类读只递增自己的 ticket；
- `selectedRef` 标记当前 skill：
  - preview/diff 回复同时检查 `selectedRef === name`；
  - 切换 skill 时 `showVersions(!keepContent)` 还递增 preview/diff，清掉旧 skill 的 lazy 读；
- 刷新走 `showVersions(keepContent=true)`，只递增 versions，不动 preview/diff；
- 原有“后一次展开 supersede 前一次”的行为保留（preview ticket 仍递增）。

另核对 P2-9：`undo.reloaded` 的文案本身已是“已回退，但版本列表没读出来；刷新一下就能看到”，不是“已重新载入”；不改。

## 验证

- build 0；
- history-panel: 14 tests passed；
- 新增 P2-10 用例：
  - 打开 alpha，默认预览 `# one` 已显示；
  - 点刷新，versions 读 2 次；
  - `# one` 仍在，loadBody 仍只有 1 次；
- 既有“preview 被后一次 toggle supersede 后重读”“晚到 rows 被丢弃”仍通过。

## 回退

恢复单一 `readTicket`；无数据/schema 变更。
