# 日常运维

本文是家族数据路径、备份和恢复的唯一入口。安装命令见 [../INSTALL.md](../INSTALL.md)，完整命令见 [commands.md](commands.md)。

## 诊断与日常检查

```text
/evolution doctor
```

`doctor` 检查安装形态、平台/家族版本、连接和服务状态，不能证明 `memory` / `skill_manage` 实际可用；工具仍需通过一次真实写入验证。

常用只读命令：

| 目标 | 命令 |
|---|---|
| 暂存写入 | `/evolution pending [--detail]` |
| 整理状态和报告 | `/evolution curator status`、`/evolution curator report` |
| 合并状态和报告 | `/evolution merge status [runId]`、`/evolution merge report [runId]` |
| 技能历史 | `/evolution skill history <name>` |
| 技能结构健康 | `/evolution skills health` |
| 最近技能变更 | `/evolution mutations` |

## 自动行为

- **复盘**：默认开启，按实质信号和活动量加权间隔触发，不是固定消息数；host 不触发。详见 [configuration.md](configuration.md#自动复盘)。
- **整理**：启动约 10 秒后开始判断，之后每小时检查；默认满足 168 小时间隔和 2 小时空闲才运行。
- **合并**：不会自动扫描。由 `/evolution merge scan`、`pair` 或明确的后续操作驱动，和整理器分开。

## 数据路径

| 路径 | 内容 |
|---|---|
| `$DSH_HOME/memories/MEMORY.md` | 项目记忆 |
| `$DSH_HOME/memories/USER.md` | 用户画像 |
| `$DSH_HOME/skills/` | 技能树、归档及 `.history/` 版本数据 |
| `$DSH_HOME/evolution/` | 复盘、整理、运行记录，以及 `evolution/merge/` 合并状态与回执 |
| `$DSH_HOME/units/skill/` | 当前技能单元的 `journals/` 与 `snapshots/`，用于 `--unit` 撤销和 prepared-unit 恢复 |
| `$DSH_HOME/merge/` | 旧版树改动快照的兼容回退，不是当前单元存储主目录 |
| `$DSH_HOME/settings.yaml` | 平台插件管理 row 配置写入的 E3 用户设置 |
| `$DSH_HOME/profiles/<profile>/cordis.patch.yml` | 部署配置、行级覆盖及分层 Evolution 预设行 |

`settings.yaml` 与 profile patch 不是同一份配置，不能只备份其中一个。

## 备份

最稳妥的方式是停止宿主后整体备份 `$DSH_HOME`。只备份家族数据时，至少包含五个数据目录、`settings.yaml` 和 `profiles/`：

```bash
# 先停宿主；Linux/macOS
mkdir -p /backup/evolution
cp -a "$DSH_HOME/memories" "$DSH_HOME/skills" "$DSH_HOME/evolution" "$DSH_HOME/units" "$DSH_HOME/merge" "$DSH_HOME/settings.yaml" "$DSH_HOME/profiles" /backup/evolution/
```

```powershell
# 先停宿主；Windows PowerShell
New-Item -ItemType Directory -Force D:\backup\evolution | Out-Null
Copy-Item "$env:DSH_HOME\memories","$env:DSH_HOME\skills","$env:DSH_HOME\evolution","$env:DSH_HOME\units","$env:DSH_HOME\merge","$env:DSH_HOME\settings.yaml","$env:DSH_HOME\profiles" -Destination D:\backup\evolution -Recurse
```

这个选择性清单不包含模型凭据。需要完整迁移时，停止宿主并备份整个 home，而不是只复制这几个家族路径。

## 恢复与回退

### 从备份恢复

1. 停止宿主。
2. 先备份当前 `$DSH_HOME`，避免恢复过程覆盖仍需保留的新数据。
3. 按原相对位置恢复 `memories/`、`skills/`、`evolution/`、`units/`、`merge/`、`settings.yaml` 和所需的 profile patch。
4. 若恢复后不再使用分层预设，删除 patch 中残留的 Evolution 预设行；若更换安装形态，先移除旧 bundle。
5. 重启并运行 `/evolution doctor`，再实际验证一次记忆和技能写入。

### 命令级回退

| 目标 | 命令与边界 |
|---|---|
| 回退技能正文 | `/evolution skill undo <name> [--to v<N>]`；普通 undo 不恢复支撑文件 |
| 回退一个事务单元 | `/evolution skill undo <name> --unit <id>`；预检拒绝时零写，执行期失败可能部分完成并列出已回退路径 |
| 恢复已归档技能 | `/evolution skill restore <name>` |
| 回退整棵技能树 | `/evolution restore`；只使用最近一次快照 |
| 撤销一次合并 | `/evolution merge undo <target> --run <id>`；按 run 撤销，不等同于 skill undo |

命令级回退不能替代任意时间点的备份。尤其不要把普通 `skill undo` 当作 references 文件或整棵技能树的回滚。

## 升级与卸载

升级必须先平台、后家族，命令和版本见 [../INSTALL.md](../INSTALL.md#升级)。升级前按本文备份；升级后检查：

- [ ] `/evolution doctor` 显示正确的版本和安装形态。
- [ ] all：记忆/技能工具可用，技能历史可打开，普通 undo 和设置页符合预期。
- [ ] host：整理和报告可用；不期待自动复盘或 `memory` / `skill_manage`。
- [ ] preset/分层：命令和工具按预期出现；没有设置页和侧栏属于正常形态差异。
- [ ] 开启审批时能批准和拒绝；使用合并时本地模型目录仍可读取。

卸载不会删除上述家族数据、`settings.yaml` 或 profile patch。分层安装还要清理预设行，具体命令见 [../INSTALL.md](../INSTALL.md#卸载)。

## 长任务与运行记录

- `maintain`、`merge scan/pair` 异步返回 run id；用各自的 `status`、`report`、`cancel` 管理。
- 运行记录不可读时，命令应明确报告不可读，不能把读取失败当成“没有运行”。
- 重启后检查 run 的实际状态。恢复逻辑会处理可恢复记录，但不能据此假定所有中断任务都已成功完成。
