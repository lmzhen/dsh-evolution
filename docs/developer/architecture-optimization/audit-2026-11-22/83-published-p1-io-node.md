# 0.60.0 已发布：新装 merge IO provider P1 与 0.60.1 修复计划

## 事实（真实 npm 安装验收）

- 发布：tag `v0.60.0` 的 CI 全绿（platform line、两份 validate、cohort validate、desktop install、cohort evidence、publish、verify published bytes）；`@lmzhen/*@0.60.0` 20 包已从 npm registry 安装。
- 新 profile：`D:\dsh-homes\lab60npm`，`package.json` 仅依赖 `@lmzhen/dsh-evolution-all@0.60.0`，`pnpm install` 从 registry 解析到 20 个 0.60.0 包。
- 宿主：`dsh --profile web --port 3092` 启动；`/` 200、diagnostics 0.60.0、`/api/dsh-evolution/merge/view` 503 `merge-state-v4-required`；`/evolution merge status/view` 报 `no evolution IO provider registered`。
- 添加 profile patch（正确 `insert` 结构）：
  ```yaml
  - insert:
      - id: evolution-io-node
        name: '@lmzhen/dsh-evolution-core/io-node'
  ```
  重启后同一 npm 安装的 `merge/view` 200，diagnostics 200；证明问题在 **bundle 缺少 `evolution-io-node` 行**，不在 npm 包字节。

## 根因

0.60.0 的 `evolution-all` / `evolution-host` 的 `cordis.patch.yml` 只注册 `evolution-io`（registry）与 `evolution-io-platform`，没有注册 **node:fs provider**。平台 `fs` 在 web profile 不提供时 `io-platform` 无法注册 provider，merge 初始化即报 `no evolution IO provider registered`。旧 profile 因已有 merge state 掩盖了该缺陷。

## 修复（待用户确认版本）

- 在 `evolution-all` / `evolution-host` 的 patch 中增加：
  ```yaml
  - id: evolution-io-node
    name: '@lmzhen/dsh-evolution-core/io-node'
  ```
- 同步 host/all 两处 patch 与 `bundle-mutual-exclusion` 守卫、0.60.1 CHANGELOG/版本；重跑发布链。
- 发布版本必须是 **0.60.1**（不能覆盖 0.60.0）；用户已明确确认。

## 修复验证

- host/all 两处 patch 已加入 `evolution-io-node`；`bundle-mutual-exclusion` 新增守卫（4/4 pass）。
- 0.60.1 dist 全新安装到 `D:\dsh-homes\lab601`：`diagnostics` 200 / family-version 0.60.1，`merge/view` **200**（不再需要手工补 profile patch）。
- 发布链在 0.60.1 tag 上重跑。

## 当前状态

- npm：0.60.0 已发布（存在新装 P1，被 0.60.1 修复）；0.60.1 待发布。

