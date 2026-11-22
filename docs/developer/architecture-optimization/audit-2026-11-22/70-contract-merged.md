# Phase F：把 `evolution-platform-contract` 并入 `evolution-adapter`

范围：11-target Phase F「`evolution-adapter` / `evolution-platform-contract` → `evolution-platform`」的第一步。

## 已完成

- 删除 `packages/evolution-platform-contract/`；
- 20 个契约源文件移入 `packages/evolution-adapter/src/contract/`；
- `evolution-adapter` 新增公开子路径：
  - `@deepseek-ai/dsh-evolution-adapter/contract`
  - `/contract/result`
- 全仓 97 处 import 改到 adapter 子路径；
- adapter 自身源码改成相对 `./contract/index.ts` / `./contract/result.ts`，不再自引用包名；
- `zod` 依赖并入 adapter；adapter 不再依赖 contract 包；
- 全仓 package.json / tsconfig references / bundle rows / `row-contract` / line-manifest / plugin-meta / package map / 安装计数同步；
- 包数 21 → 20。

## 边界

- 本轮是包合并，不是最终 `evolution-platform` 改名；
- 契约仍是手工维护文件，`ports.generated.ts` 生成化尚未做；
- 无运行时行为变化，无 UI/提示词变化。

## 验证

- `build-lib`: 0；
- adapter + 受影响 core/tool-skill-manage：6 files / 26 tests passed；
- `run-gates local`: 61 pass / 0 fail / 3 cannot-decide；
- 全量 family 套件：442 files / 2429 tests passed（1073.99s）；首跑 rg3-crash 的 pid 读取竞态已改为等待正 pid（taskkill /PID 0 不再可能）。

## 回退

从 git 恢复 `packages/evolution-platform-contract`、import/package/tsconfig 改动；无数据迁移。
