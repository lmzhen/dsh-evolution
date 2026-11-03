# @lmzhen/dsh-evolution-state-storage

> 状态 provider 注册表 + 共享记录契约。

## 它做什么

定义 pending/review/curator 三表字段门、claim/resolve/release 状态机、pending 200/review 500 容量规则，并提供 provider 一致性套件与介质比对。

## 入口

ctx.evolutionStateStorage；JSON/domain provider 注册到这里。

## 依赖与默认

被 evolution-state-json/domain 和 evolution-state 使用。

## 边界

只定义契约，不落地存储；多 provider 未 pin 时注册表只 warn 并取首个，state 门面会硬拒。

## 代码位置

`src/index.ts, src/record-contract.ts, src/conformance.ts`
