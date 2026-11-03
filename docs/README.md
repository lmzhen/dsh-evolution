# dsh-evolution 用户手册

本目录说明安装后的功能、命令、配置、数据与排障。包分层和内部实现见维护者文档。

## 阅读入口

| 当前需要 | 文档 |
|---|---|
| 了解功能、默认触发和当前边界 | [功能指南](features.md) |
| 第一次安装并完成读写验证 | [入门](getting-started.md)、[安装与升级](../INSTALL.md) |
| 查看日常功能和恢复方式 | [功能指南](features.md)、[命令](commands.md) |
| 调整审批、记忆预算、复盘或整理频率 | [设置](configuration.md) |
| 配置模型，了解无模型时的行为 | [API key 与模型](api-keys.md) |
| 备份、升级、卸载和恢复数据 | [运维](operations.md) |
| 按症状定位问题 | [排障](troubleshooting.md) |

## 常用路径

### 第一次使用

安装 `all` 并重启，执行 `/evolution doctor` 检查安装形态和服务。随后让 Agent 记住一条项目事实，实际完成一次写入，再开新会话确认记忆已带入。doctor 不能代替这次真实读写验证。

### 使用技能和自动功能

正常工作达到实质信号与加权间隔后，复盘在完成边界投递；并非每个回合或每项任务都会触发。技能目录默认发布，`skill_search` 提供本地候选检索，discovery 域卡和裁剪默认关闭。

curator 的到期状态和执行结果用 `/evolution curator status`、`/evolution curator report` 查看。merge 需要通过 `/evolution merge scan` 或 `/evolution merge pair <a> <b>` 显式启动：scan 需要本地 potion 模型，缺少 LLM 时可回退 stub；普通 pair 不需要 potion，但 round1/authoring 需要子会话模型。

### 控制自动写入

普通审批默认关闭。开启后，只有可暂存的 memory/skill 写入进入待批窗口，由 `/evolution approve <id>` 或 `/evolution reject <id>` 处理；curator 的写入不经过这道审批。

merge 使用独立的 `mergeApproval`。它为 `true` 时，合并记录在独立队列等待 `/evolution merge approve <id>` 或 `/evolution merge reject <id>`，不要与普通待批写入混用。

## 文档边界

- 用户文档只保留操作所需的行为、默认值和限制；安装形态与平台版本以根 README 和 INSTALL 的当前内容为准。
- 功能的具体默认参数在 [设置](configuration.md)，模型条件和数据外发边界在 [API key 与模型](api-keys.md)。
- 维护者文档：[架构](developer/architecture.md)、[开发](developer/development.md)、[单元与撤销](developer/units-and-undo.md)。
