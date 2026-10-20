# @lmzhen/dsh-evolution-merge

技能自动合并的 host 面：候选筛选、两轮子代理、审批队列、staging/commit receipt 与 undo。

## 用法

- `/merge scan`：词面候选 + 可用的 C3/L0–L2 闸门，逐对判定。
- `/merge status|pending|skipped|report|runs|cancel`：只读或取消。
- `/merge approve|reject|resume`：待批准/重跑。
- `/merge undo <target> --run <id>`：按 commit receipt 走跨技能单元回退。

## 参数

| 参数 | 档 | 默认 | 说明 |
|---|---|---|---|
| `mergeApproval` | E3 | `false` | 第一轮后停到待批准清单 |
| `mergeSkippedTtlDays` | E3 | `0` | 无需合并保留天数，0 永不过期 |
| `mergeRunTimeoutMinutes` | E3 | `0` | 单次运行上限，0 无上限 |
| `mergePairTimeoutMinutes` | E2 | `15` | 单对轮次超时 |

## 已知限制

- 模型不可用或默认模型未挂载时，screening 回退为词面候选；C3/L0–L2 不运行。
- `merge_stage` 只对当前绑定的 child 开放；未绑定 child 返回 `not-merge-child`。
- undo 的 blob 预检首次会索引版本正文，库很大时是一次性成本。
- tree restore 后的 supersede 覆盖本进程及共享 runs.json 中的 merge run；跨 profile home 不共享。
