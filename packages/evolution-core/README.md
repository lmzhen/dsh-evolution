# @lmzhen/dsh-evolution-core

> 内部引擎，支撑记忆、技能、历史、恢复和审批。

用户没有直接入口。你看到的记忆、技能历史、撤销和恢复，背后都是它在跑。它随 all/host/分层安装自动工作，普通用户不用了解里面的事务和状态机。

## 维护者参考（用户可跳过）

## Events (the family's own, process-local)

| 事件 | the `@mode` | 用途 |
|---|---|---|
| `evolution/skill-mutated` | emit (one-way) | 技能树写入后失效目录缓存 |
| `evolution/skills-refresh` | emit (one-way) | `/evolution skills refresh` 显式刷新 |
| `evolution/review-scheduled` | emit (one-way) | 审查已安排 |
| `evolution/review-completed` | emit (one-way) | branch 审查完成 |
| `evolution/review-error` | emit (one-way) | 审查流水线失败 |
| `evolution/plan-applied` | emit (one-way) | 计划执行结果 |
| `evolution/memory-applied` | emit (one-way) | 记忆写入成功 |
| `evolution/memory-provider-registered` | emit (one-way) | 记忆 provider 注册 |

预设 id：`evolution`、`evolution-ptc`、`evolution-cordis`、`evolution-minimal`、`evolution-reviewer-readonly`、`evolution-maintainer-readonly`。

## 维护者参考：错误码表（用户可跳过）

(`E-301`–`E-326`)：命令/服务不可用时的明确提示；具体文案在 `src/errors.ts`。

| 代码 | 含义 |
|---|---|
| `E-301` | 批准服务未挂载 |
| `E-302` | 策展服务未挂载 |
| `E-303` | 回放服务未挂载 |
| `E-304` | 批准服务版本过旧 |
| `E-305` | 调用无 agent/投递通道 |
| `E-306` | 前台写入无法回放 |
| `E-307` | 设置分区/修订不可读 |
| `E-308` | 未知参数分组 |
| `E-309` | 参数修订冲突 |
| `E-310` | 设置服务拒绝写入 |
| `E-311` | 无设置服务 |
| `E-312` | 参数写入失败 |
| `E-313` | 未知参数 id |
| `E-314` | 部署参数不可从会话写 |
| `E-315` | 参数无用户层 |
| `E-316` | 命名空间未注册 |
| `E-317` | 技能写入未确认 |
| `E-318` | 技能未读先写 |
| `E-319` | 确认超时取消 |
| `E-320` | 无 profile home |
| `E-321` | 无 evolution-io |
| `E-322` | 参数跨字段约束 |
| `E-323` | 子代理通道不可用 |
| `E-324` | 受限 preset 不可用 |
| `E-325` | Host 数据面不可用 |
| `E-326` | 支撑文件未读先写 |
