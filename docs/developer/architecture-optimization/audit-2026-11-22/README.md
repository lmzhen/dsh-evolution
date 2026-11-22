# 插件全量审计（2026-11-22）

审计对象：`D:\dsh\dsh-evolution-mirror` @ `564431ac`（0.59.6 发布后、单 Provider 收口后）。
平台权威源码：`D:\dsh\harness-rc3`；声明 cohort 为 `0.2.2-rc.5`，涉及 rc.5 差异处按 rc.5 安装闭包交叉核对。

## 结论

本次由 8 个上下文隔离的只读审计员分域完成，根代理去重、定级并抽检了最关键的 6 条。未修改任何源码。

- **P0 = 1**：失败的 skill 读取被计为成功，`READ_BEFORE_WRITE` 门禁可绕过。
- **P1 = 28**：覆盖写入门禁、审批 plan、merge 恢复、跨进程状态、LLM 取消、平台接缝、发布证据、UI 状态。
- **P2/技术债/屎山约 117 条**（原始报告计数，未逐条去重）：核心是上帝包与巨型 `apply`、五层锁/两套 CAS 模型、重复状态机与客户端契约、死包/死字段、门禁假绿。
- **发布影响**：0.59.6 已发布字节不变；这些是当前源码的审计结果。任何修复都需要新补丁版本，不能静默重发 0.59.6。
- **发布证据风险**：现 `0.59.6` 的 rehearsal 仍携带 0.59.5 的 spike 数据，SPIKE 哈希无复算；这被列为 P1-E3，必须在下一版发布前修掉。

## 执行状态（2026-11-22，未发布）

- R0-1 / P0-1：已在 main 源码修复（平台真实 `message.isError` + 测试夹具），见 [12](12-r0-observation-plan-design.md)。
- R0-2 / A1：已在 main 源码修复（prepare 期间跳过 create 直接 audit/notify），见 [12](12-r0-observation-plan-design.md)。
- R0-3 / B5 与 R0-4 / D1：已在 main 源码修复（platform 4.1 调用约定、LLM aborted 终态），见 [13](13-r0-platform-contract-design.md)。
- R0-5 / F1-F2：已在 main 源码修复（effective config value + 惰性 settings 订阅），见 [14](14-r0-ui-confirm-design.md)。
- R0-6 / E3：已在 main 源码修复（dist tarball artifact 绑定 + release 门），见 [15](15-r0-release-evidence-design.md)。
- C1/P1-1：merge 恢复 branch B 已增加 rollback 兜底，见 [19](19-c1-recovery-fallback.md)。
- C3/P1-3：merge `isOwnerActive` 已改为 `runs.hasOwner()`，见 [20](20-c3-owner-liveness.md)。
- C2/P1-2：staging 复用前清 merged，reject/discard 等关闭行统一清 stage，见 [21](21-c2-staging-generation.md)。
- B1/P1-3+P1-5：list 名字进入模型 content；strict 空视图不再拒绝首个 create，见 [22](22-b1-list-catalog.md)。
- 03/P1-2：curator restoreSnapshot 的 state 写改为 transact 并保留当前 paused，见 [23](23-p1-curator-restore-pause.md)。
- B1/P1-4：模型 summary 经 plan 上下文进入 history/audit，见 [24](24-b1-summary.md)。
- A3/A5：prepared 恢复失败现在 warn；rollback 不再首错停止，见 [25](25-a3-a5-recovery-compensation.md)。
- A4：锁 repair 现在走 takeover claim + 重读，见 [26](26-a4-repair-takeover.md)。
- E4：gate-03 命令已加载 family config，见 [27](27-e4-family-config.md)。
- E1：local gate overlay 改为当前构建线，adapter identity 不再硬编码，见 [28](28-e1-overlay-identity.md)。
- F3/F4：刷新失败 strip + 延迟读失败重试，见 [29](29-f3-f4-retry.md)。
- A7：review aux 只对 scheduled debt 结账，见 [30](30-a7-review-debt.md)。
- B1-2：delete/restructure/extract 绑定输入树与 plan，预览=回放；见 [31](31-b12-structural-anchor.md)。
- E6：删除两个永久跳过的门禁仿真测试，见 [32](32-e6-remove-skips.md)。
- E5：平台耦合账本改为 expected/both，strict 判 unknown/过期/tree 陈旧，见 [33](33-e5-test-lines.md)。
- P2：删除 `SKIP_MANIFEST_FRESHNESS` 死开关，见 [34](34-p2-dead-switch.md)。
- A2：approval reload+marker、review/curator lease+reload、home sidecar 平台文件锁；见 [38](38-a2-executed-marker.md)。
- D2：契约检测过滤 family 路径并对 rc.5 strict 通过；见 [39](39-d2-contract-strict.md)。
- Phase B/P2：bundle roster 生产 forms 改 io-platform；本地 61/0/3；见 [44](44-bundle-roster-platform.md)。
- E7 剩余：4 条 ci-only 行补 noDrillReason，falsifiability-carrier live=0；见 [41](41-e7-falsifiability.md)。
- E2：gate-13/14/15 改为真实检查，gate-75 改为 action step，见 [35](35-e2-real-gates.md)。
- R0-7 / E7：已在 main 源码修复（argv-ci-parity 进入 check registry；2 条 substitution 登记；mutation ledger 刷新），见 [16](16-r0-meta-gate-design.md)。
- 其余 P0/P1 仍按 [09-remediation-plan.md](09-remediation-plan.md) 处理；本 goal 不发布中间版本。

## 方法

- 8 个子智能体各自只读一个域，互不继承上下文；只允许写自己的报告文件。
- 每个结论要求 `文件:行` + 机制；无法确认的标 `likely` / `unverified`。
- 根代理去重后给每个 P1 唯一 ID；对以下做代码抽检：
  - P0-1 读证据形状；
  - A1 multi-op plan 副作用；
  - B5 `internal/config` 调用约定；
  - D1 LLM `aborted` 终态；
  - C1 merge 恢复分支；
  - F1 界面默认值反转。
- 未运行全量测试/构建；各报告自行跑过的只读门禁/命令在报告内注明。

## 计数

| 报告 | 域 | P0 | P1 | P2/债 |
|---|---|---:|---:|---:|
| [01](01-core-write.md) | core 写入 / IO / 锁 / 恢复 | 0 | 5 | 16 |
| [02](02-tool-skill-manage.md) | tool-skill-manage / discovery / health / commands 接缝 | 0 | 6 | 25 |
| [03](03-curator-review-state.md) | curator / review / state / activity / memory | 0 | 3 | 14 |
| [04](04-merge-undo.md) | merge / merge-engine / undo / approval replay | 0 | 3 | 10 |
| [05](05-platform-seam.md) | platform-contract / adapter / 组合包 | 0 | 2 | 14 |
| [06](06-architecture.md) | 架构 / 依赖 / 生成物 / 门禁 | 0 | 2 | 14 |
| [07](07-ui-client.md) | UI / client / host 接缝 | 1 | 3 | 11 |
| [08](08-tests-debt.md) | 测试 / 门禁 / 发布证据 | 0 | 5 | 13 |
| 原始合计 | | 1 | 29 | 117 |
| 去重后 | | **1** | **28** | 约 117 |

去重/定级说明：

- 01-P1-2（home sidecar 单进程 transact）与 03-P1-1（storage-domain 进程内存）合并为 **A2**，同一跨进程状态根因的两种后果。
- 02-P1-1（失败读取计入 read）按安全门禁失效升为 **P0-1**；按仓库 P0 口径不是普通数据丢失，但它直接绕过写入安全门禁。
- 07-P0-1（界面确认默认反转）按“无数据破坏、仅 UI 默认相反”降为 **P1-F1**；07 报告仍保留其原始 P0 标题，读者可按需重判。

## P0

### P0-1 失败的 skill 读取被计为“读过”，read-before-write 可绕过

- 平台写入形状：`tool/result` 的失败标志在 `message.isError`（`harness-rc3/packages/llm/llm/src/message.ts:299-307`；`batch.ts:255-265` 把 `message` 放进事件）。
- 家族归一化器只读 payload 顶层 `data.isError`、`data.error`，以及 `message.content` 里 `type:'tool-result'` 的 block（`packages/evolution-core/src/tool-dispatch.ts:164-184`）。普通 `Error` 不产生 `data.error`，`firstResultBlock` 也找不到 `tool-result`，于是 `ok` 判为 true。
- 后果链：失败的 `skill` 读取进入 read 集合（`tool-dispatch.ts:529-562`）→ `READ_BEFORE_WRITE` 放行（`write-gates.ts:322-350`）→ 非前台写入可盲改未读到的正文；同一 `ok` 还会增加 usage view。
- 测试绿的原因：`tool-skill-manage/tests/write-gates.spec.ts:33-39` 在 payload 顶层伪造 `isError`，平台从不写这个字段。
- 修复方向：`readDispatchRecord` 的 native 分支补 `data.message?.isError !== true`；测试夹具改为平台 `createToolResultMessage` 的真实形状；加一条失败读取 → `E-318` 回归。
- 抽检：已读 `readDispatchRecord` 与平台 `createToolResultMessage`；确认。

## P1

| ID | 问题 | 证据（详见分报告） | 触发/影响 | 状态 |
|---|---|---|---|---|
| A1 | 多 op plan 中 create 的 audit/event 在 prepare 阶段落盘；成功重复、被拒留幻影 | `skill-store.ts:1041-1066, 2187-2188, 4079-4127`；01-P1-1 | 多 op plan 含 create 且后续失败/CAS 漂移 | 代码确认；当前无生产多 op 调用方 |
| A2 | keyed 跨进程并发下 home sidecar / state-domain 仍以单进程 transact 或进程内存为判据 | 01-P1-2、03-P1-1 | 已收口：platform io transact 文件锁 + approval/review/curator 刷新/lease | 代码+平台对照；需双宿主 |
| A3 | 崩溃恢复的拒绝/漂移结果被静默丢弃 | 01-P1-3；`skill-store.ts:1129-1134` | prepared 单元永久停留，undo 一律被拒 | 代码确认 |
| A4 | `repair()` 直接删锁，绕过平台 takeover claim | 01-P1-4；`authority.ts:269-290` | 另一进程刚写入锁时被删，双持有 | 机制确认，窗口小 |
| A5 | 失败补偿遇第一个 blocked target 即停止，其余不回滚 | 01-P1-5；`mutation-unit.ts:581-586` | 多目标单元失败后留下更多本单元字节 | 代码确认 |
| A6 | curator `restoreSnapshot` 整条 state 覆盖写，吞并发 `setPaused` | 03-P1-2；`curator/index.ts:945-963` | restore 与 pause 并发；暂停被静默撤销 | 代码确认 |
| A7 | review aux 段末先清零 durable 计数/删闩锁，再调度；失败结果被丢 | 03-P1-3；`review/index.ts:770-781, 1056-1073` | transient lease/child/io 失败丢一次复查 | 代码确认 |
| B1 | approval 的 delete/restructure/extract 无 plan/anchor；extract 预览与回放不同字节 | 02-P1-2；`index.ts:281-323, 389-416, 1740-1755` | 审批时盲目批准/批准了不同 diff | 代码确认 |
| B2 | `list` 不把技能名渲染给模型，names 只在不可见 canonical value | 02-P1-3；`index.ts:986-993, 1456-1468` | 模型调用 list 得不到名字 | 代码确认 |
| B3 | 模型必填的 `summary` 在 5 个内容写动作上不落 history | 02-P1-4；`index.ts:1061-1127`；`skill-store.ts:4039-4057` | 强制模型输入却永远用 host 兜底文案 | 代码确认 |
| B4 | `strictCrossSource` 把空视图当 unknown，拒绝第一个 create | 02-P1-5；`index.ts:837-893` | 启用 strict 的空库无法写入 | 代码确认 |
| B5 | `internal/config` 钩子用 cordis 4.0.x `this` 约定；rc.5/cordis 4.1 上 `this=null` | 02-P1-6；`harness-rc3/vendor/cordis/src/fiber.ts:678, events.ts:162-171` | 设置上限校验恒不生效，可放宽部署上限 | 已抽检确认 |
| C1 | merge 恢复 B 分支只 rollForward，失败无 rollback 兜底 | 04-P1-1；`recovery-coordinator.ts:27-95` | 进程在 target 写入后、source 归档前死亡 → 半合并卡死 | 代码确认；生产无单 unit 恢复入口 |
| C2 | staging 树不绑定代，重试可能提交上一代 `merged/` 残留；旧树让后退/再 pair 的 approve 失败 | 04-P1-2；`new-child-authoring.ts:63-86`、`staged-tree.ts:41-67` | round2 失败后 retry；discard 后再 pair | 机制确认；提交污染标 likely |
| C3 | 跨面 in-flight 判据读本进程 registry，外部活 run 被判 inactive | 04-P1-3；`index.ts:357-360`、`run-registry.ts:595-597` | 双宿主同 home 的 pair/approve/resume | 代码确认；CAS 防双合并 |
| D1 | `completeText` 把平台归一化的 `aborted` finish 当成功，返回半截文本 | 05-P1-1；`adapter/llm.ts:46-61`；`llm/types.ts:163-172` | 会话取消/step abort/超时后辅助模型结果被当完整结果落盘 | 已抽检确认 |
| D2 | 声明 cohort rc.5，但 `verify-platform-contract` 锚点录自 0.1.5-rc.2，local 带 `--accept-recorded`；dev 类型线为 0.2.1-rc.2 | 05-P1-2；`verify-platform-contract.mjs:8,63,400` | 声明线 208 条 recorded 差异被放行，rc.5 新行为无仓内类型证明 | 报告实测 |
| E1 | `run-gates local` 的 14/62 条记录在 `harness-0.2.1` 旧树判定，12 条 pass；本地从未 lint 本仓、7 个生成器判旧树 | 06-P1-1；`run-gates.mjs:53`、`lib-env.mjs:36-44` | 本地绿不代表镜像绿 | 报告实测 path 46/14/2 |
| E2 | 四类架构检查无执行体/无判别力：gate-13/14/15 指向不存在的 `D:/dsh/audit-v37/*`；gate-75 本地 skipped，CI 只比刚复制出的两份 | 06-P1-2；`gates/guards.mjs:97-138`、`action.yml:65-116` | tsconfig/manifests/布局同步没有真实判定 | 报告实测 |
| E3 | release evidence 可被旧数据填充：spike 哈希不复算，traceability 只比数字，`evidenceStatus` 由装配脚本自写 | 08-P1-1；`release-evidence-rehearsal.json:2`、`lib-release-evidence.mjs:46,143-177` | 上一版 spike + 新版本号即可过发布门 | 已有 0.59.6 carry-forward 实证 |
| E4 | CI 套件不加载 `vitest.family.config.mjs`，档位/alias/超时策略悬空 | 08-P1-2；`gates/unit.mjs:14,16`、`family-facts.json:485-486` | 本地/CI 执行集合和策略不一致 | 报告实测 |
| E5 | 平台耦合账本 175 条全 `pending/unknown`，`--strict` 永不红，tree 已落后 HEAD | 08-P1-3；`family-test-lines.json:2-11`、`verify-test-lines.mjs:51-84` | 新增/迁移 spec 不改变登记也能绿 | 报告实测 |
| E6 | 两个永久跳过的门禁仿真仍计入 lane：rg4-two-process 整文件 skip；rg7-install 依赖本机绝对路径/skipIf | 08-P1-4；`rg4-two-process.spec.ts:8`、`rg7-install.spec.ts:9,13` | 门禁读数含永不执行成员 | 代码确认 |
| E7 | 元门禁核心判据 report-only；2 条 argv 漂移、4 条无 falsifiability carrier 仍 exit 0 | 08-P1-5；`verify-gate-manifest.mjs:432-476` | 已收口：argv parity 进 registry，4 条 ci-only 行补 noDrillReason，轴 0 live | 报告实测 |
| F1 | “批准前先确认”显示 `auto`，实际一律 `ask`：读 seat 的 user 层并 `?? 'ask'` | 07-P0-1（本表按 P1）；`PendingCard.ts:50-55,98`、`history/client/index.ts:36-39` | 默认部署每次批准多一次点击，界面值与行为相反 | 已抽检确认 |
| F2 | settings 座在 apply 时只取一次，且订阅回调不触发渲染 | 07-P1-1；`history/client/index.ts:33-42` | 显式选择“直接执行”不生效/要刷新 | 代码确认，触发依赖时序 |
| F3 | 数据总览刷新失败静默保留旧表，无失败提示 | 07-P1-2；`StatsPage.ts:65-76` | 宿主重启/401 时旧数据当新数据 | 代码确认 |
| F4 | diff/body 延迟读失败后缓存失败态，无重试入口 | 07-P1-3；`useSkillHistory.ts:247-252` | 一次网络抖动后永久空白 | 代码确认 |

## 平台接口对照

| 接缝 | 结论 | 证据 |
|---|---|---|
| `tool/result` 事件形状 | **误用**：失败标志在 `message.isError`，当前只读 payload 顶层/block | P0；`tool-dispatch.ts:164-184` vs `message.ts:299-307` |
| `internal/config` waterfall | **不兼容**：cordis 4.1 用首参 fiber/this=null；当前 4.0 `this` 约定，钩子静默失效 | B5；`fiber.ts:678`、`events.ts:162-171` |
| LLM finish 终态 | **漏判**：`aborted` 是终态，当前只处理 `error`；返回半截文本 | D1；`llm/types.ts:163-172,488-495` |
| `session/event` / `fs/observed` 签名 | 形状正确；observation 解释平台 `FsVersion` 的 token、owner 不派生 | 01/02 P2；`fs/types.ts:28-34` |
| `configForms` 快照 | 已对齐：家族只保留平台 6 字段/5 方法 | 07-P2-3；见 [49](49-p2-configforms-shape.md) |
| `workspace` 服务 | 已对齐：由 sessions 主 session + workspaces.items 取 workspace id | 07-P2-4；见 [50](50-p2-workspace-id.md) |
| `HOST_ROUTES.merge` | 已收口：`decision` 进入 `HOST_ROUTES`，host/client 单源 | 07-P2-1、04；见 [42](42-p2-merge-decision-route.md) |
| `sendMessage` options | 契约可选，平台必填 `{signal}`；当前调用方总带，但类型洞 | 05-P2-5；`subagent/src/index.ts:368-375` |
| `configEditor.configuration` | 契约 `Promise<unknown>`，平台同步数组；返回值类型说谎 | 05-P2-1；`platformView.ts:14` vs `config-editor/index.ts:49-70` |
| `dsh.resolverDependencies` | 四份清单仍声明，rc.3/rc.5 无平台读者 | 05-P2-8；`profile.ts:313` |

已核对无误的主路径（摘要）：`agents.get/list` 根判据、`modelSelection` 的 `{lastUsed,next}`、projection hybrid handle、`connection.fetch.register` 路由、review-child `createScope+sessions.create`、`tools.register/guard`、`settings.configure`、命令注册、`dsh.client` 客户端扫描。

## 架构与技术债

1. **验证层与判定对象脱钩**（E1/E2/E3/E4/E5/E6/E7、D2）：本地门禁在旧 overlay 上判定、CI 测试不加载 family config、平台锚点录自旧版本、release evidence 允许旧数据填充、账本全 pending、永久 skip 仍计数。这是本次审计最重要的系统性问题；它会让行为 bug 长期不被发现。
2. **`evolution-core` 事实上帝包**：28,044 行 src（全仓 35%），112 个文件平铺 `src/`，21 个 exports，13 个包依赖；barrel 70/75 star 只剩 5 条预算。`SkillLibrary` 4,145 行/102 方法；`tool-skill-manage` 单 `apply` 1,205 行；`commands` 1,081；`review` 958；全仓 ≥100 行函数 83 个（见 06-D1/D2）。
3. **写路径五层锁/两套 CAS**：`ROOT_SERIAL`、`SkillTargetLocks`、`SkillRootGate`、`HomeAuthority`、`TargetLockSet` 并存；`WriteKernel` 用原始字节，`SkillWriteService` 用 contentHash，平台 `FsVersion` 未直接用；死 API `WriteKernel.commit/run/compensate`、`writeFileCas`、`atomicWriteFiles` 无调用方（01-P2）。
4. **重复状态机/契约**：merge 的 scan/round2 两套 pair 状态机、三套行结果表示；approval 与 UI 各写一份 PendingRow；`platform-contract` 与 `adapter` 19 个 port 三处枚举；HOST_ROUTES 与客户端路由各拼一份。
5. **退役/死面**：`evolution-preset` 已排除发布仍有 bundle patch/cordis.yml/peers；`dsh.resolverDependencies` 死字段；`evolution-agent/agent.cordis.yml` 自述 legacy 仍打包；`verify-architecture-baseline.mjs`/基线 JSON 已删除（06-D11）；arch 注册表 5 个死键（06-D9）。
6. **UI host/client 混装**：`evolution-ui` 一个包同时 host 行与浏览器入口，客户端组件散在 `panels/*.ts`；`build-client` 只认 `src/client/index.ts`，放错目录静默不进构建（06-D8）。
7. **文档漂移**：`architecture.md` 仍写 36 包/0.49 基线；`architecture-optimization/README` 仍写“剩余发布门禁”，实际已发布 0.59.6；本次审计文档用于校正当前事实（见 08-P2-13、06-D14）。

## 更优实现（机制级）

1. **真正的 prepare/commit**：给 `MutationUnit` 加无副作用的 `prepare(op)`（锁内读→校验→返回 before/expected/next），`applyMulti` 一次锁内 prepare 全部，再单次 commit；删除 `PLAN_SINK`、假 `MutationUnit`、`pendingCreate` 旁路和顺序依赖（修 A1/A5/A3 根因）。
2. **平台接口从平台类型派生**：`HostPlatformPorts` 用平台服务类型 `Pick/Satisfies` 生成，contract 只保留家族语义名；LLM finish 终态集中 `finishToError`；`internal/config` 按 cordis 4.1 首参 fiber；不再手抄 `configForms/workspace/sendMessage` 形状（修 B5/D1/D2/P2-2）。
3. **单一证据链**：`run-gates local` 校验 overlay 的版本/身份；`--release` 复算 dist tarball sha256 与 spike 比对；traceability 必须等于 measured commit；所有登记表有版本 expiry（修 E1/E3/E5）。
4. **审批全动作 plan 化**：`SkillWriteOp` 增 delete/restructure/extract 结构 op，staging 统一 plan，preview 由 plan 生成（修 B1）。
5. **merge 恢复/代际/owner 单入口**：`settleUnit(journal)` 依次 finalize/rollForward/rollback；stageKey 带 runId/generation，`closeRow()` 统一 dropStage；owner 判据统一 pid-aware（修 C1/C2/C3）。
6. **UI 单一状态源**：`confirmMode` 每次现取 seat 的 `value` 并订阅 form；workbench 只在 active view 启动 merge 轮询；延迟读失败可重试，ticket 按 `(skill,v,kind)` 分域（修 F1-F4）。
7. **结构拆分**：`SkillLibrary` 拆 read/write/history/health；`evolution-ui` 拆 host/client；三个千行 `apply` 改分派表；门禁分“判据/执行器/登记表”（06-S/M/L）。

## 修复路线

见 [09-remediation-plan.md](09-remediation-plan.md)。原则：

- 先修 **P0-1 + A1 + B5 + D1 + F1/F2** 这类安全门禁/设置/取消/默认值问题；
- 再修跨进程状态与恢复（A2-A5、C1-C3）；
- 再修审批/merge/UI 的功能缺口（B1-B4、F3/F4）；
- 验证/发布链修复与行为修复分开落地，避免再用旧证据发布新版本；
- 0.59.6 不重发；修复进入下一版本，最终发布需用户确认。

## 验证边界

- 本次是只读审计，没有修改源码；报告目录外的 `git status` 不应有变化。
- Lead 抽检 6 条（P0-1、A1、B5、D1、C1、F1）；其余为各审计员的 `代码/实测/likely` 结论，分报告中已标注。
- 未运行全量测试/构建；06/08 的“实测”是审计员自己跑的只读命令，未由 lead 复跑。
- 04 的 C2 提交污染、C3 双面时序标 `likely`；A2 的双宿主影响需部署条件；B3 是否算 P1 可按产品口径重判。
- P2 数量按各报告原计数展示，未逐条去重；不要把 117 当作精确唯一计数。

## 报告索引

| 文件 | 内容 |
|---|---|
| [01-core-write.md](01-core-write.md) | core 写入/IO/锁/恢复与平台 fs 对照 |
| [02-tool-skill-manage.md](02-tool-skill-manage.md) | tool 主链路、approval staging、discovery/health/commands 接缝 |
| [03-curator-review-state.md](03-curator-review-state.md) | 后台生命周期、review、state、activity、memory |
| [04-merge-undo.md](04-merge-undo.md) | merge 事务、undo、recovery、approval replay |
| [05-platform-seam.md](05-platform-seam.md) | platform-contract/adapter/组合包与 18 个接口 |
| [06-architecture.md](06-architecture.md) | 包边界、依赖、生成物、门禁、拆分建议 |
| [07-ui-client.md](07-ui-client.md) | UI/client/host 接缝、settings、workbench、merge UI |
| [08-tests-debt.md](08-tests-debt.md) | 测试/门禁/发布证据、永久 skip、假绿 |
| [10-system-framework.md](10-system-framework.md) | 第一性原理/系统科学/系统工程整合框架：八不变量、七平面、六失效模式、V 模型与目标内核 |
| [11-target-architecture.md](11-target-architecture.md) | 综合目标架构：HomeFS/UnitKernel/PlanService/StateStore/Projection/Assurance、旧组件去留、迁移与验收 |
| [13-r0-platform-contract-design.md](13-r0-platform-contract-design.md) | R0-3/B5 + R0-4/D1 平台调用约定与 LLM 终态设计与实现 |
| [14-r0-ui-confirm-design.md](14-r0-ui-confirm-design.md) | R0-5/F1-F2 UI 确认 effective value 与 settings 订阅 |
| [15-r0-release-evidence-design.md](15-r0-release-evidence-design.md) | R0-6/E3 evidence 绑定实际 dist tarball 与 release 门 |
| [16-r0-meta-gate-design.md](16-r0-meta-gate-design.md) | R0-7/E7 argv-ci-parity 进 ledger、替换登记、mutation 签名刷新 |
| [17-phase-b-platform-io.md](17-phase-b-platform-io.md) | Phase B 第一步：平台 fs 后端适配器；已切生产 composition |
| [18-phase-c-unit-kernel.md](18-phase-c-unit-kernel.md) | Phase C 第一步：UnitKernel 接管 WriteKernel，prepare/commitPrepared |
| [19-c1-recovery-fallback.md](19-c1-recovery-fallback.md) | C1/P1-1：merge 恢复分支 B 的 rollback 兜底 |
| [20-c3-owner-liveness.md](20-c3-owner-liveness.md) | C3/P1-3：cross-face owner 判据统一 hasOwner |
| [21-c2-staging-generation.md](21-c2-staging-generation.md) | C2/P1-2：authoring 前清 merged，关闭行统一 dropStage |
| [22-b1-list-catalog.md](22-b1-list-catalog.md) | B1/P1-3+P1-5：list 名字可见、strict 空 catalog 放行首个 create |
| [23-p1-curator-restore-pause.md](23-p1-curator-restore-pause.md) | 03/P1-2：restoreSnapshot 保留并发 pause |
| [24-b1-summary.md](24-b1-summary.md) | B1/P1-4：模型 summary 进入 history/audit |
| [25-a3-a5-recovery-compensation.md](25-a3-a5-recovery-compensation.md) | A3/A5：恢复失败可见、补偿全量执行 |
| [26-a4-repair-takeover.md](26-a4-repair-takeover.md) | A4：repair 复用平台 takeover claim |
| [27-e4-family-config.md](27-e4-family-config.md) | E4：CI 单元套件加载 family config |
| [28-e1-overlay-identity.md](28-e1-overlay-identity.md) | E1：本地门禁解析当前构建线 |
| [29-f3-f4-retry.md](29-f3-f4-retry.md) | F3/F4：刷新失败提示、延迟读失败可重试 |
| [30-a7-review-debt.md](30-a7-review-debt.md) | A7：review aux 调度成功才结账 |
| [31-b12-structural-anchor.md](31-b12-structural-anchor.md) | B1-2 部分：结构写入输入树绑定 + delete 预览 |
| [32-e6-remove-skips.md](32-e6-remove-skips.md) | E6：删除永久跳过测试 |
| [33-e5-test-lines.md](33-e5-test-lines.md) | E5：平台耦合账本可判据化 |
| [34-p2-dead-switch.md](34-p2-dead-switch.md) | P2：删除 manifest 新鲜度死开关 |
| [35-e2-real-gates.md](35-e2-real-gates.md) | E2：四条 architecture 门禁真实执行 |
| [36-p2-platform-types.md](36-p2-platform-types.md) | P2：sendMessage/configEditor 类型对齐 |
| [37-p2-acceptance-read.md](37-p2-acceptance-read.md) | P2：验收夹具读失败不当空 |
| [38-a2-executed-marker.md](38-a2-executed-marker.md) | A2：审批/状态/ sidecar 跨进程 |
| [39-d2-contract-strict.md](39-d2-contract-strict.md) | D2：平台契约 strict 对准 rc.5 |
| [40-p2-tool-register.md](40-p2-tool-register.md) | P2：工具注册缺失可见 |
| [41-e7-falsifiability.md](41-e7-falsifiability.md) | E7：falsifiability-carrier 清零 |
| [42-p2-merge-decision-route.md](42-p2-merge-decision-route.md) | P2：merge decision 路由单源 |
| [43-p2-ledger-orphans.md](43-p2-ledger-orphans.md) | P2：mutation ledger 拒绝孤儿 |
| [44-bundle-roster-platform.md](44-bundle-roster-platform.md) | Phase B/P2：生产 bundle 用 io-platform + 本地门禁 61 pass |
| [45-p2-docs-truth.md](45-p2-docs-truth.md) | P2：文档声明与当前门禁对齐 |
| [46-full-suite-truth.md](46-full-suite-truth.md) | E3/E4/测试环境：全量套件真绿 |
| [47-p2-client-tokens.md](47-p2-client-tokens.md) | P2：客户端 token 补齐、去掉写死 fallback |
| [48-p2-client-seats.md](48-p2-client-seats.md) | P2：client-seat 几何门禁跟随真实注册 |
| [49-p2-configforms-shape.md](49-p2-configforms-shape.md) | P2：configForms 删手抄字段 |
| [50-p2-workspace-id.md](50-p2-workspace-id.md) | P2：panel workspace id 走平台真服务 |
| [51-p2-hidden-merge.md](51-p2-hidden-merge.md) | P2：非活动 merge 视图不启动 + 不挂 focus |
| [52-p2-loadmore.md](52-p2-loadmore.md) | P2：load-more 失败保留行/游标 |
| [53-p2-read-tickets.md](53-p2-read-tickets.md) | P2：history 读 ticket 按 kind 分开 |
| [54-p2-dead-ui-contract.md](54-p2-dead-ui-contract.md) | P2：删除 client-kit/history 死契约与假 face |
| [55-p2-local-require.md](55-p2-local-require.md) | P2：client require 改 bundle 局部绑定 |
| [56-p2-merge-view-ledger.md](56-p2-merge-view-ledger.md) | P2：merge tab 响应式 + 计数共享解析 |
| [57-p2-status.md](57-p2-status.md) | P2：07 域处置状态总表 |
| [58-p2-resolver-deps.md](58-p2-resolver-deps.md) | P2：删除 dsh.resolverDependencies |
| [59-d11-dead-validator.md](59-d11-dead-validator.md) | D11：删除无调用 baseline 验证器 |
| [60-d12-test-reachin.md](60-d12-test-reachin.md) | D12：测试跨包 reach-in 改走包导出 |
| [61-final-suite-align.md](61-final-suite-align.md) | S4 用例归位 + U5 适配 P2-3 |
| [62-independent-review-1.md](62-independent-review-1.md) | 独立复核第一轮：A2/E4/E3 三条 P1 |
| [63-review-closure.md](63-review-closure.md) | 独立复核第二轮：P1 关闭 + 残余 P2 |
| [64-preset-retired.md](64-preset-retired.md) | Phase F：退役 evolution-preset 活表面 |
| [65-ci-lane.md](65-ci-lane.md) | E4：真实 CI 形态全量套件计时 |
| [66-state-absorbed.md](66-state-absorbed.md) | Phase F：进化状态包吸收进 core |
| [67-state-p2-cleanup.md](67-state-p2-cleanup.md) | state 吸收后的 P2 死引用清理 |
| [68-npm-scope.md](68-npm-scope.md) | 发布 scope：@lmzhen |
| [69-review-p2-a2-e3.md](69-review-p2-a2-e3.md) | 复核残余 P2：A2 双 reload、E3 结构化 traceability |
| [70-contract-merged.md](70-contract-merged.md) | Phase F：platform-contract 并入 adapter |
| [71-platform-renamed.md](71-platform-renamed.md) | Phase F：adapter 改名 evolution-platform |
