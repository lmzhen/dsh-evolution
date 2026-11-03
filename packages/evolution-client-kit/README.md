# @lmzhen/dsh-evolution-client-kit

> 客户端基础：面板生命周期、生成表、四态传输、token。

## 它做什么

registerSidebarPanel、样式注入、workspace 探测、生成 routes/contracts/states/fallbacks、家族 CSS tokens。

## 入口

被 evolution-ui/merge-ui/skill-health 消费。

## 依赖与默认

需要 slots/locale/workspace；不是插件，无 dsh/apply。

## 边界

slots 缺失会抛错；locale 被拒回退包内字典；生成表是镜像，不是权威。

## 代码位置

`src/panel.ts, src/tokens.ts, src/generated/*`
