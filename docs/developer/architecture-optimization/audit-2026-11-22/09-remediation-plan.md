# 全量审计修复路线

基于 [README.md](README.md) 的 P0/P1/技术债。R0-1（P0-1）、R0-2（A1）、R0-3（B5）、R0-4（D1）、R0-5（F1-F2）、R0-6（E3）、R0-7（E7）；C1（P1-1）、C3（P1-3）、C2（P1-2）、B1（P1-3/P1-5）已于 2026-11-22 在 main 源码实现，尚未发布，见 [12-r0-observation-plan-design.md](12-r0-observation-plan-design.md) 与 [13-r0-platform-contract-design.md](13-r0-platform-contract-design.md)。先定级再排期；所有行为修复必须带定向测试，验证链修复必须能对旧数据变红。

## 批次 0：先止血（1–3 天）

| 任务 | 修复 | 验收 | 依赖 |
|---|---|---|---|
| R0-1 P0-1 | `readDispatchRecord` 读取 `data.message.isError`；`write-gates` 夹具改用平台 `createToolResultMessage` 真实形状 | 失败 skill 读取 → `E-318`；payload 顶层伪造不再能过 | 无 |
| R0-2 A1 | 多 op plan 的 create 副作用移出 prepare：`createCore` 的 audit/notify 统一进 commit hook；或暂时禁止 create 进入 multi-op | 多 op create 成功只产生一条 audit/event；被拒不留版本/ledger | 无 |
| R0-3 B5 | `internal/config` 钩子改为 cordis 4.1 `(fiber, next) => fiber !== ctx.fiber` | 真机/平台发射路径下越界 settings 被拒 | 无 |
| R0-4 D1 | LLM `completeText` 按 finish kind 分类：`aborted`→cancelled，`error`→映射，缺 finish→transport | abort 调用返回 cancelled，不落半截文本 | 无 |
| R0-5 F1/F2 | confirmMode 现取 seat 的 `value` 并订阅；PendingCard 用 `useSyncExternalStore` | 默认部署、显式 auto、未知值三态行为与显示一致 | 无 |
| R0-6 E3 | release evidence 复算 artifact sha256；traceability 绑定 measured commit；`evidenceStatus` 不由装配脚本写 | 旧 commit/旧 spike 的 evidence 被 `--release` 拒绝 | 需要 dist 产物 |
| R0-7 E7 | `argv-ci-parity` 进 `verify-check-registry` 硬判；当前 2 条漂移清零 | 改 action/manifest 单侧即红 | 无 |

R0-1、R0-3、R0-4 必须先在真实平台形状/真实发射路径上写负例，否则改完仍是假绿。

## 批次 1：写入门禁与恢复（约 1 周）

| 任务 | 修复 | 验收 |
|---|---|---|
| R1-1 A2 | home 级 sidecar（`.mutations.json`、`.usage.json`、event log、state）统一用平台 file lock/HomeFence；keyed 模式不得绕过 | 双宿主并发写不同技能，审计/用量零丢更新 |
| R1-2 A3/A4/A5 | 恢复拒绝汇总上报 doctor；repair 复用平台 takeover claim；rollback 收集全部失败而不是首错停止 | 崩溃恢复失败可见；双持有窗口消除；多目标补偿全部尝试 |
| R1-3 C1 | merge 恢复 branch B 依次 finalize→rollForward→rollback，暴露单 unit recovery 命令 | 在 target-written/source-live 状态下能恢复到一致树 |
| R1-4 C2 | stageKey 绑定 runId/generation；复用前校验 digest 并清 `merged/`；行关闭统一 `closeRow()` | retry 不提交上一代文件；discard 再 pair 后 approve 不 stage-failed |
| R1-5 C3 | owner 判据统一 pid-aware `runs.hasOwner()`，移除本进程 registry 判断 | 双宿主同 pair 不重复起 run |
| R1-6 A6 | restoreSnapshot 的 state 写走 `transactCuratorState`，只回写簿记字段并保留 `paused` | 并发 pause 不被覆盖 |
| R1-7 A7 | `scheduleAuxDebt` 返回每 kind 的 scheduled/busy/failed；成功后才 consumeDebt；失败回滚 debt | transient 失败不再丢段末复查 |

## 批次 2：审批、工具、UI（约 1–2 周）

| 任务 | 修复 | 验收 |
|---|---|---|
| R2-1 B1 | `SkillWriteOp` 增 delete/restructure/extract 结构 op；staging 统一 plan；preview 从 plan 生成 | 审批预览 = 回放字节；旧 pending 无 plan 拒绝 |
| R2-2 B2/B3 | list render 输出名字；summary 透传到 audit/history | 模型能看到 names；history 出现模型 summary |
| R2-3 B4 | `catalogWinner` 区分“可读且空”与“读失败/服务缺失”；只有后者 strict 拒绝 | strict + 空库第一个 create 成功 |
| R2-4 C2/审批 UI | approval GET 去掉 `expireStale` 写副作用；merge decision 进 HOST_ROUTES 并落 DecisionAudit | GET 幂等；decision 路由可校验、审计有 principal |
| R2-5 F3/F4 | StatsPage 加常驻 refreshFailure strip；延迟读 failed 可重试；ticket 按 `(skill,v,kind)` 分域 | 刷新失败可见；一次失败后可重试；刷新不作废展开 |
| R2-6 07-P2 | 删 configForms/workspace 的假字段，工作区 key 用 session/cwd；隐藏视图不轮询；load-more 失败保留旧行 | 契约与平台快照一致；无假 scope；首屏 0 个 merge 请求 |

## 批次 3：验证链与架构（跨版本）

| 任务 | 修复 | 验收 |
|---|---|---|
| R3-1 E1 | `run-gates local` 校验 overlay 身份/版本，不匹配整类 cannot-decide | 本地读数的 path 全部属于当前镜像/显式 overlay |
| R3-2 E2 | gate-13/14/15 搬回脚本或删除；gate-75 比提交内容而非刚复制文件；arch registry 加双射/存在性自检 | 四类检查能真实失败；5 个死键清零 |
| R3-3 E4/E5/E6 | CI 固定 `-c vitest.family.config.mjs`；coupling ledger 使用版本 expiry 并对 unknown/tree≠HEAD 判红；永久 skip 从 lane 成员剔除或登记 DEFERRED | 本地/CI 同一执行集合；过期登记即红；skip 可见 |
| R3-4 D2 | 平台契约由平台类型派生；`--upstream` 指 cohort；local 去 `--accept-recorded`，208 条差异压回 0 | 平台改名/改形在编译或 strict gate 红 |
| R3-5 架构 | 拆 `SkillLibrary`；拆 `evolution-ui` host/client；三个千行 `apply` 改分派表；删退役 preset 的活表面 | 超过预算的包/函数有机械门禁；新增共享面不再默认塞 core |

## 明确不做

- 不在 0.59.6 已发布字节上重打 tag/静默补发；修复进下一版本，版本/时机由用户确认。
- 不重写 `evolution-merge-engine` vendored 引擎；保持字节冻结。
- 不为“看起来整齐”单纯拆包；先以 R3-5 的机械门禁证明边界收益。
- 不把“缺测试”本身当修复项；每条修复必须有可失败的负例。
