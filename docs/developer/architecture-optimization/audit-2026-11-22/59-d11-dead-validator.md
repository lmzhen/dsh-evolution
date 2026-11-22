# D11：删除无调用的 architecture-baseline 验证器与旧基线

范围：06-architecture D11 / Phase F 死面清理。
- `packages/scripts/verify-architecture-baseline.mjs` 不在 92 行 manifest、无调用者；
- `architecture-baseline.json` 的 spec 路径指向不存在的 `packages/evolution/...`，tag/commit 停在 `v0.49.0`/`aeedc8fe`；
- 当前树已是 0.59.6 之后。

## 设计

- 删除 `verify-architecture-baseline.mjs`；
- 删除 `architecture-baseline.json`；
- `characterization.md` 的“一键基线验证”改为历史说明：当前验证以 `run-gates local` 与 audit README 为准；
- audit README 的 D11 死面条目标明已删除。

## 验证

- `rg verify-architecture-baseline|architecture-baseline.json` 无脚本/门禁引用；
- doc facts / arch guards 0；
- local gates 待跑。

## 回退

从 git 恢复两文件；无运行时行为变更。
