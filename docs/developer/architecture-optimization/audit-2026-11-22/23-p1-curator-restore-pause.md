# P1-2 设计：restoreSnapshot 保留并发 pause

范围：审计 03-curator-review-state P1-2：`restoreSnapshotCore` 用整条 `saveCuratorState` 覆盖，把并发 `setPaused(true)` 压回快照里的 `paused:false`。

## 1. 已读依据

- `audit-2026-11-22/03-curator-review-state.md:17`：位置/机制/影响/修法。
- `packages/evolution-curator/src/index.ts:945-963`：restore 当前整条写入；
- `:705-730`：setPaused 走 `transactCuratorState`，不取 mutex；
- `:1168-1176,1518`：已有“transact 只在仍 absent 时写”的同类 rationale；
- 测试 `curator.spec.ts:439-466`：restore 期望状态回退；当前 `saved.paused` 设为 true，正好可作负例。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| restore 整条覆盖 state | I2 单一事实源 | 操作者 pause 被静默吞；自动 pass 继续改树 | 窄窗口（restore 与 pause 并发）；不损坏树，但安全开关失效 |

修法：restore 仍需恢复**快照的簿记字段**（lastRunAt/runCount/lastSummary），但 `paused` 取**当前**记录，不能回退。`transactCuratorState` 是现有 provider 契约，无需新 API。

## 3. 设计

```ts
await stateService.transactCuratorState(current => {
  const snapshot = JSON.parse(...) as CuratorStateRecordShape
  return {
    schemaVersion: snapshot.schemaVersion,
    lastRunAt: snapshot.lastRunAt,
    runCount: snapshot.runCount,
    lastSummary: snapshot.lastSummary,
    paused: current?.paused ?? snapshot.paused,
  }
})
```

- 当前记录存在：只保留 `paused`；其余仍按快照回退；
- 当前记录不存在：用快照的 paused；
- 失败保持现有 best-effort 警告（树已回滚，不回滚）；
- 不取 mutex 也安全：transact 回调拿到队列时的当前值，不会覆盖 pause。

## 4. 测试

- 现有 `curator.spec.ts` restore 用例：快照 paused false，restore 前 saved.paused=true；断言期望改为 `paused:true`（旧代码会失败）。
- 保留树回滚/簿记字段断言。
- 可选：transact 回调 current=null 时用快照 paused（不新增测试也可以；现有路径覆盖非 null）。

## 5. 回退

- 只改 restore state 写 + 一条测试；回退即恢复整条 save；无 schema/存储变更。

## 6. 实现结果（2026-11-22，未发布）

- restoreSnapshot 的 state 写已改为 `transactCuratorState`：快照的 lastRunAt/runCount/lastSummary 回退，
  `paused` 取当前记录；并发 pause 不再被压平。
- 测试期望改为 `paused:true`；curator.spec 75 tests passed。
- 同批修正 9 处 curator fake LLM 的 finish reason：旧 fixture 用字符串 `'stop'`，平台真实形状是
  `{kind:'stop'}`；D1 修复后 completeText 会拒绝旧形状，这是测试夹具校准，不是产品行为放宽。
