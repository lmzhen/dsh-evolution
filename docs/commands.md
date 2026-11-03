# 命令

你日常只需要记六条。其余命令是高级/维护用途，放在最后。

## 日常六条

| 命令 | 用途 |
|---|---|
| `/evolution doctor` | 安装/升级后检查；功能不对时先跑它 |
| `/evolution pending` | 看等待审批的写入 |
| `/evolution approve <id>` | 批准一条待批写入 |
| `/evolution reject <id>` | 拒绝一条待批写入 |
| `/evolution skill history <name>` | 看某个技能的版本 |
| `/evolution skill undo <name>` | 撤回某个技能的上一次改动 |

如果批准卡住了、记录显示“执行中”但确实没有在跑，用 `/evolution release <id>` 把它放回待批；它不是批准。

## 整理技能库

| 命令 | 用途 |
|---|---|
| `/evolution curator status` | 上次整理、下次到期、是否暂停 |
| `/evolution curator report` | 上次整理做了什么 |
| `/evolution curator run` | 现在跑一次（忽略间隔） |
| `/evolution curator pause` | 暂停自动整理 |
| `/evolution curator resume` | 恢复自动整理 |
| `/evolution restore` | 整树回到最近一次快照；不能选快照 |
| `/evolution skill restore <name>` | 从归档恢复单个技能 |
| `/evolution skills health` | 看技能结构健康 |

## 合并技能

| 命令 | 用途 |
|---|---|
| `/evolution merge pending` | 看等待你决定的合并 |
| `/evolution merge approve <id>` | 批准一个合并 |
| `/evolution merge reject <id>` | 拒绝一个合并 |
| `/evolution merge status <runId>` | 看合并进度 |
| `/evolution merge undo <target> --run <id>` | 撤销这次合并的目标 |
| `/evolution merge doctor` | 合并配置/模型/队列诊断 |

合并默认自动接受并写入；`/evolution merge pending` 只在打开审批时才有等待项。合并面板只读：它显示队列、A/B 正文和历史，动作按钮复制命令。

## 浏览 / 编辑知识图

- `/graph`：打开目录；
- `/graph detail <nodeId>`：看节点详情；
- `/graph edit <nodeId> <text>`：改节点；
- `/graph delete <nodeId>`：删除（归档）。

删除是归档；技能写入仍走同一套门禁。

## 高级命令（不常用）

| 命令 | 什么时候用 |
|---|---|
| `/evolution maintain` | 手动触发一次维护扫描；异步返回 run id |
| `/evolution maintain status/report/cancel` | 管维护运行 |
| `/evolution mutations` | 最近技能变更 |
| `/evolution skills refresh` | 手工改了技能目录后让 Agent 重新读取 |
| `/evolution skill pin/unpin` | 固定技能，避免被整理 |

这些命令存在，但不需要背；用到时看 `/evolution` 帮助或本表。

## Agent 会自己用的工具

你不需要直接调模型工具。Agent 在需要时会用：

- `memory`：写项目记忆/用户画像；
- `skill_manage`：创建/修补/归档技能；
- 技能检索：在技能多时找相关技能。

是否可用取决于安装形态：`host` 没有 `memory` / `skill_manage`，只有自动化；`all` 或分层预设才有完整工具。

## 找不到命令时

- 输入 `/evolution` 没反应：命令功能没装上，或安装形态不对；先 `/evolution doctor`。
- 命令存在但报“未挂载”：对应功能没有随当前安装形态提供（常见于 merge/curator）。
- 审批相关命令没东西：审批默认关闭，打开后才会有 pending。