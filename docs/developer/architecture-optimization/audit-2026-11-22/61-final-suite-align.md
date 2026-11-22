# 全量套件对齐：S4 用例归位 + U5 适配 P2-3

全量套件复跑发现 2 个文件失败，均来自本轮 D12/P2-3 的接口改动：

1. **S4 HMR 用例**：改走 UI 包 `./src/*` export 后，全量套件无法解析该包导出；
   该用例本质测试 UI host 的 dispose/re-apply，已移到 `evolution-ui/tests/s4-hmr-double-apply.spec.ts`，
   改为包内 `../src/panels/history/host.ts` 导入；mutation fixture 与 `probes.json` 同步移动。
2. **U5 decision-facts 用例**：仍断言 `sectionSnapshotOf(...).reason === 'not-served'`；
   P2-3 已删除平台不存在的 reason 字段。改为断言 status 保持 unavailable、reason 为 undefined。

验证：

- `s4-hmr + settings-u5`: 2 files / 6 tests passed；
- `verify-probes`: 23 probes，spec set/mutation fixture 均存在；
- family test-lines/taxonomy 重生成；
- local gates: 61 pass / 0 fail / 3 cannot-decide；
- 全量套件最终复跑：442 files / 2431 tests passed（986.74s）。
