# 发布 scope：@lmzhen

最终 npm 包发布在 **`@lmzhen`** 空间，不是 `@deepseek-ai`。

## 现状核对

- `.github/workflows/release.yml` 固定 `NPM_SCOPE: '@lmzhen'`，并传给 validate/cohort/publish 各 job；
- `prepare-release.mjs` 的 `--scope` 用于把源码包名 `@deepseek-ai/dsh-evolution-*` 重写为 `@lmzhen/dsh-evolution-*`；
- `README.md` 的安装命令使用 `@lmzhen/dsh-evolution-all`；
- `publish-scoped.mjs` 按 staging manifest 的 `@lmzhen` 包名发布。

## 本轮新增防线

- `prepare-release.mjs`：非 `--dev-build` 的发布构建，`--scope` 必须是 `@lmzhen`，否则 exit 2；
- 负例：`installer.spec.ts` 以 `--scope @wrong` 调 prepare-release，断言 exit 2 且 stderr 含 `release scope must be @lmzhen`。

## 验证

- `installer.spec.ts`: 32 tests passed；
- `run-gates local`: 待跑。
