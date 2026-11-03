# @lmzhen/dsh-evolution-skill-health

> 只读技能健康路由 + 侧栏面板。

## 它做什么

GET /api/dsh-evolution/skill-health/rows；curator.healthView 投影；5 类统计、按技能队列、按规则聚合、语义提议卡；默认 disabled。

## 入口

健康路由；侧栏「技能健康」。

## 依赖与默认

需要 connection + curator + evolutionIo（提议）。

## 边界

all 中 disabled；无 curator 回 unavailable；失败文案键有已知不匹配；/health 客户端不调用；行 disabled 时客户端加载语义未验证。

## 代码位置

`src/index.ts, src/routes.ts, src/client/index.ts`
