# P2：client-seat 几何门禁跟随真实注册入口

范围：07-ui-client P2-2。
- `verify-client-seats` 只扫描 `<pkg>/src/client/**` 的 `name: '<seat>'` 字面；
- 家族实际经 `registerSurface`/`registerSidebarPanel` 注册，icon 在 `panels/**`；
- 平台 `sidebar.panellist` 的 caller 用**简写** `{ size, active }`，旧检测器只认 `size:`，于是 4 个参数座、0 occupant、0 row，假绿。

## 设计

- `parameterizedSeats`：识别 `renderSlot(..., { size, active })` 的简写 `size`。
- 新增 geometry 扫描：
  - 遍历包 `src`（不只 `src/client`）；
  - 发现 `registerSurface(... { surface: 'sidebar', icon: <Name> })`；
  - 在当前文件或包内其他文件找 `<Name>` 的函数体；
  - 复用 `occupantProblems` 判 `width/height` 是否来自 `size`。
- 没有 icon 函数体时记 note（不能静默通过）。
- 现测：平台 5 个参数座（含 sidebar.panellist），1 个 occupant（WorkbenchIcon），0 problem。

## 验证

- `verify-client-seats packages --upstream D:\dsh\harness-rc3 --strict`：0；
- 新增负例：fixture 的 `registerSurface({surface:'sidebar', icon: DemoIcon})`，DemoIcon 用 26px 常量 → 必红，stderr 带 `sidebar icon DemoIcon` 与 `does not come from size`；
- `evolution-host` guard-scripts：38 tests passed。

## 回退

删除新增扫描/简写检测；保留旧字面路径。
