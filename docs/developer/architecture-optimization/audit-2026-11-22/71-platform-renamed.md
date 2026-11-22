# Phase F：`evolution-adapter` 改名 `evolution-platform`

范围：11-target Phase F「`evolution-adapter` / `evolution-platform-contract` → `evolution-platform`」的命名收口。

## 已完成

- 目录 `packages/evolution-adapter/` → `packages/evolution-platform/`；
- 包名 `@deepseek-ai/dsh-evolution-platform`；
- 全仓 import、package.json、tsconfig references、bundle row id/name、row-contract、line-manifest、plugin-meta、package map、安装计数同步；
- 插件导出名 `evolution-platform`；
- `line-adapter` 增加 family source 子路径 alias：测试直接走源码，不再被 platform-package scan 先注册的 `lib/*.js` 抢占；否则 `lib/values.js` 的 peer import 在 overlay 里无法解析；
- 两个 core spec 从平台包根导入改为 `../../evolution-platform/src/ports.ts`，避免测试床对已构建包的二次解析。

## 边界

- 这是命名/包边界收口，不是行为变更；
- 契约仍是 adapter/contract 下的手写文件，`ports.generated.ts` 生成化未做；
- 包数保持 20；
- 无 UI、提示词、aux 前缀缓存变化。

## 验证

- `build-lib`: 0；
- 全量 family 套件：442 files / 2430 tests passed（1096.83s）；
- `run-gates local`: 61 pass / 0 fail / 3 cannot-decide。

## 回退

git 恢复目录/包名/import/row 改动；无数据迁移。
