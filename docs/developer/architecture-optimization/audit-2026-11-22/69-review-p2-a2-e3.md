# 复核残余 P2：A2 list 双 reload、E3 traceability 结构化字段

## A2

`list()` 在 `expireStale()` 已 reload 的情况下又 `refreshState()` 一次，TTL 生效时每次 pending 读会触发两次 domain close/reopen。现在：

- `ttl > 0`：`expireStale()` 的 reload 是唯一一次；
- `ttl === 0`：sweep 不 reload，`list()` 自己 reload 一次。

跨进程 freshness 不变，pending 轮询少一次介质重开。

## E3

release 门的 traceability 之前允许从 `traceability.source` 里正则解析 7-40 位 hex 当 commit，可能把 artifact hash 等误当 measured commit。现在：

- release 只接受结构化 `traceability.measuredCommit`；
- 缺失即红，不再从自由文本猜；
- 新负例：删掉 `measuredCommit` 必红。

旧 rehearsal 仍无该字段，下一次发布前必须重新测量，行为不变（预期失败）。

## 验证

- approval + release-evidence：4 files / 72 tests passed；
- local gates 待跑。
