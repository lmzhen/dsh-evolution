# 升级到 0.48.0

0.48.0 是架构复位版本：安装形态只保留 `all` / `host`，merge 旧账本与旧命令面删除，参数旧名只用于一次性迁移。按下面顺序升级，不需要先升 0.47.x。

## 1. 记录当前形态

```bash
/evolution doctor
```

保存输出里的 `installForm` 与 `familyVersion`。0.48 的 `installForm` 只应是 `full` / `host`；若是 `preset`、`layered`、`preset-only` 或旧 oneclick 形态，先按第 2 步卸载旧形态。

## 2. 卸载旧安装形态（一个版本窗口）

0.48 仍接受旧模式的**卸载**，但不再安装它们：

```bash
node install-layered.mjs --uninstall --mode layered   # preset-only / layered（host bundle + preset row）
node install-layered.mjs --uninstall --mode oneclick  # preset / oneclick（legacy preset bundle）
```

只运行 doctor 报出的那一种。`--base` 仅在收窄 legacy preset row 时使用。卸载后按 `INSTALL.md` 重新安装：

```bash
node install-layered.mjs --mode all      # 完整产品
node install-layered.mjs --mode host     # 仅宿主 bundle
```

## 3. 改写旧参数名

live 配置只写 canonical id：

| 旧名 | 0.48 写法 |
|---|---|
| `memoryInterval` | `reviewMemoryInterval` |
| `skillInterval` | `reviewSkillInterval` |
| `intervalHours` | `curatorIntervalHours` |
| `maxSkillContentChars` | `skillContentChars` |
| `memoryCharLimit` | `memoryChars` |
| `userCharLimit` | `userChars` |

`cordis.yml`、profile patch 和部署配置里的旧名都要改。旧文档 `settings.yaml(.imported)` 仍由启动迁移读取一次；之后用户层只写 canonical。`/evolution doctor` 的 old-key 报告可以确认还有哪些旧名。

## 4. merge 数据

- `merge/receipts` 与 unit journal 自动恢复；
- 旧 `merge/journals/*.json` 不再读取（0.47 已完成收口，0.48 只读 receipt/unit）；
- `merge/pair-index.json` 可以留在原地，0.48 不再读写；run 明细从 `run.report.pairs` 重建；
- 旧的 `commit-recovery` / `commit-journal-store` 文件已删除，doctor 的 recovery 行消失，不再提供该恢复入口。

## 5. 平台版本

最低平台 `0.2.2-rc.0`。0.2.1 宿主不再支持，升级前先升级平台。

## 6. 升级后验证

1. `/evolution doctor`：安装形态、版本、平台行正常，没有旧参数 old-key 告警；
2. `/evolution pending`、`/evolution skills health`、`/evolution merge status` 能正常返回；
3. 让 Agent 实际写一次记忆或技能，再开新会话确认内容仍在；
4. 设置页「自进化」能渲染参数卡与诊断卡。

失败时保留 `~/.dsh` 下的 `.archive`、`merge/receipts` 与 unit journal，不要手工删目录；先按 `docs/troubleshooting.md` 取诊断。
