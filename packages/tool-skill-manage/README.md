# @lmzhen/dsh-evolution-tool-skill-manage

给模型用的技能写入工具。创建、改写、补丁、拆分、归档、写支撑文件，都从这里走。

写入前有门禁和策略检查，写入后留版本。它不是技能加载器；模型看到技能、加载正文，靠的是平台原生的 `skill` 工具。

## 维护者参考：参数别名（G0/S0.3）

`maxSkillContentChars` 映射为 `skillContentChars`。旧名仍可读，写入会拒绝。
