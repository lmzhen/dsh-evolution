# @lmzhen/dsh-evolution-commands

> /evolution 命令面 + 诊断路由 + 运行登记。

## 它做什么

注册 /evolution 30 条子命令、/api/dsh-evolution/diagnostics、runs.json、设置页抑制、旧设置迁移、learn/maintain/preset install/extract/restructure/params/policy/migrate。

## 入口

/evolution …；diagnostics GET。

## 依赖与默认

需要 commands 服务；多数子命令还需要 approval/curator/merge/io。

## 边界

未挂 commands 则整条命令不存在；maintain 异步；部分兜底文案与实际命令不一致；consolidate 已退役。

## 代码位置

`src/index.ts, src/registry.ts, src/diagnostics-route.ts`

安装形态与 variant 命令面差异单源在 [INSTALL.md](../INSTALL.md)。
