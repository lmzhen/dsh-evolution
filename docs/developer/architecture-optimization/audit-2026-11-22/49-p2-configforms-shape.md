# P2：configForms 手抄形状删到平台真有的字段

范围：07-ui-client P2-3。
- `client-kit/src/seam.ts` 在平台 `ConfigForm` 的 `getSnapshot/subscribe/mutate/set/unset` 之外，
  还声明了 `save/refresh/dispose`、`ConfigWriteKind/ConfigWriteOutcome`；
- settings 的 `ParamSectionSnapshot` 另带 `reason/stale`；
- 这些字段生产端从不提供，对应 UI/分支不可达：
  - `ParamCard` 的 `saveOnce/readback/kind`；
  - `readbackStale`、`saveReadbackFailed`、`saveConflict`、`projectionFailed`；
  - `source.ts` 把不存在的 `reason/stale` 投影出来。

## 设计

- client-kit `ConfigFormLike` 只保留平台五个方法；删除 `ConfigWriteKind/ConfigWriteOutcome` 及其导出；
- settings `SettingsSaveResult` 删除；
- `ParamSectionSnapshot` 删除 `reason/stale`，只保留平台快照六字段；
- `source.ts` 不再伪造 reason/stale；
- `ParamCard`：
  - 删除 `saveOnce` 分支与 readback/kind 状态；
  - 保存只走 `mutateOnce`，host 的 boolean 就是唯一判定；
  - 不可用状态只显示 `unavailable`（seat 缺失由 `RowConfigCard` 的 `seatMissing` 负责）；
  - 删除 stale note。

## 验证

- build 0；
- settings 相关 + client-kit：5 files / 19 tests passed；settings 4 files / 31 tests passed；
- `settings-row-config` 的 seatMissing 仍通过；
- 无生产/测试调用 `saveOnce`/`save`/`refresh`/`dispose`。

## 回退

恢复手抄字段与分支；无数据/schema 变更。
