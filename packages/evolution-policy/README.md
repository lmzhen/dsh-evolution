# @lmzhen/dsh-evolution-policy

> 不可变策略快照 + 控制平面写 guard。

## 它做什么

把 18 个配置项冻结成 19 字段快照；tools.guard 拒绝 memory/skill 参数中的 6 个控制键（含 operations 内层）。

## 入口

ctx.evolutionPolicy.get()；tools.guard。

## 依赖与默认

可选 tools 服务；无 tools 时 guard 不注册。

## 边界

只拦控制键，不是通用沙箱；数值会 clamp；模型不能改快照。

## 代码位置

`src/index.ts`
