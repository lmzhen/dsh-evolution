# P2：删除 manifest 新鲜度的死开关

范围：08-tests-debt P2 #12（死开关/机器路径）。
- `verify-gate-manifest.mjs:62` 的 `SKIP_MANIFEST_FRESHNESS=1` 全仓无人设置；
- 可作为旁路跳过 registry -> manifest/CONTRIBUTING 的新鲜度检查。

## 设计

- 删除 `process.env.SKIP_MANIFEST_FRESHNESS` 条件；`freshnessArmed` 时始终执行 `gen-gate-manifest --check`。
- overlay 布局没有 `CONTRIBUTING.md` 时仍不执行（既有布局原因，不是旁路）。
- 无新配置/API；`--report` 与 strict 行为不变。

## 验证

- `gen-gate-manifest --check` 0；
- `verify-gate-manifest packages --report` 0；
- arch guards 0。

## 回退

恢复环境变量条件即可；只影响该检查是否执行。

## 实现结果（2026-11-22，未发布）

- 已删除 env 条件；manifest 新鲜度不可再被旁路。
