# dsh-evolution 用户手册

这套文档只讲你会看到、会操作、会受影响的东西。服务名、内部 API、包分层不在这里；维护者文档在 docs/developer/。

## 从哪里开始

| 你现在的状态 | 读这篇 |
|---|---|
| 刚听说，想知道值不值得装 | [功能说明](features.md) |
| 准备安装 | [入门](getting-started.md) → [安装与升级](../INSTALL.md) |
| 已经装好，想日常使用 | [日常使用](getting-started.md) |
| 想调审批/预算/频率 | [设置](configuration.md) |
| 命令记不住 | [命令](commands.md) |
| 要备份/升级/卸载 | [运维](operations.md) |
| 哪些功能要模型/API key | [API key 与模型](api-keys.md) |
| 哪里不对 | [排障](troubleshooting.md) |

## 最常见的三条路径

### 第一次用

安装 all → 重启 → 执行 /evolution doctor → 让 Agent 记住一条项目事实 → 开新会话确认它还在。

### 让 Agent 自己改进

正常干活。到自然节点它会复盘；技能过时会被整理；如果你启用了合并（需本地模型），重叠技能会进入队列。偶尔看 /evolution pending、/evolution curator status、/evolution merge pending。

### 不放心自动写

打开审批。之后每次记忆/技能写入都会停在待批窗口，由你批准或拒绝；批准后也可以撤销。

## 文档边界

- 本目录面向使用者；不承诺内部实现细节。
- 安装形态、平台线、版本等会变的事实，以 README/INSTALL 的当前版本为准。
- 维护者文档：[架构](developer/architecture.md)、[开发](developer/development.md)、[单元与撤销](developer/units-and-undo.md)。