# 日常运维

## 先看诊断

```text
/evolution doctor
```

安装/升级后、功能不对时，先跑这一条。它会告诉你：装的是哪种形态、平台/家族版本、记忆/技能工具在不在、哪些功能没装上。

## 它会自己做什么

- **复盘**：累计约 10 次工具调用后，在任务收尾时多跑一轮；默认开。
- **整理**：宿主启动约 10 秒后判断，之后每小时查一次；满 168 小时且空闲约 2 小时才跑，默认开。
- **合并**：不会自动扫描；你主动 scan/pair 或后台提议时才发生。

## 日常看什么

| 想看 | 命令 |
|---|---|
| 等待审批的写入 | `/evolution pending` |
| 自动整理状态 | `/evolution curator status` |
| 整理报告 | `/evolution curator report` |
| 合并队列 | `/evolution merge pending` |
| 技能历史 | `/evolution skill history <name>` |
| 技能结构健康 | `/evolution skills health` |
| 最近技能变更 | `/evolution mutations` |

## 数据在哪里

| 路径 | 内容 |
|---|---|
| `$DSH_HOME/memories/MEMORY.md` | 项目记忆 |
| `$DSH_HOME/memories/USER.md` | 用户画像 |
| `$DSH_HOME/skills/` | 技能树 |
| `$DSH_HOME/skills/.history/` | 技能版本 |
| `$DSH_HOME/evolution/` | 审查、整理、运行记录、合并状态（`evolution/merge/`） |
| `$DSH_HOME/merge/` | 技能事务的撤销日志/快照（用 undo/合并撤销时需要） |
| `$DSH_HOME/profiles/<profile>/cordis.patch.yml` | 审批、预算、频率等设置 |

备份这些位置：`memories/`、`skills/`、`evolution/`、`merge/`，以及 profile 的 `cordis.patch.yml`（设置在里面）。

## 备份

最稳妥：停宿主，整体备份 `$DSH_HOME`。如果只想备份家族数据：

```bash
# 先停宿主
# Linux/macOS
cp -a "$DSH_HOME/memories" "$DSH_HOME/skills" "$DSH_HOME/evolution" "$DSH_HOME/merge" "$DSH_HOME/profiles" /backup/evolution/
# Windows PowerShell
# Copy-Item "$env:DSH_HOME\memories","$env:DSH_HOME\skills","$env:DSH_HOME\evolution","$env:DSH_HOME\merge","$env:DSH_HOME\profiles" -Destination D:\backup\evolution -Recurse
```

## 升级

**先平台，后家族。** 平台和家族的版本是配套的；反过来升级会失败。

1. 读目标版本 `CHANGELOG.md`；
2. 备份 `$DSH_HOME`；
3. 升级 DeepSeek Harness 并重启；
4. 升级家族 bundle：`dsh plugin --profile web add @lmzhen/dsh-evolution-all@0.32.5`；
5. 重启后 `/evolution doctor`；
6. 做一次记忆写入 + 一次技能改动。

## 卸载

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
```

卸载只移除插件；`$DSH_HOME` 下的数据和 profile 设置保留。恢复时把 `memories/`、`skills/`、`evolution/`、`merge/` 和 profile 的 `cordis.patch.yml` 放回原位，再重启。分层用户先清掉 profile patch 里的预设行，避免残留引用。

## 长任务

- `maintain`、`merge scan/pair` 是异步的，会返回 run id；用 status/report 看。
- 运行记录读不到时，命令会明确说“不可读”，不会假装没有运行。
- 宿主重启后，未完成的任务会按恢复逻辑处理。

## 升级后检查（按形态）

- [ ] `/evolution doctor` 的版本/形态正确
- [ ] all：记忆工具/技能工具在预期会话出现，技能历史能打开、能 undo，设置页能打开
- [ ] host：整理/报告可用；不要期待自动复盘或记忆/技能工具
- [ ] preset/分层：命令和工具按预期出现；没有设置页/侧栏是正常的
- [ ] 审批（如开启）能审批/拒绝；合并模型目录仍在（如使用 merge）