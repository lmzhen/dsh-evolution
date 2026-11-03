# @lmzhen/dsh-evolution-merge

> 技能合并域：扫描、两轮 authoring、提交、撤销、恢复。

## 它做什么

evolutionMerge 服务 16 个 verb；merge_stage 工具；4 条只读路由；PairLedger、staging、UnitTransaction 提交、undo/recovery/reconcile/doctor。

## 入口

ctx.evolutionMerge；/evolution merge …；merge_stage；4 路由。

## 依赖与默认

需要 evolutionIo、commands、状态、merge-engine；模型根未配会 fail loud；筛选 pipeline 冻结。

## 边界

自身不注册 slash command（/merge 已移除）；run/runs 路由未实现；默认 detached；UI 只读。

## 代码位置

`src/index.ts, src/runtime.ts, src/merge-routes.ts`
