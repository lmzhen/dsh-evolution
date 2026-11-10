# 命令

本文覆盖当前用户可调用面。`<...>` 是必填参数，`[...]` 是可选项；命令是否可用还取决于安装形态和对应服务是否挂载。裸输 `/evolution` 可查看宿主注册的帮助。

## 常用诊断与审批

| 命令 | 作用 |
|---|---|
| `/evolution doctor [--json]` | 检查安装形态、平台/家族版本、冲突和服务；`--json` 供脚本读取 |
| `/evolution pending [--detail]` | 列出待批及执行中的暂存写入；`--detail` 显示暂存参数 |
| `/evolution approve <id>` | 批准并执行一条暂存写入 |
| `/evolution reject <id>` | 拒绝一条暂存写入，不执行 |
| `/evolution release <id>` | 把已确认不在执行的孤儿记录放回待批；不是批准 |

`release` 只处理执行中记录。回收前先核实原 runner 是否已经落写及当前效果；回收后再批准会重放暂存操作，该操作可能不是幂等。原批准仍在运行时，不要回收后重复批准。

## 技能历史、恢复与维护

| 命令 | 作用 |
|---|---|
| `/evolution skill history <name>` | 查看技能正文和支撑文件的版本记录 |
| `/evolution skill undo <name> [--to v<N>]` | 回退技能正文；默认上一版，`--to` 指定版本 |
| `/evolution skill undo <name> --unit <id>` | 按事务单元回退正文和支撑文件；不能与 `--to` 同用，执行期失败可能部分完成 |
| `/evolution skill restore <name>` | 从归档恢复一个技能 |
| `/evolution skill pin <name>` | 固定技能，使其免于后台审查和生命周期整理 |
| `/evolution skill unpin <name>` | 取消固定 |
| `/evolution skills health` | 查看技能库结构健康 |
| `/evolution skills refresh` | 手动改目录后丢弃缓存并重新读取 |
| `/evolution mutations` | 查看最近的技能变更记录 |
| `/evolution restore` | 把技能树恢复到最近一次快照，不能选择其它快照 |
| `/evolution propose` | 为正文过大的技能生成 keep 提议，不自动拆分 |

不带 `--unit` 的普通 `skill undo` 只回退 `SKILL.md` 正文，不恢复支撑文件。`--unit` 是另一种事务单元回退：预检拒绝时零写；预检通过后恢复该单元涉及的正文和支撑文件，跨技能单元也会按成员处理。执行期写入失败不做补偿回滚，可能只留下部分已回退路径，因此它不能代替任意时间点的整树备份。

## 整理器

| 命令 | 作用 |
|---|---|
| `/evolution curator run` | 立即运行一次整理，忽略间隔和空闲门 |
| `/evolution curator pause` | 暂停自动整理，不影响手动 run |
| `/evolution curator resume` | 恢复自动整理 |
| `/evolution curator status` | 查看暂停状态、运行次数和上次结果 |
| `/evolution curator report` | 读取最近一次整理报告 |
| `/evolution curator scope` | 查看 managed、watched、exempted、protected 等生命周期范围 |

整理器负责快照、陈旧标记和归档。默认 `llmReview=false` 时不做 LLM 合并提名；开启后可以产生 consolidation 提名。独立 merge 才使用下一节的 scan/pair 运行与提交流程。

## 维护扫描

| 命令 | 作用 |
|---|---|
| `/evolution maintain` | 异步启动维护扫描并返回 run id |
| `/evolution maintain --timeout=<ms>` | 指定本次扫描超时 |
| `/evolution maintain --facts` | 只生成零模型 token 的事实预览 |
| `/evolution maintain status [id]` | 查看当前或指定扫描状态 |
| `/evolution maintain report [id]` | 读取指定报告；省略 id 时取本 home 最新报告 |
| `/evolution maintain handoff [id]` | 把报告交给模型，由模型汇报并等待后续确认 |
| `/evolution maintain cancel [id]` | 取消当前或指定扫描 |

维护扫描本身只产生报告，不会自行修复。`handoff` 是显式的模型交接，不等于自动执行整改。

## 学习、回放与结构调整

| 命令 | 作用 |
|---|---|
| `/evolution learn [request]` | 向当前会话发一条学习请求 |
| `/evolution replay` | 从活动记录比较不同会话和重启之间的计划结果 |
| `/evolution restructure <name> "<heading>" <to_file> [--plan <runId>]` | 把技能正文的一节移到 references 文件 |
| `/evolution extract <source> <target> "<heading>" [--start <line>] [--end <line>] [--outcome extract|mixed] [--apply]` | 预览或执行跨技能提取；默认只生成计划，`--apply` 才写入 |

`replay` 依赖活动记录。默认 `reviewMode=inject` 不产生 `evolution/plan-applied` 记录，因此没有相应数据时不能据此推断回放已经完成过实际评估。

## 参数查看

| 命令 | 作用 |
|---|---|
| `/evolution params [--group <name>] [--json]` | 查看参数、分组、档位、生效时机、来源和当前值 |

参数写入走平台插件管理的 row 配置页；安装/卸载/更新也走平台插件管理。完整参数表见 [../packages/PARAMETERS.md](../packages/PARAMETERS.md)。

## 技能合并

### 启动与观察

| 命令 | 作用 |
|---|---|
| `/evolution merge scan` | 扫描技能库并启动合并筛选 |
| `/evolution merge pair <a> <b>` | 对两个技能启动合并 |
| `/evolution merge pair --force <a> <b>` | 已注册的强制 pair；当前默认 `mergeApproval=false` 下会因 round2 缺少 round1 子会话而返回 `no-session`，不是可用替代 |
| `/evolution merge status [runId]` | 查看当前或指定 run 状态 |
| `/evolution merge report [runId]` | 读取当前或指定 run 报告 |
| `/evolution merge cancel [runId]` | 取消当前或指定 run |
| `/evolution merge runs` | 列出合并运行 |
| `/evolution merge doctor` | 检查本地模型、配置、队列和运行条件 |
| `/evolution merge reconcile` | 运行状态收敛并读取协调结果 |

### 待批、候选与恢复

| 命令 | 作用 |
|---|---|
| `/evolution merge pending [--expired]` | 查看待决合并；`--expired` 只看已过期项 |
| `/evolution merge approve <id>` | 批准一个待决合并 |
| `/evolution merge reject <id>` | 拒绝一个待决合并 |
| `/evolution merge skipped` | 查看已跳过的技能对 |
| `/evolution merge skipped --restore <id>` | 恢复一个已跳过技能对 |
| `/evolution merge candidates` | 查看候选 |
| `/evolution merge candidates --retry [id]` | 重试候选生成或指定候选 |
| `/evolution merge resume [runId]` | 查看可恢复的合并运行 |
| `/evolution merge resume --retry [runId]` | 重试可恢复运行 |
| `/evolution merge resume --clear <id>` | 清除指定恢复状态 |
| `/evolution merge discard <id>` | 丢弃指定合并记录 |
| `/evolution merge undo <target> --run <id>` | 按 run 反序撤销目标上的合并单元 |

`mergeApproval=false` 时不进入人工待批；设为 `true` 后，第一轮结果会进入 pending。它只控制合并审批，不替代本地模型配置或平台写入条件。

合并面板只读：队列、A/B 正文和历史可以查看，动作按钮复制相应命令。

## 学习图

| 命令 | 作用 |
|---|---|
| `/graph` | 显示技能和记忆节点及关系 |
| `/graph detail <nodeId>` | 查看节点详情 |
| `/graph edit <nodeId> <text>` | 修改技能正文或一条记忆 |
| `/graph delete <nodeId>` | 删除节点对应内容 |

技能节点使用技能名。记忆节点使用 `/graph` 给出的完整 `memory:<source>:<index>:<snapshot>` id，快照片段用于发现索引漂移。

`delete` 对两种节点含义不同：**技能会归档**，可用 `/evolution skill restore <name>` 恢复；**记忆条目会直接移除**，不是把记忆归档。两类写入都经过相应写入门禁和可选审批。

## 技能发现域

| 命令 | 作用 |
|---|---|
| `/skill-domain status` | 查看发现域状态 |
| `/skill-domain generate` | 生成全局发现域图 |

发现域默认 `mode=off`。`featureEpoch`、`mapReferenceCwd` 等启用条件见 [configuration.md](configuration.md#技能发现域)；`mode=on` 缺少所需 LLM 服务时会明确失败，不会静默降级。

## 模型工具与安装形态

`all`、`preset` 和分层预设会话提供 `memory` / `skill_manage` 等模型工具；host 不提供这两个工具，但仍带 `maintenance_probe` 和 `merge_stage`；`merge_stage` 只绑定合并子代理，不是普通用户直接调用的工具。命令存在不代表当前形态挂载了对应功能，服务缺失时应按错误提示检查安装形态。

`/evolution` 完全不存在时，先检查安装 profile 和重启状态，不要试图用同样不存在的 doctor 排查。
