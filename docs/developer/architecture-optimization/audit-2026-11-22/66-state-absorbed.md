# Phase F：吸收 `evolution-state` 包

范围：11-target Phase F 「删 evolution-state」/ 目标包结构 `evolution-kernel`。

## 已完成

- `packages/evolution-state/` 整个目录删除；
- 源码移入 `evolution-core/src/state/`：
  - `index.ts`（EvolutionState service）
  - `storage.ts`（registry + seam）
  - `constants.ts` / `record-contract.ts` / `conformance.ts` / `medium-declaration.ts`
  - `domain/`（storage-domain provider）
- `evolution-core` 新增公开子路径：
  - `@deepseek-ai/dsh-evolution-core/state`
  - `/state/storage`
  - `/state/domain`
- 全仓 import 从 `@deepseek-ai/dsh-evolution-state*` 改为 core/state 子路径；
- composition row 名称改为 core/state 子路径，row id 保持不变（迁移/审计兼容）；
- tsconfig references、package dependencies、line-manifest、plugin-meta、参数 registry、package map 同步；
- `evolution-state` 的测试搬到 `evolution-core/tests/state/`。

## 边界

- 本轮是 **包吸收**，不是 Phase D 完成：storage-domain provider 仍是当前默认媒体，StateStore 统一 transact/迁移仍待 Phase D。
- 旧用户的 domain 数据路径不变，因为 domain provider 实现与 row 配置原样保留。
- 目标包数 22 → 21。

## 验证

- `build-lib` 0；
- core state 6 files / 41 tests passed；
- `run-gates local`: 61 pass / 0 fail / 3 cannot-decide；
- 全量 family 套件：442 files / 2426 tests passed（1028.20s）。

## 回退

从 git 恢复 `packages/evolution-state`、import/row/tsconfig 改动；无数据迁移。
