# @lmzhen/dsh-evolution-host

> 基础设施 bundle（无记忆/技能模型工具）。

## 它做什么

21 条 insert + 2 条覆盖；挂审查/整理/审批/状态/威胁/命令等；模型工具实际有 maintenance_probe 和 merge_stage。

## 入口

dsh plugin add @lmzhen/dsh-evolution-host。

## 依赖与默认

与 all/preset/分层互斥；共享基础设施行。

## 边界

没有 memory/skill_manage/skill_search/session_search；文件头“只有 1 个模型工具”的注释已过期；sessionScoped 会让 host-only 的 review/usage 不计。

## 代码位置

`cordis.patch.yml, package.json`
