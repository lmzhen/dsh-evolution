# @lmzhen/dsh-evolution-curator

> 技能生命周期整理服务。

## 它做什么

定时/手动 run；stale/归档/合并/usage 折叠；LLM 提名；pause/resume/status/scope/report；restore/history/undo/undoUnit/healthView。

## 入口

ctx.evolutionCurator；/evolution curator …、skill restore/history/undo、restore、propose、skills health。

## 依赖与默认

需要 io/state/usage；llm 可选；agents 可选（空闲门）。

## 边界

enabled:false 只关自动调度；单实例 claim 仅进程内；consolidate 已无命令入口；先快照后写。

## 代码位置

`src/index.ts, src/unit-undo-plan.ts`
