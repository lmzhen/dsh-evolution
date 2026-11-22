# D12：测试跨包 reach-in 改走包导出

范围：06-architecture D12 / Phase F 验证面收口。
审计列的 5 处测试直接 import 另一包的 `src/*.ts`：

- `evolution-core/tests/unit-backend.spec.ts` → `evolution-merge/src/*`；
- `evolution-core/tests/unit-transaction.spec.ts` → `evolution-merge/src/unit-protocol.ts`；
- `evolution-host/tests/s4-hmr-double-apply.spec.ts` → `evolution-ui/src/panels/history/host.ts`；该用例搬到 `evolution-ui/tests`，改为包内相对导入；
- `evolution-review/tests/review-executor-skill-write.spec.ts` → `tool-skill-manage/src/index.ts`；
- `evolution-skill-discovery/tests/main-entry*.spec.ts` → `evolution-core/src/io-registry.ts`。

## 设计

- `evolution-merge` 根导出补 `MergeUnitTransactions`、`unitEvidenceDigest`、`UnitBackend`、`UnitPlan`、`skillLibraryUnitBackend`；
  core 测试改从包根导入；
- S4 HMR 用例搬到 UI 包，包内 import；
- review 测试改从 `@deepseek-ai/dsh-tool-skill-manage` 根导入；
- skill-discovery 两处改从 `@deepseek-ai/dsh-evolution-core/io-registry` 导入；
- 测试不再绕过包导出与 `.d.ts`。

## 验证

- build 0；
- unit-backend 1 test；unit-transaction 18 tests；s4-hmr / review / main-entry 共 7 tests；
- 全仓测试无 `../../<pkg>/src` 形态的跨包 reach-in。

## 回退

恢复测试相对 import；无运行时行为变更（merge 根多导出是新增面）。
