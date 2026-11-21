# E1 设计：本地门禁解析当前构建线而非旧 overlay

范围：06-architecture P1-1：`run-gates local` 的 14/62 条记录在 `harness-0.2.1` 旧树判定；本机真实构建线是 `harness-rc3`，导致本地绿不代表镜像绿。

## 1. 已读依据

- `audit-2026-11-22/06-architecture.md` P1-1：`run-gates.mjs:53`、`lib-env.mjs:36-44`、实测 record 14/62。
- `packages/scripts/lib-env.mjs:31-39`：`overlayCandidates` 固定 `harness-0.2.1` / `deepseek-harness`；本机同时存在 `harness-rc3`，旧名先命中。
- `packages/scripts/run-gates.mjs:94`：`identityFor.adapterSha` 硬编码 `D:/dsh/_tools/lib-line.mjs`，本机 CI 上为 absent。
- `verify-env.mjs` 实测：修复前 overlay=`D:\dsh\harness-0.2.1`；修复后 `D:\dsh\harness-rc3`。
- 现有 overlay 选择是“首个存在的平台树”；候选顺序就是事实源。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| 旧 overlay 先命中 | I7 验证绑定事实 | 本地门禁/证据判旧树；路径树、生成器、依赖读数都不是当前实现 | 只影响本地/证据，不直接影响运行 |
| adapter identity 硬编码 | I7 | local record 的 adapterSha 不是实际解析器 | 证据身份字段失真 |

## 3. 设计

- `overlayCandidates`：在 workspace 候选里增加当前构建线 `harness-rc3`，放在历史 `harness-0.2.1`/`deepseek-harness` 之前；
  - `EVOLUTION_OVERLAY_ROOT` 仍最高优先；
  - 仍只返回存在的平台树由 `resolveOverlay` 判定；不存在的候选不会误选。
- `run-gates.identityFor.adapterSha`：改为 `sha8(resolveAdapter() ?? 旧 fallback)`，与 `lib-env` 的实际解析顺序一致。
- 文档：`CONTRIBUTING`/development 不另抄路径；`verify-env` 是 resolution table 的单一入口。

## 4. 验证

- `node packages/scripts/verify-env.mjs`：overlay=`D:\dsh\harness-rc3`，adapter=repo line-adapter。
- `node packages/scripts/run-gates.mjs local --list`：62 gates 能列出（overlay 解析成功）。
- `node packages/scripts/run-gates.mjs local --only gate-22 --json`：pass 1 / fail 0。
- 回退：删除 `harness-rc3` 候选/还原 adapterSha；不影响运行时代码。

## 5. 实现结果（2026-11-22，未发布）

- overlay 候选新增 `harness-rc3`（历史名保留 fallback）；
- identity.adapterSha 改为实际 `resolveAdapter()`；
- verify-env overlay=harness-rc3；local --list 62 gates；gate-22 pass 1/fail 0。
