# 剩余结构项逐项判断与取舍（DCR-3 草案）

目标源：`11-target-architecture.md`。当前事实：20 包、P0/P1=0、全量 442/2430 绿、local gates 61/0/3、20 包 dev pack + publish dry-run 通过。

判断标准不是“目标文档写了就必须做”，而是三条同时成立：

1. 是否直接对应九不变量中的一条（正确性/可恢复性，而不仅是整洁）；
2. 是否已有真实失败面，或不做会在可预见版本内形成第二个事实源/第二套状态机；
3. 改动是否能在当前发布窗口内显式迁移、可回退、可负例验证。

## 逐项

| # | 结构项 | 长期价值 | 当前失败面 | 成本/风险 | 结论 |
|---|---|---|---|---|---|
| D1 | StateStore 取代 domain-cache authority | **高**：单一事实源、跨进程 claim 正确性 | 已有跨进程 reload/lease 修复；剩余是进程内 domain 缓存与 StateStore 形状不统一 | 高：状态 schema、旧数据迁移、所有 pending/review/curator/activity 读者 | **做**，作为下一主项；先设计迁移与回退，再动代码 |
| D2 | MutationUnit 旧 journal/补偿并入 UnitKernel | **高**：唯一多文件事务入口、recoverability | 当前 MutationUnit 已把单目标写交给 UnitKernel；journal 仍承担崩溃恢复。直接删会让恢复能力倒退 | 高：merge/curator/skill 写全路径、崩溃注入八点、旧 journal 只读迁移 | **做**，但排在 D1 后；先证明 UnitKernel 证据恢复与旧 journal 等价，再删分支 |
| D3 | contract 手工镜像 → 生成 ports | **高**：契约双源/漂移 | 已有 `verify-platform-contract` 的 imported-symbol 检查，但 19 个 contract 文件仍是手写 | 中高：生成器需要平台类型映射，不能只靠 d.ts 猜语义 | **做窄版**：先生成“平台符号/形状对账清单”并纳入 gate；完整 `ports.generated.ts` 在设计确认后再替换 |
| D4 | UI host/client 物理拆成 `evolution-web` | 中：包边界/体积 | 当前 `evolution-ui` 已有 `.`（host）与 `./client` 两个入口，运行时已分离；只差 npm 包物理拆分 | 高：8 个客户端 spec、bundle row、locale、发布闭包 | **不做**：没有运行时失败面，纯打包边界；等 D3 后若包体/发布需要再拆 |
| D5 | 按目标把 20 包压到约 10（lifecycle/web/skills 合并） | 低：文档明确“包数不是目标” | 各包目前基本一种变化原因；合并会引入 god package | 高：跨 4-5 组 import/row/test | **不做**：不为数字合并；只在机制真的合并时顺带收包 |
| D6 | 删除 `evolution-agent` 的 `agent.cordis.yml`/`bases.json` legacy fixture | 低-中：目标要求不随包发布 | 它是 `/evolution preset install` 的用户功能资产；删除是用户可感功能移除 | 中：需先决定 preset install 是否退役 | **不做（当前）**：保留功能；等 preset install 退役决策与用户确认 |
| D7 | merge 两套状态机合并 | 中：状态机重复 | 代码已有 `recordRound2Outcome` 单一结果记录；未找到当前行为分歧的失败证据 | 中高：merge/undo/recovery 全链 | **暂不做**：先补一个“两路 outcome 对账”负例；有失败证据再做 |
| D8 | 拆 `SkillLibrary` 4k 上帝类 | 中：可维护性 | 没有正确性失败面；拆分是纯结构 | 高：skill-store 全路径、测试面大 | **DEFER**：发布后再拆；触发条件=下一次 skill 写改动需要跨 3 个以上职责 |
| D9 | 删除 `io-node`/`EvolutionIoLike`/HomeFS 收敛 | 中高：唯一文件边界 | 生产 bundle 走平台 io；io-node 仍是本地默认/测试默认 | 高：默认值、测试、standalone | **DEFER**：排在 D1/D2 后；先改默认注入，再删导出 |
| D10 | 包数/历史文档数字对齐 | 低 | 无 | 低 | **做小步**：只做当前文档/清单，不追历史 |

## 选择

**现在做：D1 → D2 → D3（窄版）**。

**现在不做：D4、D5、D6、D7、D8、D9**，各自登记触发条件；D10 随文档批次做。

这不是放弃目标，而是按“先消除第二事实源，再做纯结构搬迁”排序：D1/D2 直接对应单一事实源/唯一事务入口；D3 直接对应契约不双源。D4/D5/D8 是边界/可维护性收益，当前没有失败面，先不做；D6 涉及用户功能；D7 没有失败证据；D9 依赖 D1/D2。

## DCR 状态

本文件是 **DCR-3 草案**：将 D4-D9 的目标完成时点从“本 goal 发布前”改为“发布后按触发条件”，D1-D3 保留在发布前。需要用户确认后，才把该范围变更写入 11-target 的 supersede 记录。
