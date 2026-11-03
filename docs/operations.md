# 日常运维

## 先看诊断

```text
/evolution doctor
```

装完、升级完、或者觉得功能不对，先跑这一条。它会打印安装形态、平台/家族版本、连接和服务状态。它不能证明 memory/skill 工具真的能用；要验证工具，还是得写一次、改一次。

## 后台在做什么

- 复盘：all 形态下，累计约 10 次工具调用、任务收尾时多跑一轮。默认开，host 不跑。
- 整理：宿主启动约 10 秒后判断一次，之后每小时查一次；满 168 小时、空闲约 2 小时才真正跑。默认开。
- 合并：不会自己扫描。你主动 scan/pair，或者后台给出提议时才会发生。

## 平时看什么

| 想看 | 命令 |
|---|---|
| 等待审批的写入 | `/evolution pending` |
| 自动整理状态 | `/evolution curator status` |
| 整理报告 | `/evolution curator report` |
| 合并队列 | `/evolution merge pending` |
| 技能历史 | `/evolution skill history <name>` |
| 技能结构健康 | `/evolution skills health` |
| 最近技能变更 | `/evolution mutations` |

## 数据在哪

| 路径 | 内容 |
|---|---|
| `$DSH_HOME/memories/MEMORY.md` | 项目记忆 |
| `$DSH_HOME/memories/USER.md` | 用户画像 |
| `$DSH_HOME/skills/` | 技能树 |
| `$DSH_HOME/skills/.history/` | 技能版本 |
| `$DSH_HOME/evolution/` | 审查、整理、运行记录、合并状态（`evolution/merge/`） |
| `$DSH_HOME/merge/` | 技能事务的撤销日志/快照（undo 和合并撤销需要） |
| `$DSH_HOME/profiles/<profile>/cordis.patch.yml` | 审批、预算、频率等设置 |

备份这几个位置：`memories/`、`skills/`、`evolution/`、`merge/`，再加上 profile 的 `cordis.patch.yml`。设置也在里面，别只备份技能。

## 备份

最省事的办法是停掉宿主，整个备份 `$DSH_HOME`。只想备份家族数据的话：

```bash
# 先停宿主
# Linux/macOS
cp -a "$DSH_HOME/memories" "$DSH_HOME/skills" "$DSH_HOME/evolution" "$DSH_HOME/merge" "$DSH_HOME/profiles" /backup/evolution/
# Windows PowerShell
# Copy-Item "$env:DSH_HOME\memories","$env:DSH_HOME\skills","$env:DSH_HOME\evolution","$env:DSH_HOME\merge","$env:DSH_HOME\profiles" -Destination D:\backup\evolution -Recurse
```

## 升级

先平台，后家族。版本是配套的，反过来升级会失败。

1. 读目标版本的 `CHANGELOG.md`；
2. 备份 `$DSH_HOME`；
3. 升级 DeepSeek Harness，重启；
4. 升级家族 bundle：`dsh plugin --profile web add @lmzhen/dsh-evolution-all@0.32.5`；
5. 重启后跑 `/evolution doctor`；
6. 写一次记忆、改一次技能，确认工具真的能用。

## 卸载

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
```

卸载只移除插件，`$DSH_HOME` 下的数据和 profile 设置都还在。要恢复，把 `memories/`、`skills/`、`evolution/`、`merge/` 和 profile 的 `cordis.patch.yml` 放回原位，再重启。分层用户先清掉 profile patch 里的预设行，避免残留引用。

## 长任务

`maintain`、`merge scan/pair` 是异步的，会返回 run id；用 status/report 看进度。运行记录读不到时，命令会直接说“不可读”，不会假装没跑过。宿主重启后，没完成的任务按恢复逻辑处理。

## 升级后检查

- [ ] `/evolution doctor` 的版本、形态正确
- [ ] all：记忆/技能工具在预期会话出现，技能历史能打开、能 undo，设置页能打开
- [ ] host：整理/报告可用；不要期待自动复盘或记忆/技能工具
- [ ] preset/分层：命令和工具按预期出现；没有设置页/侧栏是正常的
- [ ] 审批（如果开了）能批/拒；合并模型目录还在（如果用了 merge）
