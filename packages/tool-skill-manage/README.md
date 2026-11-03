# @lmzhen/dsh-tool-skill-manage

> Agent 写技能的工具（创建/修补/归档/合并入口）。

## 你会看到

用户看到的是 Agent 创建/修改技能；改错可看历史/撤销。

## 什么时候会用到

你让 Agent 把做法写成技能，或它自己改进时。

## 默认 / 前提

all/分层预设才有；host 没有。

## 边界

写入有保护；删除是归档。

## 维护者参考：参数别名（G0/S0.3）

`maxSkillContentChars` 映射为 `skillContentChars`。旧名仍可读，写入会拒绝。
