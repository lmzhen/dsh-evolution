# F3/F4 设计：刷新失败可见与延迟读可重试

范围：07-ui-client P1-2/P1-3：
- F3 `StatsPage` 刷新失败静默保留旧表，无失败提示；
- F4 diff/body 失败态写入缓存后，`toggle` 直接命中缓存，不能重试。

## 1. 已读依据

- `audit-2026-11-22/07-ui-client.md` P1-2/P1-3；README F3/F4。
- `StatsPage.ts:65-76`：refresh catch 里 `current.status === 'ready' ? current` 保留旧快照，无失败态。
- `useSkillHistory.ts:247-252`：`if (kind==='diff'?diffs.has(v):bodies.has(v)) return` 对 failed 也命中；失败态写进同一 Map。
- 同仓 `DiagnosticsCard.ts:196-215` 已有 refreshFailure strip 的正例。
- 测试：`stats-page-layout.client.spec.ts`、`history-panel.client.spec.ts`。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| F3 刷新失败静默保留旧表 | I7 投影可信 | 旧数据当新数据；读者无法区分“没变”与“没读到” | 仅刷新失败；不损坏数据 |
| F4 失败缓存不可重试 | I5 可恢复 | 一次网络抖动后展开永久失败；只有重开/刷新恢复 | 仅延迟读；不损坏数据 |

## 3. 设计

### F3

- 新增 `refreshFailure` 与 `retryToken`；
- 刷新 catch：
  - 首次加载失败 → `load.status='failed'`（原行为）；
  - 已有 ready → 保留 table，同时 set `refreshFailure(message)`；
  - 成功 → clear failure。
- ready 视图的 table-card 顶部渲染常驻 strip：
  - 文本：`stats.failed` + 错误消息；
  - 按钮：`refresh`，点击 `retryToken+1` 触发 effect。
- 首次失败仍走原 failure block；不重复显示两种失败。

### F4

`toggle` 先取 cached：

- 已展开同一行：
  - cached 不是 `failed` → 收起（原行为）；
  - cached 是 `failed` → 不收起，继续往下重新读。
- 未展开/其他行：
  - cached 存在且不是 failed → 直接 return（原行为）；
  - cached 是 failed → 重新读。
- 重新读会 set loading，ticket 逻辑不变；失败仍写 failed，下一次点击仍可重试。

## 4. 测试

- F3：loadStats 第 2 次 reject；rerender 触发 refresh；断言 strip 出现且保留表；点 refresh 第 3 次成功 strip 消失。
- F4：loadBody 第 1 次 reject，第 2 次 resolve；打开 skill 后点同一 preview，断言再次请求并显示内容。
- `evolution-ui` 全量回归。

## 5. 回退

- 两处 UI 状态/分支；回退恢复静默保留/失败缓存；无 API/schema 变更。

## 6. 实现结果（2026-11-22，未发布）

- F3：StatsPage 增 refreshFailure strip + retryToken；刷新失败保留旧表但显式提示，按钮可重试。
- F4：useSkillHistory.toggle 对 failed 缓存不再直接 return，同一行/第一次点击都会重新读。
- 新增两条负例；evolution-ui 全量 37 files / 203 tests passed；build 0。
