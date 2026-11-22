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
| A2 executing-rescue 仍无 claim，在途 approve 可能被 reject 覆盖为 rejected | approval | 下一 minor | 只允许“pid 已死”的 rescue，并补双进程负例 |
| A2 list/expire 每条记录 reload，TTL>0 时 pending 轮询有抖动/O(n) | approval | 下一 minor | GET 走 listReadonly 或轻量 freshness；expire 负例覆盖 reload/marker |
| E3 traceability 的 source fallback 可能把其他 40-hex 当 commit | release | 下一 minor | release 只接受结构化 `traceability.measuredCommit`，并补 parser 误判测试 |
| E3 artifacts 只与证据自比，不校验应发布 22 包集合 | release | 下一 minor | 与发布包清单对账 |
| E4 40min CI 预算是按本地 986s 推断，缺一次真实 `full(ci=on)` 计时 | gates | 下一个发布候选 | CI 实跑一次并落盘 |
| A3 `prepared-unit recovery left N unresolved` 仍是 warn | core-write | 下一 minor | 区分测试夹具污染与真实残留，并给清理/拒绝判据 |

`release-evidence-rehearsal.json` 仍是旧数据：spikes `67eb0c3a`、traceability source `567020ea`；
新 release 门会拒绝，下一次发布前必须重测 S1-S4 与 traceability，禁止沿用。
