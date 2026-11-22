# P2：load-more 失败保留已显示行和游标

范围：07-ui-client P2-6。
- `MergeStore.loadQueue` 的 `keepRows` 只对 `cursor === undefined` 成立；
- load-more（带 cursor）失败走 `{status:'error', rows:[]}`，把前几页一起丢掉；
- `Panel` 又只在 `queue.status === 'error'` 时显示 failure，列表整块消失。

## 设计

- 只要当前 cache 已有行，失败就保留：
  - `status:'ready'`、`refreshing:false`、原 rows；
  - 保留原 `nextCursor`，load-more 可以重试；
  - `failure` 单独挂在队列上。
- 只有“此前没有任何行”才进入 `error + rows:[]`。
- Panel 的 `activeFailure` 改为直接读 `queue.failure`，不再要求 `status === 'error'`；
  列表、failure 提示、load-more 按钮可以同时存在。
- 首次加载失败仍走空 error，不伪造旧数据。

## 验证

- build 0；
- MergeStore + panel：2 files / 22 tests passed；
- 新增用例：
  - 第一页 p1 + cursor-2；
  - loadMore 返回 server failure；
  - 结果 status=ready、rows=[p1]、nextCursor=cursor-2、failure=problem；
  - rows 第二次调用带 cursor-2。

## 回退

恢复 cursor-defined 失败清空；无数据/schema 变更。
