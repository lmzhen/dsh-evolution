# 入门：先跑通一次

装好之后，不用急着把功能都试一遍。先确认记忆能写、能跨会话带回来，再让 Agent 写一个技能，最后看一眼复盘和整理就够了。

## 选安装形态

一个 profile 只能挂一种形态。装两种会在启动时撞车，换形态也要先卸再装。

| 形态 | 适合谁 | 实际差别 |
|---|---|---|
| `all` | 大多数人 | 有记忆/技能工具、设置页、技能历史和合并面板 |
| `host` | 只想让后台自动化跑，不想给模型写权限 | 整理和报告能跑；Agent 没有记忆/技能写入工具，复盘和用量不生效 |
| `preset` | 从旧配置迁移 | 功能接近 all，但没有设置页和三个侧栏面板 |
| 分层预设 | 只想在部分会话给工具 | host 加 `agent-preset`，只有选中 Evolution 的会话有工具 |

大多数人装 all：

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
```

重启 dsh，然后在任意会话执行：

```text
/evolution doctor
```

能打印出安装形态、平台线、家族版本，说明命令和安装已经挂上。工具是不是真的能用，还要实际写一次、改一次才知道。

host 没有记忆/技能写入工具，这是设计，不是缺包。要写记忆和技能，就用 all，或者用分层预设。

## 写第一条记忆

在会话里直接说：

> 记住：这个项目用 pnpm，测试先跑 `pnpm test`，不要直接提交 dist。

默认会直接写。打开审批后，会先进入待批：

```text
/evolution pending
```

然后批准或拒绝：

```text
/evolution approve <id>
/evolution reject <id>
```

开一个新会话，看它还在不在。这是最值得先验证的一件事。

## 写第一个技能

让 Agent 把一段重复流程写成技能：

> 把“发布前必须本地跑 gate”写成技能，名字叫 release-gate。

写完后可以看历史和结构：

```text
/evolution skills health
/evolution skill history release-gate
```

改坏了就退回上一版：

```text
/evolution skill undo release-gate
```

## 复盘和整理

默认在任务收尾、累计约 10 次工具调用后复盘，模型会多跑一轮。觉得吵就调大间隔或关掉。看当前值：

```text
/evolution params --group review
```

整理不用天天看。想知道它是不是到期、上次做了什么：

```text
/evolution curator status
/evolution curator report
/evolution curator run
```

整理先快照，再归档或合并。失败只写报告，不会自动回滚整棵树；删除是归档，不会硬删。

设置页只在 all + Web/桌面 GUI 里出现。host、preset、分层没有设置页，只能走命令或改 profile 配置。

## 数据在哪

| 路径 | 内容 |
|---|---|
| `$DSH_HOME/memories/MEMORY.md` | 项目记忆 |
| `$DSH_HOME/memories/USER.md` | 用户偏好/画像 |
| `$DSH_HOME/skills/` | 技能树与版本历史 |
| `$DSH_HOME/evolution/` | 复盘、整理、运行记录 |
| `$DSH_HOME/evolution/merge/` | 合并状态与回执 |
| `$DSH_HOME/merge/` | 技能撤销日志/快照 |

备份或删除前先停宿主，避免写到一半。设置写在 profile 的 `cordis.patch.yml` 里，备份时别忘了它。

## 接下来

- 想知道每个功能到底怎么工作：[功能说明](features.md)
- 想查命令：[命令](commands.md)
- 想调审批、预算、频率：[设置](configuration.md)
- 装完有问题：[排障](troubleshooting.md)
