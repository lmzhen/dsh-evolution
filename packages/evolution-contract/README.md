# @lmzhen/dsh-evolution-contract

> 跨包类型契约，纯类型包，没有运行时。

## 它做什么

定义平台服务探针、进程事件、PendingRecord/Status、state seam 等共享形状。它不注册命令/工具/路由，也不提供 service；改它等于改多个包的编译契约。

## 入口

无直接入口；被 core/state/approval 等包 import。

## 依赖与默认

无运行时依赖；发布名 @lmzhen/dsh-evolution-contract。

## 边界

没有 apply、没有默认导出、不做运行时校验；类型与实现不一致由编译/测试兜底。

## 代码位置

`src/index.ts`
