# 独立复核第二轮：三条 P1 关闭确认与残余 P2 登记

复核对象：HEAD `7b832055`（A2/E4/E3 三条 P1 修复）。
复核方式：独立 agent 只读审查 + 定向执行 + 本地门禁。

## 结论

- 三条 P1 均 **closed**；
- 未发现新的 P0/P1；
- 定向 `approval.spec.ts + release-evidence.spec.ts`：2 files / 51 tests passed；
- `run-gates local`：61 pass / 0 fail / 3 cannot-decide；
- `gen-gate-manifest --check` / `verify-gate-manifest`：OK；
- 修复后全量 family suite：442 files / 2432 tests passed（1000.72s）。

## 残余 P2（DEFERRED）

| 项 | owner | expiry | 判据 |
|---|---|---|---|
| ~~A2 executing-rescue 无 claim~~ **已关闭** | approval | — | reject 的 rescue 先看 `claimedBy` 的 pid；live foreign pid 拒绝，补了负例 |
| ~~A2 list/expire 双 reload~~ **已关闭** | approval | — | TTL>0 只由 expireStale reload；TTL=0 list 自己 reload 一次 |
| ~~E3 traceability source fallback~~ **已关闭** | release | — | release 只接受结构化 `traceability.measuredCommit`；缺字段/不一致均红 |
| A2 approve 在 TTL>0 时 expire+lease 内各 reload 一次 | approval | 下一 minor | 两次 reload 是跨进程 freshness 与 lease 内重读的保守设计；合并需证明中间窗口无 claim 竞争，暂登记 DEFERRED |
| merge 首次激活 refresh 与 start 各加载一次 | merge-ui | 下一 minor | token 防旧响应，仅多一次 host read；先不做 ref 优化，避免新增 hook 分支 |
| E3 artifacts 只与证据自比，不校验应发布 22 包集合 | release | 下一 minor | 与发布包清单对账 |
| ~~E4 40min CI 预算~~ **已关闭** | gates | — | `full(ci=on)` 实跑 513 files / 3080 tests / 1118.44s，见 [65](65-ci-lane.md) |
| A3 `prepared-unit recovery left N unresolved` 仍是 warn | core-write | 下一 minor | 区分测试夹具污染与真实残留，并给清理/拒绝判据 |

`release-evidence-rehearsal.json` 仍是旧数据：spikes `67eb0c3a`、traceability source `567020ea`；
新 release 门会拒绝，下一次发布前必须重测 S1-S4 与 traceability，禁止沿用。
