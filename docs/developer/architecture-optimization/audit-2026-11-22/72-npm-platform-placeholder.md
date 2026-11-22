# 新 npm 包身份：`@lmzhen/dsh-evolution-platform@0.0.0`

## 背景

`evolution-adapter` 改名为 `evolution-platform` 后，发布包名是新的 `@lmzhen/dsh-evolution-platform`。npm 要求新包先手工发布一次占位版本，之后才能由 GitHub Actions Trusted Publisher 发布正式版本；`publish-scoped` 也会拒绝 registry 上不存在的包。

## 已完成

- 手工发布占位：

```text
@lmzhen/dsh-evolution-platform@0.0.0
```

- 配置 GitHub Actions trusted publisher：

```text
id:            e3522147-180d-40c6-849f-1051175afc9d
type:          github
repository:    lmzhen/dsh-evolution
file:          release.yml
environment:   npm-publish
permissions:   createPackage, createStagedPackage
```

- 只创建新包身份；没有 bump 家族版本、没有打 tag、没有触发 release workflow、没有发布任何插件版本。

## 验证

```text
npm view @lmzhen/dsh-evolution-platform version  -> 0.0.0
npm trust list @lmzhen/dsh-evolution-platform    -> 上述唯一 trusted relationship
```

## 回退

占位包 0.0.0 是独立包身份，不回退；如最终放弃该包名，npm 侧另行处理，不影响仓库历史。
