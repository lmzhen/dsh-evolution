# @lmzhen/dsh-tool-skill-manage

> 模型面 skill_manage 工具 + 写入闸门/审批。

## 它做什么

13 个 action；写入门禁（argument/missing/policy/read-before-write/confirm）；审批暂存/preview/runner；guidance + 保护名单变量；配置收紧；create/extract/review。

## 入口

skill_manage 工具。

## 依赖与默认

需要 tools/skillUsage/evolutionIo；审批可选。

## 边界

read-only action 不加计数；pin/unpin 不过审批；strictCrossSource 默认只 warn；extract dry_run 仍写提案；description 60 字默认只建议。

## 代码位置

`src/index.ts, src/write-gates.ts`
