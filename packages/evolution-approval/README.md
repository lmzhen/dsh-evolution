# @lmzhen/dsh-evolution-approval

> 写入审批服务：暂存、预览、批准/拒绝、TTL、release。

## 它做什么

提供 request/approve/reject/list、4 条 HTTP 路由、pending+executing 合并、preview diff、TTL 过期、孤儿 release、decision audit 和跨包 effectiveSessionPolicy。

## 入口

ctx.evolutionApproval；/evolution pending|approve|reject|release；4 路由。

## 依赖与默认

需要 evolutionState；审批默认 enabled:false。

## 边界

关闭审批时写入直接执行；业务拒绝也是 HTTP 200；命令行 approve 不带 audit；release 不是批准。

## 代码位置

`src/index.ts, src/routes.ts`
