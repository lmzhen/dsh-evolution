# @lmzhen/dsh-evolution-state-json

> 默认 JSON 状态介质。

## 它做什么

实现 10 个 state seam 方法；jsonTransact 崩溃安全读写、坏文件 .corrupt 隔离、旧 pending.json 只读退休、pending 归档/容量告警、review 会话 cap。

## 入口

Cordis 行 evolution-state-json；evolutionState provider=json。

## 依赖与默认

需要 evolutionIo 和 evolutionStateStorage。

## 边界

单进程；相对 root 按 CWD 解析；坏文件不会被当空覆盖；不提供用户命令。

## 代码位置

`src/index.ts`
