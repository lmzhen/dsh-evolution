# @lmzhen/dsh-evolution-ui

> 设置页「自进化」区段 + 技能历史面板 + 6 条历史路由。

## 它做什么

待批卡、诊断卡、8 张参数卡、Plugins 行配置；技能历史侧栏与 skills/versions/diff/body/undo/health 路由。

## 入口

设置 → 自进化；侧栏「技能历史」；6 路由。

## 依赖与默认

需要 slots/locale；历史路由还需要 connection；参数写需要 configForms seat。

## 边界

无 configForms 时只读；诊断卡只渲染 runtime 行；/health 客户端不调用；openHistory 丢 name。

## 代码位置

`src/panels/settings/index.ts, src/panels/history/host.ts`
