# @lmzhen/dsh-evolution-curator

> 自动整理技能库：标 stale、归档、合并近重复。

## 你会看到

`/evolution curator status/report/run`；归档/恢复/历史/撤销。

## 什么时候会用到

技能变多、长期不用、出现重复时。

## 默认 / 前提

默认定期跑；可暂停。整理完成不一定在对话里通知，技能可能直接从列表消失；通知/收件箱仍不完整。

## 边界

先快照；失败只写报告，不会自动回滚整棵树。删除是归档，不会硬删。

## 维护者参考：参数别名（G0/S0.3）

`intervalHours` 映射为 `curatorIntervalHours`。旧名仍可读，写入会拒绝。
