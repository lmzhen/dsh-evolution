# E7 收尾：falsifiability-carrier 的 4 条 ci-only 行补载体说明

范围：08-tests-debt P1-5 的剩余 4 条：
- `ci-only-20` verify-core-surface
- `ci-only-21` verify-exemptions
- `ci-only-23` verify-param-consumers
- `ci-only-26` verify-test-lines

四行在 `drill-declarations.json` 中既没有 `drillCmd` 也没有 `noDrillReason`，falsifiability-carrier 轴因此一直有 4 条 observation；`checks.pendingAxes` 把这 4 条登记为 debt，但轴本身不会红。

## 设计

- 四行是 overlay-only CI 检查：mutation prover 在 mirror 上应用 fixture，overlay 行看不到 patch（TREE MISMATCH 是设计），因此不能有真实 drill。
- 给四行补 `noDrillReason`，明确“为什么不能 drill”和 CI 真实执行位置；不再用 pendingAxes 登记一个不会红的数字。
- 删除 `checks.pendingAxes.falsifiability-carrier` 条目（该数字已不再成立）。

## 验证

- `verify-gate-manifest --report`: falsifiability-carrier 0；
- `verify-check-registry --strict`: 8 pass / 0 registered / 0 fail；
- gate-manifest / checks fact / mutation ledger 不变（仅 drill 声明与 pendingAxes 变化）。
