# @lmzhen/dsh-evolution-maintenance

> 只读维护扫描：探针、事实块、计划校验。

## 它做什么

maintenance_probe 工具（只读深挖）；runMaintain 编排子代理扫描；--facts 0-token 预览；drift/enrichment/footprint/validate-plan。

## 入口

maintenance_probe；/evolution maintain …。

## 依赖与默认

根导出是纯库；./tools 才是插件；需要 evolutionIo 才能读树。

## 边界

不写技能树；无 io 时探针返回 not-mounted 结果；footprint 未从根导出；一次扫描全树两遍、无缓存。

## 代码位置

`src/tools.ts, src/orchestrate.ts, src/validate-plan.ts`
