# @lmzhen/dsh-evolution-merge-ui

> 只读合并侧栏面板。

## 它做什么

4 队列 tab、运行条、A/B 正文、历史覆盖层、排序持久化；唯一写是 mergeApproval 开关（需要 configForms seat）。

## 入口

侧栏「技能合并」；4 条 GET 路由。

## 依赖与默认

由 all 的依赖闭包携带；需要 slots/locale/connection。

## 边界

host 半边 apply 为空；不执行合并，动作按钮只复制命令；无 settings inject，写卡生产可达性需真机确认。

## 代码位置

`src/client/index.ts, src/client/Panel.ts`
