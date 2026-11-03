# 排障：先定位层级，再改配置

排障顺序固定：**安装形态 → 服务/行 → 命令/工具 → 数据/权限**。不要一上来改代码。

## 1. 命令不存在

**症状**：输入 `/evolution` 没反应或提示未知命令。

**原因/动作**：

1. `commands` 服务没挂 → `/evolution doctor` 看行；先确认 bundle 行在。
2. `evolution-commands` 行没启用 → 检查 profile patch/overlay。
3. 分层形态（M4）在原始预设会话里：命令面仍可见，但自动行为被 sessionScoped 关掉；这是已接受差异，不是故障。

## 2. 模型工具不存在

| 形态 | 应该有什么 |
|---|---|
| all | memory、skill_manage、skill_search、session_search（peer 在时）、maintenance_probe、merge_stage |
| host | 只有 maintenance_probe、merge_stage |
| 分层 | 只有选中 Evolution 预设的会话有完整工具 |

**host 没有 memory/skill_manage 是设计**；要写记忆/技能请用 all 或分层预设。

## 3. 待批窗口为空/不动

- 审批默认关闭；`approval.enabled` 没开时写入直接执行，pending 当然空。
- 开了审批但服务/路由缺失：`/evolution doctor` 看 `evolution-approval` 行。
- pending 有 TTL；过期会按 rejected 了结，不会执行。
- `release` 只回收孤儿执行记录，不是批准。

## 4. 审查不跑

- 默认 `reviewMode: inject` + cadence，不是每轮跑；看 `/evolution params --group evolution-review`。
- `reviewEnabled=false` 或间隔未到。
- 会话没有家族工具（host-only / 原始预设）时，`sessionScoped` 不计入。
- branch 模式需要 agents；缺服务会不可用。
- 已知：branch 结果的通知 summary 与 `REVIEW_RESULT_SUMMARY` 不一致，可能占用未结窗口；先切回 inject 验证。

## 5. 整理不跑/没效果

- `enabled:false` 只关自动调度；手动 `curator run` 仍可跑。
- 间隔门/活跃会话/first-run grace 会跳过；`curator status` 看 skip 原因。
- 没有 llm 时 `llmReview` 不运行，只做确定性部分。
- 没有可整理项时不会硬造变更。

## 6. 合并报错

| 错误 | 处理 |
|---|---|
| `merge-not-ready` | 没挂 `evolutionIo` / 状态未就绪；先 doctor |
| 模型根未配置 | 配 `mergeModelsRoot`；不会自动下载 |
| `E-323` | 宿主数据面/子代理能力缺失 |
| `E-305` | 没有 session/agent；在真实会话里跑 |
| `merge-parent-required` | approve/resume 缺 parent run |
| `run-owns-row` | 该行仍被活动 run 持有；等/取消 |

## 7. UI 面板/设置卡片不出现

- 设置区段需要 `slots`/`locale`；`configForms` 缺失时卡片只读，不是消失。
- 历史路由需要 `connection`；无 connection 时路由不注册。
- 合并面板只在 all 的依赖闭包里；host/preset 没有。
- 健康面板默认 disabled；要显式启用。
- 失败块可能显示原始 key（skill-health 已知文案键问题），不是数据丢失。

## 8. 状态损坏/迁移

- state-json 读到坏文件会隔离 `.corrupt`，不会当空覆盖。
- 旧 `pending.json` 只读兼容，成功后 rename `.migrated`。
- 多 provider 未 pin：state 门面直接抛错；显式设 `provider`。
- 不要手改 `runs.json`/`pending.json`；先备份，再让恢复逻辑处理。

## 9. 版本/平台线

- 平台线不跨线：当前家族线 0.2.1-rc.3，最低 0.2.1-rc.2；旧线在依赖解析就失败。
- 升级顺序：平台 → 家族；反过来会坏。
- `/evolution doctor` 的家族版本应与安装包一致；不一致说明混合版本，重装。

## 10. 收集证据

```text
/evolution doctor --json
/evolution maintain report
/evolution merge doctor
/evolution curator report
```

再加上 `$DSH_HOME/logs/` 的启动日志。不要只发“没反应”。
