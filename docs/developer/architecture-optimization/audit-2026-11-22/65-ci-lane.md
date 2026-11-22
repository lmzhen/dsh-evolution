# E4：真实 CI 形态全量套件计时

独立复核曾指出：gate-03 的 40min 预算是按本地 `full(ci=off)` 986s 推断，缺真实 `full(ci=on)` 证据。

本轮在 overlay 上按 CI 形态实跑：

```text
CI=true FAMILY_TIER=full \
  node node_modules/vitest/vitest.mjs run \
  -c packages/evolution/scripts/vitest.family.config.mjs \
  --maxWorkers=2 --testTimeout=120000
```

结果：

```text
lane=full(ci=on)
Test Files 513 passed (513)
Tests      3080 passed (3080)
Duration   1118.44s
exit       0
```

对照 gate-03 的 `timeoutMs: 2400000`（40min），实测 1118s，余量约 2.15 倍；原 480s 预算确实会在套件中途杀进程。

结论：E4 的“CI 预算不足”P2 关闭。仍需在真实 GitHub runner 上重复一次（机器差异），但本地 CI 形态已不再依赖推断。
