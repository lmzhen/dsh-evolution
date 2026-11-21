# P2：文档声明与当前门禁对齐

范围：08-tests-debt P2-13。
- `docs/developer/architecture-optimization/README.md` 仍是 0.49-0.50 执行快照，却写“当前进度 2026-11-19”“4 lane 读数来自 0.49.0”；
- `characterization.md` 的全量 merge 基线停在“>13 分钟未跑完”；
- `CONTRIBUTING.md` 写 `all 84 steps`，`gate-manifest.json` 实有 92 行（84 numbered + 8 CI-only）。

## 设计

- `architecture-optimization/README.md`：
  - 顶部加“历史快照（0.49-0.50）”横幅；
  - 当前状态段落改为指向 `audit-2026-11-22/README.md`，不再把历史读数当当前证据。
- `characterization.md` 顶部加历史快照提示。
- `CONTRIBUTING.md` 标题改为 `84 numbered steps + 8 CI-only manifest rows`；
- `family-facts.json` 的 gate-set `must` 同步该 canonical statement。

## 验证

- doc facts: 0；
- arch guards: 42 clean；
- gen-gate-manifest --check: 0。

## 回退

恢复旧文案与 fact；无代码/配置变更。
