# @lmzhen/dsh-evolution-feedback

> 反馈记录与质量回推服务。

## 它做什么

record() 乐观累加 + events.json 写锁；事件真值折叠；quality 回推 feedback_score/feedback_warn；启动缓存。

## 入口

ctx.evolutionFeedback；族内无生产者。

## 依赖与默认

需要 io/skillUsage 才能持久化/回推。

## 边界

没有默认调用方；无 io 只改内存；snapshot 仅测试；质量回推只对 kind=skill。

## 代码位置

`src/index.ts`
