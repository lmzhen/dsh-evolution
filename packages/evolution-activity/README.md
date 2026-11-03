# @lmzhen/dsh-evolution-activity

> 计划/审查事件账本。

## 它做什么

把 evolution/plan-applied 和 review-completed 追加到 activity.json；损坏先 .corrupt；dispose flush。

## 入口

无用户入口；数据供 replay/doctor。

## 依赖与默认

evolutionIo 就绪才订阅。

## 边界

review-completed 默认 inject 模式不产生；reviews[] 当前无读取者；loadActivity 无生产调用方。

## 代码位置

`src/index.ts`
