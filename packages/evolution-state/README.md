# @lmzhen/dsh-evolution-state

> 状态门面服务。

## 它做什么

把 review/curator/pending 的 10 个方法转发给选中的 provider；构造时做 provider pin/多 provider 硬拒。

## 入口

ctx.evolutionState。

## 依赖与默认

需要 evolutionStateStorage 和具体 provider。

## 边界

不拥有介质、不做 IO；pin 为空时可能懒验证；多 provider 未 pin 直接抛错。

## 代码位置

`src/index.ts`
