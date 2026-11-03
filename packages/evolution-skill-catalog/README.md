# @lmzhen/dsh-evolution-skill-catalog

把家族技能发布到平台技能目录，让 Agent 能像用普通技能一样发现和加载它们。用户不用直接操作。

它随 all/分层安装自动工作。手工改过技能目录后，可能需要 `/evolution skills refresh` 让 Agent 重新读取。

## 维护者参考（用户可跳过）

The family's canonical name for a skill is its **directory name**.

**Decision 1 is open**：frontmatter 名是否作为发布名仍未决；当前按目录名发布。
