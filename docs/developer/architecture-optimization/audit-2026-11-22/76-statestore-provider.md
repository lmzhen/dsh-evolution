# D1a：file-backed StateStore provider（未挂载）

## 目的

D1 的第一小步：先证明 `EvolutionStateStorage` 可以由**一个文件 + 每次 transact** 实现，且不维护进程内权威副本。provider 注册名 `store`，尚未进入 bundle；domain provider 仍是当前默认，所以本轮不改变运行时行为。

## 实现

`packages/evolution-core/src/state/store.ts`：

```ts
createStateStoreProvider({ io, home?, path? })
```

- 默认文件：`<evolutionHome>/state/store.json`；
- 顶层形状：

```json
{ "version": 1, "review": {}, "curator": null, "pending": {} }
```

- 每个写操作是一次 `transactIo(io, file, ...)`；读操作每次重新读文件，不缓存；
- 坏 JSON / 未知 version / 非法记录 fail loud，不把损坏的 store 当空；
- `review` 保留内部 `updatedAt` 淘汰戳，读侧剥离（与 domain 行为一致）；
- `transactCuratorState` 的 `null` 语义是 **keep current**（不是 delete），与 seam 一致；
- `pending` 读取按 `record.id` 归并；resolved 尾部用 `selectPendingOverflow` 限长；
- 当前未挂载，`reload()` 不需要：每次读都读介质。

## 验证

- 共享 `runStateProviderConsistency` conformance 通过；
- 跨 provider 实例可见（证明没有进程内 authority）；
- 非法记录拒绝、损坏 store 拒绝、resolved cap 生效；
- `store-provider.spec.ts`: 5 tests passed；core state 全组 7 files / 46 tests passed；build 0；`run-gates local`: 61/0/3。

## 边界

- 这是 D1a，不是 D1 完成：旧 domain 数据迁移、row 切换、domain provider 删除仍未做；
- 没有 UI/提示词/aux 前缀变化；
- 未进 dist 的 runtime row，不影响现有用户。
