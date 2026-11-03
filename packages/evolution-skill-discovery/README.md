# @lmzhen/dsh-evolution-skill-discovery

> 技能检索 + 域卡投影 + 域图（默认关闭）。

## 它做什么

skill_search 工具；/skill-domain status/generate；agent/pre-step 域卡与 available_skills 裁剪；agent/created 快照/描述刷新；域图/策略/搜索索引/LLM 生成。

## 入口

skill_search；/skill-domain（mode:on）；模型上下文投影。

## 依赖与默认

需要 skills/commands/sessionProjections/llm（mode:on 时）；featureEpoch 必填。

## 边界

默认 mode:off，只留 skill_search；off 时域卡/命令/投影/描述刷新都不注册；on 缺 llm 直接抛。

## 代码位置

`src/main-entry.ts, src/tool.ts, src/projection-runtime.ts`
