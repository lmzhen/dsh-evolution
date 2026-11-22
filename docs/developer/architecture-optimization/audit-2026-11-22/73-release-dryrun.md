# 发布链 dev 演练（20 包，含 evolution-platform）

## 目的

验证改名后发布链能完整打包并识别新包身份，不发布、不 bump、不打 tag。

## 命令与结果

```text
node packages/evolution/scripts/prepare-release.mjs \
  --scope '@lmzhen' --version 0.0.0-dev --dev-build
```

```text
prepare-release: dev build — version reconciliation skipped
packed 20 packages -> .../packages/evolution/dist
```

20 个 tarball 中包含：

```text
@lmzhen/dsh-evolution-platform  24162 bytes 100 files
```

然后：

```text
node packages/evolution/scripts/publish-scoped.mjs --dry-run
```

```text
publish @lmzhen/dsh-evolution-platform@0.0.0-dev (dry-run)
...
publish run complete
```

## 说明

- 这是 **dev build**：staging 版本 `0.0.0-dev`，reconciliation 跳过，不是可发布版本；
- 没有调用 `npm publish` 的非 dry-run 路径，没有改正式版本、没有打 tag、没有触发 release workflow；
- 新包身份 `@lmzhen/dsh-evolution-platform@0.0.0` 和 Trusted Publisher 已在 [72](72-npm-platform-placeholder.md) 记录；
- 本地 `dist/` 属于构建产物，不提交。
