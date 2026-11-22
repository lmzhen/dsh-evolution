# 复核残余 P2：A2 list 双 reload、E3 traceability 结构化字段

## A2

`list()` 在 `expireStale()` 已 reload 的情况下又 `refreshState()` 一次，TTL 生效时每次 pending 读会触发两次 domain close/reopen。现在：

- `ttl > 0`：`expireStale()` 的 reload 是唯一一次；
- `ttl === 0`：sweep 不 reload，`list()` 自己 reload 一次。

跨进程 freshness 不变，pending 轮询少一次介质重开。

## A2 rescue

- reject 的 executing-rescue 现在先读 `claimedBy` 的 pid；live foreign pid 直接拒绝，不再可能覆盖正在执行的外部 approve；
- 新负例：live child pid 的 claim，reject false、消息含 pid 与“不要拒绝它”。

## E3

release 门的 traceability 之前允许从 `traceability.source` 里正则解析 7-40 位 hex 当 commit，可能把 artifact hash 等误当 measured commit。现在：

- release 只接受结构化 `traceability.measuredCommit`；
- 缺失即红，不再从自由文本猜；
- 新负例：删掉 `measuredCommit` 必红。

`assemble-release-evidence --release` 也要求 `rehearsal.traceability.measuredCommit === measuredCommit`：旧 rehearsal 在装配阶段就失败，而不是等到 verify；下一次发布前必须重新测量。

`publish-scoped` 同时拒绝 staged manifest 里任何非 `@lmzhen/` 包名，堵住手工把 dev staging 直接 publish 的错 scope 路径。

## 验证

- approval + release-evidence：4 files / 73 tests passed；release-evidence 16 tests；
- local gates: 61 pass / 0 fail / 3 cannot-decide；
- 全量 family 套件：442 files / 2429 tests passed（1081.35s）。
