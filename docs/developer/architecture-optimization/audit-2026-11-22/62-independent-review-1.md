# 独立复核第一轮：P1 修复

独立复核结论：P0=0，P1=3。本轮修三条。

## P1-1 A2：reject / expire / list 的跨进程 stale 写

- `reject()` 现在在 lease 内先 `refreshState()`，并在 claim 前检查 durable executed marker；已执行记录不再能被 B 宿主覆盖成 rejected。
- `expireStale()` 在 sweep 前 reload；每条记录在 per-id lease 内再次 reload，确认仍是 pending、仍过期，并检查 executed marker，再用新快照 claim。
- `list()` 在 sweep 后 reload 再读，GET 不再返回 sweep 前的旧窗口。
- 负例：预置 executed marker 后 `reject` 返回 false、record 仍 pending、rejected 0；spy 证明 reject 调用了 `reload()`。

## P1-2 E4：CI unit lane 预算

- `gates/unit.mjs` 的 gate-03 CI `timeoutMs` 从 480000 提到 2400000。
- 依据：实测全量套件 986.74s；CI lane 还多 72 个 ci-only spec。480s 必然杀进程，后续 probe baseline 也缺失。
- `gate-manifest`/`checks` 重新生成；`verify-gate-manifest` 0。

## P1-3 E3：traceability 绑定 measured commit

- release 门新增：traceability 必须给出 `measuredCommit`，或 `source` 中可解析的 sha；且必须等于 evidence 的 `measuredCommit`。
- 旧 rehearsal 的 traceability source 是 `567020ea`，spikes commit 是 `67eb0c3a`，现在 release 会直接失败，必须重新测量；不伪造新字段。
- 负例：`measuredCommit` 改成另一个 sha 必红；assembly/release 测试 15 passed。

## 剩余（记录）

- `release-evidence-rehearsal.json` 仍是旧数据，下一次发布前必须重测 S1-S4 与 traceability；这是预期失败，不是本轮伪造。
- 复核提到的 A2 review/curator lease 500ms、approval marker 清理、CI 全量实跑仍未在本轮关闭，继续跟进。
