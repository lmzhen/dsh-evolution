# C1 设计：merge 恢复分支 B 的 rollback 兜底

范围：P1-1（审计 04-merge-undo）：`target-written`/`support-pending`/`source-archiving` 阶段进程崩溃后，生产恢复只 `rollForward`；checkpoint 缺失或 source 仍 live 时 `rollForward` 必失败，unit 永久卡住。

## 1. 已读依据

- `audit-2026-11-22/04-merge-undo.md:19-21`：分支 B 位置、rollForward 条件、rollback 可用证据。
- `audit-2026-11-22/10-system-framework.md`：I5 可恢复、I8 生命周期闭合。
- `recovery-coordinator.ts:27-33,69-95`：branch 表与 B 只 rollForward；
- `unit-protocol.ts:537-573`：rollForward 要求全部 source checkpoint 且 source 已不在活树；
- `unit-protocol.ts:575-592`：rollback 不受 phase 限制（只拒 committed/evidence/receipt）；
- `rg3-recovery` 语义：同一 journal 状态可 rollback，只是生产恢复表不调用。
- 测试：`recovery-settle.spec.ts` 当前 fakeUnit 的 rollForward 总是成功，未覆盖失败兜底。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| B 分支只 rollForward | I5/I8 | 崩溃窗口内 unit 不可自动收敛；target 被 busyTarget 占用；resume 可能重复吸收 | 只在进程中断的 B 窗口；正常 commit 不受影响 |

修法：B 分支按 `rollForward → rollback` 求解，而不是“rollForward 失败即 blocked”。这是审计列出的最小完整兜底；更完整的 `settleUnit` 统一函数在后续 UnitKernel/恢复组处理。

## 3. 设计

`recovery-coordinator.ts` branch B：

```ts
const forward = await options.unit.rollForward(journal.unitId)
if (forward.ok) { ...existing projection...; continue }
const back = await options.unit.rollback({ unitId: journal.unitId, reason: 'startup recovery branch B: rollForward failed: ' + forward.code })
if (back.ok) {
  reports.push({ branch:'B', action:'rollback', ok:true })
} else {
  reports.push({ branch:'B', action:'blocked', ok:false, code: back.code, message: back.message + '; rollForward: ' + forward.message })
}
```

- 成功 rollback 是本次恢复的**可查询结果**，不写 projection（回滚后 run 应保持 failed/orphan 语义；不把失败 run 投影成成功）；
- 失败才 `blocked`，消息同时带 forward/back 原因；
- 不改变 `finalize`/branch A/C/D 路径；
- 不新增 CLI（后续 `merge recovery --unit` 再做；本轮先让生产启动恢复能收敛）。

## 4. 测试

`recovery-settle.spec.ts` 增加：

- `target-written` journal + fakeUnit `rollForward` 返回 `{ok:false, code:'unit-rollback-blocked'}`、`rollback` 返回 ok；
- 断言 report `{branch:'B', action:'rollback', ok:true}`；
- 反例：rollForward 和 rollback 都失败 → `action:'blocked'`，消息包含两者。

## 5. 回退

- 只改恢复协调器 + 测试；回退到只 rollForward 即可；不影响正常提交/项目路径。
- 该修复不依赖 UnitKernel 迁移，可独立进入发布。

## 6. 实现结果（2026-11-22，未发布）

- branch B 现在先 `rollForward`，失败立即 `rollback`；成功报告 `action:'rollback'`，
  失败才 `blocked`，消息同时带 forward/back 原因。
- 新增 2 个测试：rollForward 失败→rollback 成功；两者都失败→blocked 且双因。
- recovery-settle.spec：10 tests passed；build 0。
