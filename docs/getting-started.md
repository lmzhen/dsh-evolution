# 入门

## 1. 它能做什么

dsh-evolution 在 DeepSeek Harness 中增加三类能力：

1. **记忆**：保存项目事实和用户偏好，新会话在预算内注入快照。
2. **技能**：Agent 可以创建、修补、整理技能；写入有门禁，审批可选。
3. **自动化**：按配置复盘会话、整理技能库；技能合并由单独的 scan/pair 流程驱动。

命令在会话内使用。技能历史工作台只在 all 安装形态 + Web/桌面 GUI 中提供；参数编辑在平台“设置 → 插件配置”。

## 2. 安装并验证

一个 profile 只能选择一种形态：

| 形态 | 适用场景 | 实际结果 |
|---|---|---|
| **all（默认）** | 大多数会话都需要完整工具 | 记忆/技能工具、技能历史工作台（历史/待批/合并/健康）、平台插件参数卡 |
| **host** | 只要后台整理，不给模型 memory/skill_manage | 整理和报告可用；自动复盘与用量统计不生效 |
| **preset** | 旧配置迁移 | 接近 all，但没有工作台页面与参数卡 |
| **分层预设** | 只在选定会话提供工具 | host + Evolution 预设；原预设会话没有家族工具或自动行为 |

这些形态互斥。默认安装 all：

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# 重启 dsh
```

先决条件和其它形态的完整命令见 [INSTALL.md](../INSTALL.md)。安装后运行：

```text
/evolution doctor
```

`doctor` 能检查形态、版本和服务，不能替代真实工具验证。继续完成下面两次写入即可。

## 3. 写一条记忆

直接对 Agent 说：

> 记住：这个项目用 pnpm，测试先跑 `pnpm test`，不要直接提交 dist。

审批默认关闭，写入会立即执行。打开审批后，可暂存的 memory/skill 写入会先等待决定：

```text
/evolution pending
/evolution approve <id>
/evolution reject <id>
```

再开一个新会话，让 Agent 回忆这条项目约定，确认它出现在预算内注入的记忆快照中。

## 4. 修改并回退一个技能

让 Agent 创建一个项目技能，例如：

> 把“发布前必须本地跑 gate”写成技能，名字叫 release-gate。

另开一个新会话，让 Agent 通过原生 `skill` 工具实际加载 `release-gate`，确认技能不仅写入成功，也能被正常解析和加载。

查看健康和历史：

```text
/evolution skills health
/evolution skill history release-gate
```

回退正文：

```text
/evolution skill undo release-gate
```

普通 `skill undo` 只回退 `SKILL.md` 正文，**不会把 references 等支撑文件一并恢复**。需要按事务单元恢复时，使用 `/evolution skill undo <name> --unit <id>`：预检拒绝时零写，但执行期失败可能只完成部分路径。需要任意时间点的完整目录恢复或执行期失败后的恢复时，使用备份。

## 5. 理解自动复盘

复盘默认开启，但不是每句话都运行。默认 `cadence` 间隔为 10，达到条件后保留到会话收尾再投递；cadence 的实质信号和加权规则、completion 的不同计数方式见 [功能指南](features.md#复盘)。

查看当前设置：

```text
/evolution params --group review
```

host 形态没有 `memory` / `skill_manage` 等家族模型行，复盘要求的会话门控不会命中，因此不会触发自动复盘。

手动维护扫描是另一条入口：

```text
/evolution maintain
/evolution maintain report
```

维护扫描生成报告，不会自行修复技能库。

## 6. 看一次技能整理

```text
/evolution curator status
/evolution curator report
/evolution curator run
```

整理器先快照，再按生命周期标记或归档技能；失败会写报告，不会自动回滚整棵树。归档可用 `/evolution skill restore <name>` 恢复。

默认 `llmReview=false` 时，整理器只做确定性生命周期维护；开启后可以产生 LLM consolidation 提名。独立 merge 才走 `merge scan/pair` 的候选、运行与提交流程。

## 7. 数据与下一步

记忆、技能、报告、运行记录、用户设置和部署配置的准确路径，以及备份/恢复步骤，统一见 [运维文档](operations.md)。

- 完整命令：[commands.md](commands.md)
- 设置与默认值：[configuration.md](configuration.md)
- 模型和 API key：[api-keys.md](api-keys.md)
- 故障排查：[troubleshooting.md](troubleshooting.md)
