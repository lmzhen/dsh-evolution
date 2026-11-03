# @lmzhen/dsh-evolution-replay

> 计划排行榜/比较报告。

## 它做什么

从 activity/事件回填计划结果，按权重算分并输出比较报告；支持 corrupt/readFailed 限定句。

## 入口

ctx.evolutionReplay；/evolution replay。

## 依赖与默认

需要 activity/events；事件源主要来自 branch review。

## 边界

单计划 margin=null；默认 inject 模式没有自动数据；权重 clamp；只出文本。

## 代码位置

`src/index.ts`
