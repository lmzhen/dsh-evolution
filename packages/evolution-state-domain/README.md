# @lmzhen/dsh-evolution-state-domain

> 可选 storage-domain 状态介质（默认 disabled）。

## 它做什么

用 zod 定义三表，提供有界 open、写边界、pending cap/重键、curator missing-key 恢复。

## 入口

Cordis 行 evolution-state-domain；启用后把 evolutionState.provider 改为 domain。

## 依赖与默认

需要 storageDomain 服务。

## 边界

出货三份 patch 都 disabled；一条非法历史记录会让整个 domain open 失败；写路径会重键。

## 代码位置

`src/index.ts, src/compatibility.ts`
