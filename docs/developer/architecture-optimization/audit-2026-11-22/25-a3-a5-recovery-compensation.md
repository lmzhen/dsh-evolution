# A3/A5 设计：恢复失败可观测与补偿全量执行

范围：01-core-write P1-3（boot recovery 的失败结果被丢弃）与 P1-5（rollback 遇第一个 blocked 就停止）。

## 1. 已读依据

- `audit-2026-11-22/01-core-write.md:28-44`：A3/A5 位置、机制、影响、建议。
- `skill-store.ts:1129-1134`：`ensureRecovered` 只 try/catch，不读 `recoverPreparedUnits()` 的返回值。
- `mutation-unit.ts:581-586`：`rollback` 循环遇 `!result.ok` 直接 throw。
- 测试：`mutation-recovery.spec.ts`（prepared snapshot 恢复）、`mutation-unit.spec.ts`（失败 rollback/钩子）。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| A3 recovery 失败结果丢弃 | I5 可恢复/I7 | prepared 单元漂移后无人知晓；undo 永久 `undo-needs-recovery` | boot 恢复失败；不损坏新写 |
| A5 补偿遇 blocked 停止 | I5 | 多目标失败后更多本单元字节残留；报告只写一条 | 多目标单元 + 并发写者 |

两个都是失败路径的可恢复性缺陷；修复不改变成功路径。

## 3. 设计

### 3.1 A3

`ensureRecovered`：

```ts
const run = this.recoverPreparedUnits()
this.recovery = run.then(results => {
  const failed = results.filter(r => !r.ok)
  if (failed.length > 0) console.warn('skill-store: prepared-unit recovery left ' + failed.length + ' unit(s) unresolved: ' + ...unitId/code/message)
}).catch(...)
```

- 保留抛错路径的现有 warn；
- 对 `{ok:false}` 的 recover 结果逐条 warn（unitId + 首个 error code/message）；
- 不抛错/不阻塞写入（与现有 best-effort 语义一致）；
- 后续 doctor/状态面可以消费同一结果，本轮先保证可见。

### 3.2 A5

`rollback` 改为收集全部失败：

```ts
const errors: string[] = []
for (reverse) { const r = await restore(); if (!r.ok) errors.push(target+': '+message) }
if (errors.length) throw new Error('rollback incomplete: ' + errors.join('; '))
```

- 不再跳过后面的 target；
- 现有调用方已把 rollback 失败拼进返回错误，行为保持；
- blocked 目标仍不覆盖（`restore` 只在 after 字节仍匹配时回滚）。

## 4. 测试

- A3：prepared snapshot 的 target 被改成 neither before/after；`lib.recoverOnBoot()` 后用 `vi.spyOn(console,'warn')` 断言 warn 含 unitId 和 `recover-drift`。
- A5：三目标写入，第二个成功后外部改写 b，第三个写失败；rollback 应尝试 b（blocked）后仍尝试 a 并恢复 old；断言 a=old，错误含 b blocked。
- 现有 mutation-unit/recovery tests 回归。

## 5. 回退

- 两处局部修改；回退即恢复忽略结果/首错停止；无 schema/API 变更。

## 6. 实现结果（2026-11-22，未发布）

- A3：`ensureRecovered` 读取 `recoverPreparedUnits()` 结果，对 `ok:false` 的 unit 逐条 warn
  （unitId + 首个 error code/message）；不再静默。
- A5：`rollback` 收集全部 target 的失败，继续补偿其余 target，最后统一抛
  `rollback incomplete: ...`。
- 新增测试：prepared drift warn、blocked target 后仍恢复前一 target；
  mutation-unit + mutation-recovery = 2 files / 33 tests passed；build 0。
