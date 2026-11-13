# 排障

按安装形态、命令与工具、模型条件、数据与权限的顺序定位。先保留证据，不要直接改代码或状态文件。

## 1. 命令或工具不存在

| 症状 | 检查与处理 |
|---|---|
| `/evolution` 完全没反应 | 确认安装命令作用于当前 profile、安装是否成功以及是否重启。此时 doctor 也不存在，不能用它作为第一步；检查可用的 `dsh --profile <p> --dump-config` 和启动日志，必要时重装 |
| 没有 `memory` / `skill_manage` | host 本来就没有这两个工具；改用 all 或分层预设 |
| 分层安装只有部分会话有工具 | 新建会话时选择 Evolution 预设；平台原预设只有管理命令，没有家族工具或自动行为 |
| 命令存在但报服务未挂载 | 检查当前安装形态和对应服务；合并、整理和模型工具不是同一个挂载面 |

桌面 GUI 使用 `desktop` profile，Web 通常使用 `web`。装错 profile 时，在当前客户端看不到功能。

## 2. 审批没有待批项

- 审批默认关闭，写入会直接执行，`pending` 为空是正常现象。
- 开启后仍为空：确认写入属于可暂存的 memory/skill 写入，并检查审批服务是否挂载。
- `pendingTtlMs` 大于 0 时，过期记录会关闭为拒绝且不再执行；默认 0 表示永久等待。
- `release` 只回收已确认不在执行的孤儿记录，不是批准。原批准仍可能运行时，不要回收后重复执行。

## 3. 复盘或整理没有运行

- 复盘先要求实质信号，再按活动量加权间隔计数；不是每句话或固定消息数触发。用 `/evolution params --group review` 查看设置。
- host 一定不会触发自动复盘：会话没有 `memory` / `skill_manage` 等家族模型行，review 的会话门控不会命中。
- 没有可用模型时，复盘和整理器的 LLM 部分不能运行；整理器只保留确定性结果，并记录 LLM 通道未运行。
- 整理器还受 168 小时间隔、空闲条件和 pause 状态限制；用 `/evolution curator status` 与 `report` 区分未到期、暂停和失败。
- `curator run` 不是合并扫描。合并失败应看下一节，不要用整理报告代替 merge 诊断。

## 4. 合并失败

| 提示或状态 | 处理 |
|---|---|
| scan 本地模型未配置 | 设置 `mergeModelsRoot`，确认两个 potion 模型目录存在；不会自动下载 |
| 合并未就绪 | 先运行 `/evolution doctor`，再用 `/evolution merge doctor` 检查模型、队列和运行条件 |
| scan 没有可用 LLM | 本地筛选仍需要 potion 模型文件；scan 的引擎判断会回退 stub，不会变成真实模型评审。普通 pair 没有这条 stub 路径，round1/authoring 仍需子会话模型 |
| 运行被占用 | 用 `status` 检查当前 run，等待结束或确认后 `cancel`，再重试 |
| 没有会话/Agent | 在真实会话里运行，不要在无 Agent 的上下文执行 |
| 中断后状态不明 | 用 `runs`、`status`、`report` 和 `resume` 读取实际状态，不要假定重启即成功 |

## 5. 工作台或设置卡片不出现

- 技能历史工作台只在 all + Web/桌面 GUI 提供；TUI/headless 没有，host/preset/分层也不带。
- 参数卡在平台“设置 → 插件配置”，读写都走平台 `configForms`；family 不再提供 `/api/dsh-evolution/settings/*` 路由。
- 工作台历史/合并需要连接服务；连接缺失时无法读取数据。
- 合并视图只读，按钮复制命令，不直接执行合并写操作。
- 健康视图默认禁用，需要在部署配置中显式启用；未启用时工作台不显示健康 tab。

## 6. 数据损坏或误删

- 先停止宿主并按 [operations.md](operations.md#备份) 备份，不要直接手改 JSON。
- **隔离只覆盖已实现的 JSON 状态路径**：部分损坏文件或记录会写入 `.corrupt` 副本，成功隔离后才过滤坏记录；副本写失败时会保留原文件。它不是对所有家族文件统一适用的恢复保证。
- 数据存储冲突应按 doctor 或命令错误处理，不要通过删除状态文件强行清空。
- 技能删除通常是归档，先尝试 `/evolution skill restore <name>`；整树回退使用 `/evolution restore`。
- 普通 `/evolution skill undo` 只回退正文，不能找回支撑文件；支撑文件需要事务单元回退或备份。

准确路径和恢复步骤见 [operations.md](operations.md#数据路径)。

## 7. 版本与平台线

- 当前验证线为 **DSH `0.2.2-rc.1`**；发布依赖窗口为 `^0.2.2-rc.0`。
- 升级先平台、后家族；不要跨未验证平台线混装。
- `/evolution doctor` 的家族版本应与安装包一致。不一致时检查是否混用了多个 bundle 或残留预设行。

## 8. 收集证据

```text
/evolution doctor --json
/evolution curator report
/evolution merge doctor
```

同时保留启动日志和实际错误文本。Web home 的日志一般在 `$DSH_HOME/logs/`；桌面 home 没有该目录时，使用桌面应用的日志入口。不要只报告“没反应”。
