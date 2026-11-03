# @lmzhen/dsh-evolution-io

> IO provider 注册表。

## 它做什么

提供 ctx.evolutionIo，注册/选择 IO provider；同名不同对象会抛错，空注册表调用会报错并指路 evolution-io-node。

## 入口

ctx.evolutionIo；由 io-node 注册默认 provider。

## 依赖与默认

被 memory-files/state-json/skill-catalog 等使用。

## 边界

不实现文件 IO；跨进程语义由 provider 声明，当前 node provider 是 single-process。

## 代码位置

`src/index.ts`
