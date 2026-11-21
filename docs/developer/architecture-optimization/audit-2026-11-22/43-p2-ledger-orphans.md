# P2：mutation ledger 拒绝孤儿记录

范围：08-tests-debt P2-9。
- `reports/mutation-coverage.json` 是生成物，但旧记录 `beh-installer-layered` 已不在 `probes.json` 里，仍永久留在台账；
- `verify-check-registry` 只比较“当前 probe 是否都有记录”，不拒绝台账里的孤儿；
- 记录只有 `provenAt`，没有 commit。

## 设计

- `verify-check-registry` 的 mutation-coverage 轴：
  - 计算 `orphanRecords = ledger.records where probe not in manifest.probes`；
  - 轴 gap = uncoveredProbes + orphanRecords；
  - 消息列出孤儿 probe；
  - 孤儿不是“豁免”，没有 pendingAxes 登记就红。
- `verify-mutations --probes` 写入台账时：
  - 以当前 `probeRegistry` 为闭集，先删除未知 probe 记录，再 stamp；
  - 避免下一次生成又把孤儿写回。
- 删除现有孤儿记录；因 route/契约变化，重跑 `decl-contracts-surface` probe 刷新签名。

## 验证

- `decl-contracts-surface` baseline 先红（route 数 20 → 21），测试与 probe 同步后重新 proven red；
- `verify-check-registry --strict`: mutation-coverage 23/23，8 axes pass / 0 fail；
- ledger 记录 23，孤儿 0。

## 回退

恢复只统计 uncovered 的轴；无产品代码变更。
