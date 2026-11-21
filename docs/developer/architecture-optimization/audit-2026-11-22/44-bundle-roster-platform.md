# Phase B/P2：bundle roster 回到 io-platform，并修复本地门禁链

范围：
- `gen-bundle-patches` 从 `bundle-rows.json` 生成时，生产 forms（all/host/preset）仍写 `evolution-io-node`，把手工切到 `io-platform` 的 Phase B 结果覆盖回去；
- 本地全量门禁有 6 条 fail：bundle rows、layout sync、io-discipline、taxonomy、traceability 预算。

## 1. 已读依据

- `packages/scripts/bundle-rows.json`：`evolution-io-node` 属于 all/host/preset/standalone；生成器是这些 patch 的唯一源。
- `gen-bundle-patches.mjs`：`--check` 指 hand edit 为 drift。
- 本地 `run-gates local`：61 pass / 6 fail / 3 cannot-decide。

## 2. 设计/修复

### 2.1 生产 composition 用 platform io

- roster 增加 `evolution-io-platform`，forms = all/host/preset；
- `evolution-io-node` 只保留 standalone；
- 重生成三份 patch 与 preset cordis.yml；
- 生产 bundle 现在真实使用平台 filesystem（Phase B），standalone 保持 node。

### 2.2 门禁链

- `verify-layout-sync-local` fail：mirror 改动未同步到 builds 当前 overlay；同步后通过。
- `verify-io-discipline`：`io-platform.ts` 是 adapter/medium，裸 `rename` 是它实现 io seam 的方法；加入 MEDIUM 列表（与 `io.ts`、`io-node` 同等）。
- `gen-check-taxonomy --check`：spec 集合变化导致视图陈旧；重生成。
- `verify-traceability`：`evolution-core` 新 subpath 计数 13 → 14（`io-platform` 已是公开 subpath）；更新预算。
- `gen-bundle-patches`：roster 修正后重生成。

## 3. 验证

```text
run-gates local: 61 pass / 0 fail / 3 cannot-decide(registered)
verify-bundle-rows --strict: OK
verify-io-discipline: 476 domain sources, one facade
verify-traceability --strict: 52/52
gen-check-taxonomy --check: OK
verify-layout-sync-local: OK
```

3 条 cannot-decide 是已登记的机器本地输入缺失（health admission 等），不是 fail。

## 4. 回退

恢复 roster 的 node 行/forms 并重生成；其余为门禁数据更新。
