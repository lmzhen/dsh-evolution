# 入门：10 分钟把自进化跑起来

## 1. 先用一句话理解

dsh-evolution 在 DeepSeek Harness 里加了三件事：

1. **记忆**：把项目里反复要解释的事实写进 `MEMORY.md` / `USER.md`，新会话自动带上。
2. **技能**：模型可以创建、修补、整理技能；每次写入有过门禁、可审批、可回滚。
3. **自动化**：后台审查、技能整理、合并、审计与健康检查，按配置自己跑。

它不是模型，也不是一个独立 GUI。你看到的是：斜杠命令、模型工具、设置页卡片、侧栏面板，以及 `$DSH_HOME` 下的文件。

## 2. 选一种安装形态

**一个 profile 只能选一种**，不能同挂。装两种会在启动时报重复注册。

| 形态 | 适合谁 | 你会得到 |
|---|---|---|
| **all（默认）** | 大多数用户 | 全量：记忆/技能工具 + 设置页 + 技能历史 + 技能合并 + 健康面板（健康默认关） |
| **host** | 只要自动化，不想给模型写权限 | 审查/整理/审计照跑；模型只有只读 `maintenance_probe` 和合并子代理的 `merge_stage` |
| **preset（兼容一键）** | 旧配置迁移 | 与 all 接近，但不带设置页/健康面板两行 |
| **agent 预设（分层）** | 只想在部分会话给工具 | host + `/evolution preset install`；只有选中 Evolution 预设的会话有模型工具 |

安装 all：

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# 重启 dsh，让 profile 重新组合
```

重启后在任意会话执行：

```text
/evolution doctor
```

看到安装形态、平台线、家族版本、服务/行状态，就说明挂上了。

> `host` 形态没有 `memory` / `skill_manage` 工具。这不是故障，是设计。需要工具就换 all，或使用分层预设。
>
> `all` 与 `host`、`preset`、分层预设都互斥。换形态时先卸载，再装另一种。

## 3. 第一次写记忆

在会话里直接对模型说：

> 记住：这个项目用 pnpm，测试先跑 `pnpm test`，不要直接提交 dist。

模型会调用 `memory` 工具。默认全自动（M1）会直接写；审批开启（M2）会先进入待批窗口。

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

让模型创建一个项目专用技能：

> 把“发布前必须本地跑 gate”写成技能，名字叫 release-gate。

模型调用 `skill_manage`。写完后：

```text
/evolution skills health
/evolution skill history release-gate
```

想退回上一版：

```text
/evolution skill undo release-gate
```

## 5. 看一次后台审查

默认 `reviewMode: inject`，审查在会话边界发生，不另起子代理。默认有间隔，不会每句话都跑。查看配置：

```text
/evolution params --group evolution-review
```

想手动触发一次扫描/维护：

```text
/evolution maintain
/evolution maintain report
```

## 6. 看一次技能整理

```text
/evolution curator status
/evolution curator scope
/evolution curator run
```

整理会先快照，再按生命周期归档/合并；失败会回滚状态。它不会硬删除技能。

## 7. 最后检查：数据在哪里

| 路径 | 内容 |
|---|---|
| `$DSH_HOME/memories/MEMORY.md` | 项目记忆 |
| `$DSH_HOME/memories/USER.md` | 用户偏好/画像 |
| `$DSH_HOME/skills/` | 技能树；`.usage.json` 计数；`.history/` 版本 |
| `$DSH_HOME/evolution/events.json` | 自进化时间线 |
| `$DSH_HOME/evolution/review-state.json` | 每会话审查计数 |
| `$DSH_HOME/evolution/activity.json` | 计划执行结果 |
| `$DSH_HOME/evolution/runs.json` | 长任务运行登记 |
| `$DSH_HOME/evolution/reports/` | 维护/整理报告 |
| `$DSH_HOME/merge/` | 合并运行、暂存、历史 |

这些文件都是你的，可以直接备份/删除；删除前先停宿主，避免半写。

## 8. 下一步

- 想看完整功能面：[功能地图](features.md)
- 想查所有命令：[命令手册](commands.md)
- 想调审批/预算/间隔：[配置](configuration.md)
- 面板/命令不出现：[排障](troubleshooting.md)
