# @lmzhen/dsh-evolution-io-node

> 本地 node:fs IO provider。

## 它做什么

把 core 的 nodeEvolutionIo 注册为默认 provider；原子写、重试、tmp 清理等实现都在 core。

## 入口

Cordis 行 evolution-io-node。

## 依赖与默认

需要 evolution-io。

## 边界

模块级单例；只保证 single-process；无 Config。

## 代码位置

`src/index.ts`
