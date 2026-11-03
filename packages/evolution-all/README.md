# @lmzhen/dsh-evolution-all

> 全量默认 bundle。

## 它做什么

28 条 insert + 2 覆盖：host 的基础设施 + memory/skill_manage/session_search/skill_catalog/skill_discovery + UI + 健康行（disabled）。

## 入口

dsh plugin add @lmzhen/dsh-evolution-all。

## 依赖与默认

与 host/preset/分层互斥；session_search 需要平台 peer。

## 边界

健康面板默认关；discovery 默认 off；审批默认关；与 host/preset 不能同挂。

## 代码位置

`cordis.patch.yml, package.json`
