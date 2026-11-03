# dsh-evolution 用户手册

这里只讲使用者需要知道的东西。服务名、内部 API、包分层不在这里；维护者文档在 `docs/developer/`。

## 从哪里开始

| 你现在的状态 | 读这篇 |
|---|---|
| 刚听说，想知道值不值得装 | [功能说明](features.md) |
| 准备安装 | [入门](getting-started.md)、[安装与升级](../INSTALL.md) |
| 已经装好，想日常使用 | [日常使用](getting-started.md) |
| 想调审批/预算/频率 | [设置](configuration.md) |
| 命令记不住 | [命令](commands.md) |
| 要备份/升级/卸载 | [运维](operations.md) |
| 哪些功能要模型/API key | [API key 与模型](api-keys.md) |
| 哪里不对 | [排障](troubleshooting.md) |

## 几个常见场景

第一次用：装 all，重启，跑 `/evolution doctor`，让 Agent 记一条项目事实，开新会话确认它还在。

让 Agent 自己改进：正常干活。任务收尾可能复盘；技能放久了会被整理；启用了合并（需要本地模型）时，重叠技能会进队列。偶尔看看 `/evolution pending`、`/evolution curator status`、`/evolution merge pending`。

不放心自动写：打开审批。之后可暂存的记忆/技能写入会停下来等你批准；批准后仍然可以撤销。

## 文档边界

这套文档面向使用者，不承诺内部实现细节。

安装形态、平台线、版本这些会变的东西，以 README/INSTALL 的当前版本为准。

维护者文档：[架构](developer/architecture.md)、[开发](developer/development.md)、[单元与撤销](developer/units-and-undo.md)。
