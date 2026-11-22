# P2：删除 client-kit / history 的死契约与假 face

范围：07-ui-client P2-11（死契约部分）。
- `SidebarPanelSpec.store` 全仓无调用方；
- `PanelBodyOptions` 没有 `children`，真实注册靠对象展开绕过；
- `history/client/ids.ts` 的 `PANEL_ID='skill-history'` 无人引用（注册用 `WORKBENCH_ID`）；
- `history/client/index.ts` 的 stats face 五个字段（`view/onView/layout/openSkill/onOrganize`）在 `Workbench.ts` 全部被覆盖，属必填假面。

## 设计

- 删除 `SidebarPanelSpec.store` 与注册时的 store spread；
- `PanelBodyOptions` 补 `children?`，与真实 main keyed 注册一致；
- 删除 `PANEL_ID`；
- `WorkbenchFace.stats` 改为
  `Omit<StatsFace, 'view' | 'onView' | 'layout' | 'openSkill' | 'onOrganize'>`；
- history face 只提供 `{ t, loadStats }`，Workbench 仍负责其余受控字段。

## 暂缓项（DEFERRED）

- `useSkillHistory.ts` 约 350 行、5 种状态机同文件；拆分属于独立重构，不在本轮做。
  - owner：client-history
  - expiry：下一 minor
  - 判据：拆成 list/versions/read-cache 三个模块，行为测试不变；
- settings 生成物仍在 `panels/settings/`，kit 生成物在 `src/generated/`；统一目录需同步改生成器和 gate。
  - owner：client-codegen
  - expiry：下一 minor
  - 判据：`gen-param-client-view`/`gen-param-i18n` 输出到 `src/generated/`，`verify-*` 重新指向。

## 验证

- build 0；
- history-workbench + history-panel + client-kit panel：3 files / 24 tests passed；
- 无 `store`/`PANEL_ID` 引用。

## 回退

恢复字段；无数据/schema 变更。
