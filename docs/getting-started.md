# 入门：10 分钟把自进化跑起来

## 1. 先用一句话理解

dsh-evolution 在 DeepSeek Harness 里加了三件事：

1. **记忆**：把项目里反复要解释的事实写进 `MEMORY.md` / `USER.md`，新会话自动带上。
2. **技能**：Agent 可以创建、修补、整理技能；每次写入有保护，可审批、可回滚。
3. **自动化**：后台复盘、技能整理、合并按配置自己跑。

你看到的是：斜杠命令、设置页卡片、侧栏面板（设置页和面板只有 all + Web/桌面 GUI 才有），以及 `$DSH_HOME` 下的文件。

## 2. 选一种安装形态

**一个 profile 只能选一种**，不能同挂。装两种会在启动时报重复注册。

| 形态 | 适合谁 | 你会得到 |
|---|---|---|
| **all（默认）** | 大多数用户 | 记忆/技能工具 + 设置页 + 技能历史 + 技能合并 |
| **host** | 只要自动化，不想给模型写权限 | 整理/报告照跑；Agent 没有记忆/技能写入工具，review/用量也不生效 |
| **preset（兼容一键）** | 旧配置迁移 | 与 all 接近，但不带设置页和三个侧栏面板 |
| **分层预设** | 只想在部分会话给工具 | host + `agent-preset` + `/evolution preset install`；只有选中 Evolution 的会话有工具 |

安装 all：

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# 重启 dsh
```

重启后在任意会话执行：

```text
/evolution doctor
```

看到安装形态、平台线、家族版本，就说明挂上了。

> `host` 形态没有记忆/技能写入工具，这是设计。需要工具就换 all，或用分层预设。
>
> `all` 与 `host`、`preset`、分层预设互斥。换形态时先卸载，再装另一种。

## 3. 第一次写记忆

在会话里直接对 Agent 说：

> 记住：这个项目用 pnpm，测试先跑 `pnpm test`，不要直接提交 dist。

默认会直接写；打开审批后会先进入待批窗口。

查看待批：

```text
/evolution pending
```

批准/拒绝：

```text
/evolution approve <id>
/evolution reject <id>
```

## 4. 第一次改技能

让 Agent 创建一个项目专用技能：

> 把“发布前必须本地跑 gate”写成技能，名字叫 release-gate。

写完后：

```text
/evolution skills health
/evolution skill history release-gate
```

想退回上一版：

```text
/evolution skill undo release-gate
```

## 5. 看一次后台复盘

默认在任务收尾、累计约 10 次工具调用后复盘；会叫醒模型多跑一轮，不是每句话都跑。查看当前值：

```text
/evolution params --group review
```

也可以让 Agent 手动做一次维护扫描（高级）：

```text
/evolution maintain
/evolution maintain report
```

## 6. 看一次技能整理

```text
/evolution curator status
/evolution curator report
/evolution curator run
```

整理会先快照，再归档/合并；失败只写报告，不会自动回滚整棵树。它不会硬删除技能。

> 设置页只在 all + Web/桌面 GUI 出现；host/preset/分层没有设置页。

## 7. 数据在哪里

| 路径 | 内容 |
|---|---|
| `$DSH_HOME/memories/MEMORY.md` | 项目记忆 |
| `$DSH_HOME/memories/USER.md` | 用户偏好/画像 |
| `$DSH_HOME/skills/` | 技能树与版本历史 |
| `$DSH_HOME/evolution/` | 复盘、整理、运行记录 |
| `$DSH_HOME/evolution/merge/` | 合并状态与回执 |
| `$DSH_HOME/merge/` | 技能撤销日志/快照 |

这些文件都是你的；备份或删除前先停宿主，避免半写。设置写在 profile 的 `cordis.patch.yml` 里，备份时也要带上。

## 8. 下一步

- 想看完整能力：[功能说明](features.md)
- 想查命令：[命令](commands.md)
- 想调审批/预算/频率：[设置](configuration.md)
- 面板/命令不出现：[排障](troubleshooting.md)