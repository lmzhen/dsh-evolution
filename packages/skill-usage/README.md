# @lmzhen/dsh-skill-usage

> 技能用量遥测服务。

## 它做什么

ctx.skillUsage：view/patch/support-read/use 计数；session/event 监听 settle；观测窗口锚点事件；串行 + 跨进程 transact。

## 入口

ctx.skillUsage；被 tool review/curator/maintenance/graph 读。

## 依赖与默认

需要 evolutionIo；sessionScoped 时看会话工具可见性。

## 边界

只对已存在记录计数；失败/未 settle 不计；review 会话排除；host-only 永不命中；use/view 的 record 分支无生产调用者。

## 代码位置

`src/index.ts`
