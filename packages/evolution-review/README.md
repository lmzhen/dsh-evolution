# @lmzhen/dsh-evolution-review

> 后台审查编排：节奏、投递、未结窗口、branch。

## 它做什么

在会话边界判断记忆/技能触发，注入或起 branch 子会话；维护未结 notice 状态机；持久化 review-state；发布 review-scheduled/error 事件。

## 入口

无命令/工具；自动注入；参数在 /evolution params。

## 依赖与默认

需要 agents；可选 state/policy/settings/inbox；branch 需要 agentPresets/agentDefaultModel。

## 边界

默认 inject；完成通道默认关；branch 的 plan-applied 计数恒 0；REVIEW_RESULT_SUMMARY 无生产者；reviewToolAllow 是死配置。

## 代码位置

`src/index.ts, src/review-notice.ts`
