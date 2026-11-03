# @lmzhen/dsh-evolution-skill-catalog

> 把家族技能树发布成 ctx.skills provider。

## 它做什么

provider name=dsh-evolution，rank 390，source=user-dsh，影子平台 skill-filesystem；扫描技能树、解析 frontmatter 调用策略、include/exclude；skill-mutated/skills-refresh 失效缓存。

## 入口

ctx.skills（模型经平台 skill 工具/目录间接看到）。

## 依赖与默认

需要 skills + evolutionIo。

## 边界

只读；out-of-band 变更不触发，需 skills refresh/重启；发布过滤会跳过坏名字/空描述；include/exclude 跨层可能失效。

## 代码位置

`src/index.ts`

## 技能名与未决决策

The family's canonical name for a skill is its **directory name**.

frontmatter 的 `name` 必须与目录名一致；不一致会被 validator 拒绝。**Decision 1 is open**：是否把 frontmatter 名作为发布名，仍是一个显式未决项，当前实现按目录名发布。
