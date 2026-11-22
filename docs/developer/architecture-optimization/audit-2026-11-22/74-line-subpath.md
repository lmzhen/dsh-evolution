# 测试线：family source 子路径进入 line manifest

## 背景

`evolution-platform` 改名后，`line-adapter` 为了不让 built `lib/*.js` 抢先注册，新增了 family source 子路径 alias（kind `evo-src-subpath`）。但：

- `line-policy.json` 的 `allowedKinds` / `familyKinds` 没有这个 kind；
- `gen-line-manifest` 只记录 family 包根，43 个 source 子路径不进 line-identity manifest；
- 结果是测试走源码，但 line gate 看不到这批 alias。

## 修复

- `line-policy.json` 增加 `evo-src-subpath` 到 `allowedKinds` 和 `familyKinds`；
- `gen-line-manifest` 为每个 family 包的 `./lib/*.js` 导出生成对应 `src/*.ts` 子路径 entry；
- 重新生成 `line-manifest.json`：62 entries（18 包根 + 43 子路径 + 1 profile hoist）；
- `tsconfig.base.json` 补 `@deepseek-ai/dsh-evolution-platform/review-child` 别名；
- `71-platform-renamed.md` 的 `adapter/contract` 文案改为 `platform/contract`。

## 验证

```text
gen-line-manifest: 62 entries, lineId=073163dca04b
run-gates local: 61 pass / 0 fail / 3 cannot-decide
```
