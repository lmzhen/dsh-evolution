# Phase F：退役 evolution-preset 活表面

范围：06-architecture D9 / 11-target Phase F。
目标：`evolution-preset` 不再是包、不再是 bundle patch、不再占生成器/门禁面。

## 已完成

- 删除 `packages/evolution-preset/`（package、cordis.patch.yml、cordis.yml、src、tests）；
- `bundle-rows.json`：
  - 删除 `forms.preset` 与 `forms.standalone`；
  - 删除 `evolution-io-node`、`storage`、`storage-json`、`storage-domain` 四个只属于 standalone 的 row；
  - all/host 生成物重生成；
- `lib-family-packages.mjs`：
  - `EVOLUTION_BUNDLE_TAILS` 去掉 preset；
  - `RETIRED_PACKAGE_DIRS/NAMES` 清空（目录已不存在）；
- `verify-bundle-rows` 只检查 all/host；
- `verify-declared-config`、`verify-composer-single-source`、`verify-arch-guards` 去掉 preset；
- `evolution-commands/doctor.ts`：
  - 主集合去掉 preset；
  - 独立 `LEGACY_PRESET_TAIL` 仅用于 0.46/0.47 profile 的旧 bundle 识别/清理；
- `evolution-host` 测试：
  - bundle 互斥测试只保留 all/host；
  - dependency-contract 去掉 preset subject；
  - 删除 one-click install 的旧冲突测试；
- `INSTALL.md`：preset 不再可安装，仅保留 `--uninstall --mode oneclick` 清理。

## 验证

- 包目录不存在；`bundle-rows` 只有 all/host；
- doctor/installer/guard-scripts：107 tests passed；
- `run-gates local`：61 pass / 0 fail / 3 cannot-decide；
- family 全量套件：442 files / 2426 tests passed（1009.83s）。

## 迁移

- 旧 one-click profile：`--uninstall --mode oneclick` 仍可清理；
- 新安装：只有 `evolution-all` / `evolution-host` / layered 三种形态；
- 不再发布 `@deepseek-ai/dsh-evolution-preset`。

## 回退

从 git 恢复 `packages/evolution-preset` 与 bundle-rows preset/standalone 形态，并重生成。
