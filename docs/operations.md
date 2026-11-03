# 日常运维：看状态、备份、升级、卸载

## 1. 先看诊断

```text
/evolution doctor
/evolution doctor --json
```

文本面 = 诊断视图 + 补充检查。视图有 7 条事实（家族版本、安装形态、平台线、preset、只读契约等）和 8 条运行时行（host-surface、install-form、platform-pairing、platform-services、restricted-preset、runs、session-fold、subagent-channel）。`--json` 只输出视图对象。

重装/升级后先跑这一条，别先猜。

## 2. 日常命令

| 想看 | 命令 |
|---|---|
| 待批写入 | `/evolution pending` |
| 审查/整理状态 | `/evolution curator status` |
| 最近变更 | `/evolution mutations` |
| 维护运行 | `/evolution maintain status` |
| 维护报告 | `/evolution maintain report` |
| 技能健康 | `/evolution skills health` |
| 合并队列 | `/evolution merge pending` |
| 合并诊断 | `/evolution merge doctor` |
| 计划排行 | `/evolution replay` |

## 3. 状态文件地图

| 路径 | 写入者 | 说明 |
|---|---|---|
| `$DSH_HOME/memories/MEMORY.md` | memory-files | 项目记忆 |
| `$DSH_HOME/memories/USER.md` | memory-files | 用户画像 |
| `$DSH_HOME/skills/` | SkillLibrary | 技能树 |
| `$DSH_HOME/skills/.usage.json` | skill-usage | 使用/读取计数 |
| `$DSH_HOME/skills/.history/` | core skill-history | 内容/支撑文件版本 |
| `$DSH_HOME/evolution/events.json` | core | 追加式时间线；轮转 archive |
| `$DSH_HOME/evolution/review-state.json` | review | 每会话审查计数 |
| `$DSH_HOME/evolution/activity.json` | activity | 计划执行结果 |
| `$DSH_HOME/evolution/runs.json` | commands/merge | 长任务登记 |
| `$DSH_HOME/evolution/approval/pending.json` | approval | 待批/执行中记录 |
| `$DSH_HOME/evolution/reports/` | maintenance/curator | 报告 |
| `$DSH_HOME/evolution/domain-map.json` | discovery(mode:on) | 域图 |
| `$DSH_HOME/merge/` | merge | 运行、staging、回执、历史 |

> 所有路径以实际 `$DSH_HOME` 为准。桌面/web 的 home 可能不同。

## 4. 备份

最稳妥：停宿主后整体备份 `$DSH_HOME`。如果只想备份家族数据：

```bash
# 先停宿主，避免半写
cp -a "$DSH_HOME/memories" "$DSH_HOME/skills" "$DSH_HOME/evolution" "$DSH_HOME/merge" /backup/evolution/
```

没有 `merge/` 或 `evolution/` 的安装是正常的（功能没跑过）。

## 5. 升级

**顺序：先平台，后家族。** 平台线和家族的 peers/engines 是绑定的；反过来升级会遇到依赖解析失败。

1. 读目标版本的 `CHANGELOG.md`。
2. 备份 `$DSH_HOME`。
3. 升级平台并重启，确认宿主正常。
4. 升级家族 bundle。
5. 重启后 `/evolution doctor`。
6. 跑一条读写演练（记忆/技能）确认审批/回滚仍通。

升级命令：

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all@<version>
# 或卸载后重装，避免旧行残留
```

## 6. 卸载

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
```

卸载只移除插件行；`$DSH_HOME` 下的记忆、技能、状态、报告、审批历史保留。重新安装会接上。

如果你要彻底清空：先备份，再停宿主，删除对应目录。不要删 `$DSH_HOME` 本身。

## 7. 长任务

- `maintain` 是异步的：命令返回 run id，扫描继续；用 `status/report/cancel` 管。
- `merge scan/pair/approve/resume` 默认 detached，返回 runId；用 `status/report` 看。
- `runs.json` 不可读时，`status` 会明确说“索引不可读”，不会假装没有运行。

## 8. 日志与报告

- 报告在 `$DSH_HOME/evolution/reports/`；真实报告保留 20 份，错误报告 10 份。
- 合并报告在 `$DSH_HOME/merge/runs/`；回执用于 undo。
- 宿主启动日志在 `$DSH_HOME/logs/`。

## 9. 升级后检查清单

- [ ] `/evolution doctor` 安装形态/平台线/家族版本正确
- [ ] 待批窗口能打开（如果开了审批）
- [ ] 记忆工具/技能工具在预期形态出现
- [ ] 技能历史能打开、能 undo
- [ ] 审查/整理没有被间隔门误判为“没跑”
- [ ] 合并模型目录仍在（如果使用 merge）
