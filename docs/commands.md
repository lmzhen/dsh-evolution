# 命令手册

这一页只列“代码里真的注册了”的入口。`/merge` 在 0.32 已移除；`/evolution consolidate` 已退出用户面。

## 1. 顶层命令

| 命令 | 何时存在 | 用途 |
|---|---|---|
| `/evolution` | 挂载 `evolution-commands` + 平台 `commands` 服务 | 管理自进化：记忆/技能/审查/整理/合并入口 |
| `/graph` | 挂载 `evolution-learning-graph` + 所需服务 | 查看/编辑技能与记忆图 |
| `/skill-domain` | `evolution-skill-discovery` 的 `mode: on` + `commands` 服务 | 域图状态/一次性生成 |

## 2. `/evolution` 全表

| 子命令 | 说明 |
|---|---|
| `merge <verb>` | 技能合并；16 个 verb 见 §3 |
| `pending [--detail]` | 待批窗口；`--detail` 展开 staged args |
| `approve <id>` | 批准待批写入 |
| `reject <id>` | 拒绝待批写入 |
| `release <id>` | 回收执行中但已失去持有者的 pending 记录 |
| `doctor [--json]` | 诊断：安装形态、平台线、服务、行、待办 |
| `curator run` | 手动整理（忽略自动间隔门） |
| `curator pause` / `curator resume` | 暂停/恢复自动整理 |
| `curator status` | 上次运行/下次到期 |
| `curator report [id]` | 最近整理报告 |
| `curator scope` | 当前会进入整理的技能范围 |
| `mutations` | 最近 5 条技能变更 |
| `restore` | 整树回滚到快照（staging 部署时拒绝） |
| `skill restore <name>` | 从归档恢复单个技能 |
| `skill history <name>` | 内容/支撑文件两条版本链 |
| `skill undo <name> [--to vN|--unit <id>]` | 撤销单技能内容或跨技能单元 |
| `skill pin <name>` / `unpin` | 固定/取消固定；不过审批 |
| `propose` | 为超长技能写 keep 提案 |
| `skills health` | 结构健康视图 |
| `skills refresh` | 广播技能目录缓存失效 |
| `learn [request]` | 向当前会话注入学习请求 |
| `maintain [--timeout=<ms>]` | 异步维护扫描；返回 run id |
| `maintain --facts` | 0-token 事实块预览 |
| `maintain status [id]` | 运行状态 |
| `maintain report [id]` | 运行报告 |
| `maintain cancel [id]` | 取消本进程拥有的运行 |
| `maintain handoff [id]` | 把报告指针注入会话 |
| `migrate` | 旧设置命名空间迁移 |
| `policy set <id> <value> [--expect <rev>]` | 写 E3 策略参数 |
| `params [--group <g>] [--json]` | 参数注册表 |
| `preset install [--base a,b]` | 生成 Evolution agent 预设行 |
| `restructure <name> "<heading>" <to_file>` | 把章节移到 `references/` |
| `extract <src> <tgt> "<heading>" [--apply]` | 抽取章节为子技能/引用 |
| `replay` | 计划排行榜与比较报告 |

> 表项 30 条；展开嵌套后 36 个叶子。`/evolution` 无参或未知子命令会显示帮助/错误，不再假装成功。

## 3. `/evolution merge` 的 16 个 verb

| verb | 用途 |
|---|---|
| `scan` | 全库扫描候选；默认后台 |
| `pair <a> <b> [--force]` | 单对合并；`--force` 跳过第一轮直接给决定 |
| `status [id]` | 运行详情 |
| `report [id]` | 运行报告 |
| `cancel [id]` | 取消运行 |
| `runs` | 最近运行 |
| `doctor` | 合并状态诊断 |
| `reconcile` | 行状态唯一收敛写者；启动时也会自动跑 |
| `pending [--expired]` | 待批行 |
| `candidates [--retry <id>]` | 候选/重跑 verify 行 |
| `approve <id>` | 批准 pending 行，进入第二轮 |
| `reject <id>` | 拒绝 pending 行 |
| `resume [id] [--clear <id>] [--retry]` | 重跑 verify/fuse |
| `skipped [--restore <id>]` | 跳过队列/恢复 |
| `discard <id>` | 丢弃行 |
| `undo <target> --run <id>` | 按 run+target 反序撤销 |

默认 `detached`：scan/pair/approve/resume 立即返回 runId；用 `status/report` 查看。

## 4. 模型工具

| 工具 | 动作 | 什么时候有 |
|---|---|---|
| `memory` | add/replace/remove/operations；target=memory/user | all/preset/agent 预设；`memoryEnabled:false` 时不注册 |
| `skill_manage` | review/list/create/edit/update/patch/delete/write_file/remove_file/restructure/extract/pin/unpin | 需要 tools+skillUsage+evolutionIo |
| `skill_search` | query/limit | discovery 行；`mode:off` 仍可用，但不做策略过滤 |
| `session_search` | 平台工具 | all 的 peer 行；host 不挂 |
| `maintenance_probe` | signal/target | host/all/preset 的 maintenance tools 行 |
| `merge_stage` | list/read/write/copy | 合并行；执行时要求 active merge child |

### `skill_manage` 的动作边界

- `list`/`review`/`pin`/`unpin` 视为只读；pin/unpin 仍过准入闸门，但不过审批。
- 写操作过门禁；审批开启时进入 pending，批准后 runner 回放。
- `extract` 默认只出计划，但仍写一份 proposal report；`--apply` 才动树。
- `restructure` 目标必须在 `references/` 下。

## 5. HTTP 路由（面板/客户端用）

| 路径 | 方法 | 谁用 |
|---|---|---|
| `/api/dsh-evolution/diagnostics` | GET | 诊断卡、doctor |
| `/api/dsh-evolution/approval/pending` | GET | 待批卡 |
| `/api/dsh-evolution/approval/preview` | GET | 审批预览 |
| `/api/dsh-evolution/approval/approve` | POST | 批准 |
| `/api/dsh-evolution/approval/reject` | POST | 拒绝 |
| `/api/dsh-evolution/skill-history/skills` | GET | 历史面板列表 |
| `/api/dsh-evolution/skill-history/versions` | GET | 版本链 |
| `/api/dsh-evolution/skill-history/versions/diff` | GET | 版本 diff |
| `/api/dsh-evolution/skill-history/versions/body` | GET | 版本正文 |
| `/api/dsh-evolution/skill-history/undo` | POST | 撤销 |
| `/api/dsh-evolution/skill-history/health` | GET | 存活探针（客户端不调用） |
| `/api/dsh-evolution/skill-health/rows` | GET | 健康面板（默认关） |
| `/api/dsh-evolution/merge/view` | GET | 合并面板 |
| `/api/dsh-evolution/merge/rows` | GET | 合并队列 |
| `/api/dsh-evolution/merge/body` | GET | A/B 正文 |
| `/api/dsh-evolution/merge/history` | GET | 历史 |

未实现：`/api/dsh-evolution/merge/run`、`/runs`（只有路径常量）。

## 6. 常用配方

### 让模型记住一条规则

```text
记住：这个仓库的测试命令是 pnpm test，不要直接改 dist。
```

### 创建技能

```text
把“发布前必须跑本地 gate”写成技能，名字 release-gate。
```

### 查看/回滚技能

```text
/evolution skill history release-gate
/evolution skill undo release-gate
```

### 开启审批

在设置 → 自进化 → 审批卡打开，或配置 `approval.enabled: true`；然后：

```text
/evolution pending
/evolution approve <id>
```

### 合并两个技能

```text
/evolution merge pair skill-a skill-b
/evolution merge status <runId>
/evolution merge approve <rowId>
```

### 诊断

```text
/evolution doctor
/evolution doctor --json
```

## 7. 失败时先看什么

- 命令不存在：`commands` 服务或对应插件行没挂；`/evolution doctor` 先看行状态。
- 工具不存在：`host` 形态本来就没有记忆/技能工具；检查安装形态。
- 路由 404：`connection` 服务缺失，或该行 disabled。
- 业务拒绝仍是 HTTP 200：读 `{ok:false, code, message}`，不要只看状态码。
