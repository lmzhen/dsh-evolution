# 插件系统框架：从第一性原理到可验证实现

对象：`D:\dsh\dsh-evolution-mirror` @ `564431ac`。
本文件不是第二份问题清单；它把 [README.md](README.md) 的 1 个 P0、28 个 P1、约 117 条 P2 统一到一套可判定的系统模型。问题明细仍以 8 份分报告为准。

## 1. 第一性原理：这个系统到底是什么

DSH evolution 家族不是“一堆功能插件”，而是一个**会修改持久事实的分布式控制系统**：

- 被控对象：技能树、记忆、合并状态、审查状态、活动账本。
- 传感器：读取、观察（observation）、平台事件、状态快照、测试/证据。
- 控制器：tool gate、approval、curator、review、merge 状态机。
- 执行器：单一写入 provider、MutationUnit、平台文件/存储/LLM 接口。
- 反馈：审计、事件、目录失效、doctor、UI、门禁与发布证据。

因此它的正确性不能只定义为“函数返回值对”。正确性必须同时满足**事实、授权、提交、恢复、边界、证据**六个维度。由此得到本系统的第一性不变量。

## 2. 八条系统不变量

| ID | 不变量 | 一句话判据 | 违反后的系统症状 |
|---|---|---|---|
| I1 | **单一事实源** | 每个持久事实只有一个 owner 和一个规范表示；缓存/进程内存只能是由事实派生的 projection | 双读、幽灵行、last-writer-wins、跨进程看不到已提交状态 |
| I2 | **单一写权威** | 每个变更只有一个权威入口、一个事务边界、一个 commit 点；prepare 不得产生持久副作用 | 双写、幻影审计、半写、回滚不完整 |
| I3 | **先观测后变更** | 变更必须携带当前、owner-scoped、未被失败污染的前置观察；未知/失败/失联不得当成功 | 盲写、越权写、用旧版本覆盖新内容 |
| I4 | **因果顺序** | 状态转移、字节落盘、审计/事件、恢复记录必须按协议排序；失败必须补偿或可 settle | 已写未记、已记未写、半合并、撤销无门 |
| I5 | **可恢复/可归责** | 每个跨步骤变更都有 prepared/settled 事实和唯一恢复路径；失败不能静默消失 | 崩溃后卡死、补偿只做一半、无人知道要修什么 |
| I6 | **契约生成而非复述** | 外部边界（平台 API、路由、payload、UI 快照）从权威类型/单一源派生，不手抄平台形状 | 平台升级后静默失效、类型谎言、404/空字段 |
| I7 | **验证绑定事实** | 验证必须绑定实际产物/实际树/实际执行；一个门禁必须是可执行的 falsifier，不是声明 | 旧证据放行新版本、旧树判定、永久 skip、报告-only 假绿 |
| I8 | **资源与生命周期闭合** | 每个状态/通道/包/字段都有创建—使用—回收—退役的生命周期；有界资源必须有界回收 | 磁盘泄漏、通道泄漏、轮询浪费、死包/死字段长期滞留 |

**P0/P1 的判据由此而来**：破坏 I3 且能绕过安全门禁 → 高严重度；破坏 I1/I2/I4 且不可恢复 → 高严重度；只破坏 I8 或可读性 → P2。

## 3. 系统平面模型

把仓库按“控制回路中的位置”分成 7 个平面。每个平面只有一个首要问题和一个权威 owner；跨平面的直接写入都视为越界。

| 平面 | 首要问题 | 权威 owner | 主要不变量 | 对应发现 |
|---|---|---|---|---|
| **P0 平台面** | 平台提供了什么真实契约？ | `harness-rc3` 源码/d.ts | I6 | B5、D1、D2、UI 合约 |
| **P1 接缝面** | 家族如何把平台能力变成可组合 port？ | `evolution-platform-contract` + `evolution-adapter` | I6 | 05 全部、B5、D1 |
| **P2 状态面** | 现在什么是真的？ | state store / provider | I1、I8 | A2、A6、C3、retention |
| **P3 变更面** | 谁可以改变、何时改变、如何原子提交？ | 单一 write provider / `MutationUnit` | I2、I3、I4、I5 | P0-1、A1、A3-A5、C1/C2 |
| **P4 控制面** | 谁做决定、按什么顺序、失败如何回滚？ | approval / curator / review / merge 状态机 | I4、I5 | A7、B1、B4、C1-C3 |
| **P5 投影面** | 外部看到的状态是什么，是否新鲜/可信？ | host routes / tool render / UI client | I1、I7 | B2、B3、F1-F4 |
| **P6 保证面** | 我们凭什么相信它？ | tests / gates / release evidence | I7 | E1-E7、D2 |
| **P7 演化面** | 版本、包、schema、退役如何安全演进？ | build/release/registry | I8 | P2 债、06-D1-D14 |

> 说明：P0 平台面是“只读外部环境”，P1 接缝面是“翻译层”，P2-P5 是运行系统，P6 是元系统，P7 是时间维度。**任何问题都可以且只能落到一个主平面**；跨平面只允许经 port/契约。

## 4. 六类系统失效模式

所有 P0/P1/P2 归入六个失效模式。这比按包/按功能分组更接近根因，因为同一失效模式会跨多个包重复出现。

### M1 事实分叉（Truth divergence）

同一事实有多个 owner 或过期投影。

- 形态：进程内存当权威（A2）、整条 state 覆盖（A6）、projection 与 host 各算一份（F1-F3）、缓存不刷新（A2/C3）。
- 根因：I1 被违反；本地性能/交付压力把 cache 升级成 source of truth。
- 系统后果：不同平面看到不同世界；CAS 只能防字节冲突，防不了“两个世界各自合法”。

### M2 门禁失明（Authorization/observation failure）

系统把“未知/失败/默认”当成“已观测/已允许”。

- 形态：失败 skill 读取计成功（P0-1）、strictCrossSource 空视图当 unknown（B4）、确认默认值反转（F1）、settings 上限钩子失效（B5）、UI 未知值回退到宽松分支。
- 根因：I3 被违反；传感器返回值没有三态（present/absent/unknown），或调用约定漂移导致 sensor 根本没运行。
- 系统后果：控制器在有偏输入上做出“安全”决策；越权/盲写/越界配置。

### M3 提交与副作用失序（Commit/effect ordering）

字节提交、审计、事件、恢复记录不在同一因果顺序。

- 形态：A1 plan prepare 阶段写 audit/event；A7 先清债再调度；B3 summary 在 commit 前被丢弃；C1 半合并无 rollback；A3 恢复失败被吞；A5 补偿首错停止。
- 根因：I2/I4 被违反；副作用被写在 prepare 路径，或失败分支没有 settle。
- 系统后果：幻影记录、重复审计、半写、undo 无门、崩溃后永久卡死。

### M4 边界漂移（Contract/boundary drift）

手抄平台契约或跨包私有形状，平台/代码一边变化就静默失配。

- 形态：B5 cordis 4.1 调用约定、D1 LLM `aborted`、D2 旧平台锚点、UI 的 `configForms/workspace` 假字段、merge decision 字符串拼路由、`configEditor` 类型谎言、`sendMessage` 可选 vs 必填。
- 根因：I6 被违反；契约是“写出来的文档”，不是从类型/实现派生的可执行约束。
- 系统后果：类型系统看不见的运行时失效；升级即回归；接口误用只在端到端才暴露。

### M5 验证失真（Assurance failure）

门禁/测试/证据与它声称判定的对象脱钩。

- 形态：E1 本地旧树、E2 死门禁、E3 旧 spike 证据、E4 CI 不加载 family config、E5 全 pending 账本、E6 永久 skip、E7 report-only 元门禁、D2 旧锚点。
- 根因：I7 被违反；验证被当作“另一个可交付脚本”，而不是系统输出的一部分。
- 系统后果：**这是最危险的元失效**。它不直接损坏数据，但让 M1-M4 长期不可见；系统进入“绿着腐烂”的正反馈。

### M6 结构熵增（Structural entropy）

局部补丁与共享底座相互强化，复杂度单调增长。

- 形态：core 28k 行/112 文件、`SkillLibrary` 4,145 行、五个锁层/两套 CAS、重复状态机/路由表、退役包仍在门禁、巨型 `apply`、死 API。
- 根因：I8 与 I2 的边界没有制度；每个功能先加一条本地路径，最后系统没有“唯一第一性模型”。
- 系统后果：修改成本↑、回归面↑、新写路径漏锁/漏审计的概率↑；M1-M5 的发生率随规模上升。

## 5. 风险定级：用系统量纲，而不是“感觉”

定义：

```text
Risk = BlastRadius × Reachability × Undetectability
```

- **BlastRadius**：破坏的是单个投影、单条记录，还是安全门禁/不可恢复事实？
- **Reachability**：默认配置即可触发，还是需要双宿主/并发/特定设置？
- **Undetectability**：现有门禁/日志/UI 能否第一时间发现？

| 级别 | 判据 | 本审计例子 |
|---|---|---|
| P0 | 破坏 I3 安全门禁，或不可恢复的 I1/I2/I4；检测面缺失/可绕过 | P0-1 失败读取绕过 read gate |
| P1 | 有条件的功能/一致性/恢复失败；现有门禁不覆盖或只部分覆盖 | A1、A2、B1、B5、C1、D1、E1-E7、F1-F4 |
| P2 | 性能/资源/死面/复杂度/可维护性；无直接错误行为 | 巨型 core、五层锁、死包、UI 死字段 |

用该公式解释两个容易误判的条目：

- **07 原始 P0-1（确认默认反转）**：BlastRadius 低（多一次点击，无数据破坏）、Reachability 高（默认配置）、Undetectability 低（用户可见），所以本框架定 **P1**，不是 P0。
- **02 原始 P1-1（失败读绕过门禁）**：BlastRadius 高（安全门禁/可能覆盖未读内容）、Reachability 中（需要一次失败读取）、Undetectability 高（门禁本应发现却放行），所以升 **P0**。

## 6. 系统动力学：为什么会变成现在这样

### 6.1 四个反馈回路

1. **假绿正反馈（Assurance erosion）**
   `旧树/旧证据/报告-only 门禁 → 绿 → 放行变更 → 更多未验证变更 → 门禁更不敢严格`。
   这是 E1-E7 的共同动力学：不是单点 bug，而是验证回路失去负反馈。

2. **本地补丁正反馈（Shifting the burden）**
   `共享底座耦合 → 新功能不想动 core → 加本地锁/本地状态/本地路由 → 重复 owner → 更不敢动 core`。
   这是五层锁、重复状态机、core 上帝包的来源。

3. **失败静默正反馈（Fixes that fail）**
   `失败不 settle/不报警 → 手工绕过 → 恢复路径无人维护 → 下次失败更不可恢复`。
   A3/A5/C1 与“恢复失败被吞”属于这一类。

4. **投影分叉正反馈（Eroding goals）**
   `UI 默认值/字段先手抄 → 平台/实现变化 → 显示与行为不一致 → 用户改设置/刷新绕过 → 捕获时机问题更隐蔽`。
   F1-F4 与 UI 合约手抄属于这一类。

### 6.2 三个系统原型

- **Shifting the Burden**：core barrel/本地 patch 替代真正的边界设计。
- **Success to the Successful**：所有共享面被迫进 core；core 越成功，边界越难拆。
- **Tragedy of the Commons**：共享 core/barrel/公共测试线被无限占用，没有配额与退役制度。

系统科学结论：**先修负反馈（验证/恢复/投影），再修正反馈的局部症状**；否则修完一个 P1，下一轮又会产生同类。

## 7. 系统工程视角：V 模型上的断点

| V 阶段 | 系统问题 | 本次发现 |
|---|---|---|
| 需求/默认值 | 文档默认值与代码行为不一致；三态语义未定义 | F1、B4、B5 |
| 架构/接口 | 平台契约手抄；包边界与 port 双源；锁/状态 owner 不唯一 | M3/M4/M6 |
| 实现 | prepare 有副作用；失败路径不 settle；跨进程状态无 fence | P0-1、A1-A5、A7、C1-C3 |
| 集成 | 多平面各自计算同一事实；UI 与 host 各自解析路由/payload | A2、B2/B3、F1-F4、merge decision |
| 验证 | 旧树/旧证据/永久 skip/报告-only；档位策略不执行 | E1-E7、D2 |
| 运维/恢复 | 无单 unit recovery；无 retention；无跨面 owner 判据 | C1-C3、P2 债 |
| 演化/发布 | 退役包仍活；版本/证据未绑定 | P2-D9/D11、E3 |

**V 模型结论**：当前系统不是“实现错了几个函数”，而是 **V 的右半边（验证/运维/演化）没有和左半边（需求/架构/实现）形成闭环**。只修左半边会产生更多未验证代码；只修右半边会把错误实现固化。

## 8. 目标参考架构：一个内核，七个接缝

不是立即重构，而是给出判据：任何新代码若破坏下列结构，就是新的技术债。

```text
Platform (harness)
   │  contracts derived from platform types
   ▼
Port Registry (adapter)
   │  one capability table, one port per service
   ▼
Mutation Kernel
   │  observe -> authorize -> prepare -> commit -> audit -> settle
   │  (prepare: no durable side effects)
   ▼
Fact Store / State Providers
   │  one owner per fact, explicit process scope, version/CAS
   ▼
Control Plane (approval / curator / review / merge)
   │  decisions are plans; execution is one unit; every failure settles
   ▼
Projection Plane (tools / commands / UI)
   │  host snapshot + freshness/failure; UI subscribes, no hand parsing
   ▼
Assurance Plane
   │  tests/gates/evidence bound to actual tree + artifact + commit
   ▼
Evolution Plane
      versioned packages, expiring exemptions, retention, retirement
```

### 8.1 内核的七个最小接口

1. `FactStore.read/commit(fact, expected, next, owner)`：一个 fact 一个 owner；cache 只能标注派生。
2. `Observation.authorize(owner, target, intent)`：present/absent/unknown 三态，unknown 永不等于 allow。
3. `MutationKernel.prepare(plan)`：锁内读、校验、CAS 预检，**零持久副作用**。
4. `MutationKernel.commit(preparedOps)`：一个事务边界；审计/事件只在 commit 后写。
5. `Recovery.settle(unit)`：finalize → rollForward → rollback 的有序尝试；失败必须产生可查询报告。
6. `PortRegistry`：从平台类型/平台定义派生；能力表单一 owner。
7. `Assurance`：每个门禁有 falsifier，证据绑定产物哈希/commit/实际执行树。

### 8.2 判断一条新代码是否“系统上正确”的六问

1. 它写的是哪个 fact？这个 fact 的 owner 是谁？
2. 它有没有在 prepare 阶段产生任何持久副作用？
3. 它的前置观察三态如何表达？失败/未知会不会被当成成功？
4. 它失败后由谁 settle？有没有可执行的恢复路径？
5. 它跨的平台/客户端边界，形状是从权威类型派生的，还是手抄的？
6. 它的验证能不能在旧树/旧证据/旧版本上变红？

六问中任何一个答不上来，不应进入实现。

## 9. 全量问题的框架映射

### 9.1 P0/P1 主平面

| 平面 | 发现 ID | 系统含义 |
|---|---|---|
| P3 变更面 | P0-1、A1、A3、A4、A5 | 门禁、prepare/commit、锁 repair、补偿 |
| P2 状态面 | A2、A6 | 跨进程事实、state 覆盖 |
| P4 控制面 | A7、B1、B4、C1、C2、C3 | 调度/审批/merge 状态机 |
| P1 接缝面 | B5、D1、D2 | 平台调用约定、LLM 终态、平台契约验证 |
| P5 投影面 | B2、B3、F1、F2、F3、F4 | tool 输出、UI 默认/刷新/重试 |
| P6 保证面 | E1、E2、E3、E4、E5、E6、E7 | 本地/CI/证据/账本/元门禁 |

计数核对：P3 5 + P2 2 + P4 6 + P1 3 + P5 6 + P6 7 = 29 个 P0/P1 条目（去重前）；与总表 1 P0 + 28 P1 一致。

### 9.2 P2/技术债的六个结构类

| 结构类 | 典型证据 | 系统含义 |
|---|---|---|
| S1 复杂度 | core 28k/112 文件、`SkillLibrary` 4,145 行、83 个 ≥100 行函数 | M6：认知/变更成本 |
| S2 重复 owner | 五层锁、两套 CAS、scan/round2 两套状态机、两份 PendingRow、三处 port 枚举 | M1/M6：事实与决定多源 |
| S3 死面/退役 | evolution-preset、resolverDependencies、agent.cordis.yml、dead validators、5 个 arch 死键 | I8：演化面未闭合 |
| S4 验证债 | synthetic gates、pending 账本、永久 skip、report-only 元门禁、旧基线 | M5：负反馈失效 |
| S5 投影债 | UI 假字段、假 token、假 scope、隐藏视图轮询、手写路由 | M1/I7：对外事实不纯 |
| S6 文档/生命周期债 | architecture.md 停在 0.49/36 包、README 仍称门禁未跑 | I8：知识面与代码脱节 |

## 10. 修复顺序的系统依据

不按“包”排，而按**恢复负反馈的顺序**排：

1. **先修传感器与门禁**：P0-1、B5、F1/F2。没有可信的观测/默认值，后面的控制器全是空转。
2. **再修提交协议**：A1、A3-A5、B1、B3。让“写—记—恢复”同源，避免继续制造幻影事实。
3. **再修状态与恢复**：A2、A6、C1-C3。让系统在并发/崩溃后能 settle。
4. **再修投影与体验**：F3/F4、B2、UI 契约；此时数据已可信，修显示才有意义。
5. **同步修保证面**：E1-E7；但 E3（发布证据）必须在下一版发布前完成，不能等行为全修完。
6. **最后做结构拆分**：core/UI/门禁分层；先有正确内核，再拆，避免在错误边界上做机械拆分。

详细任务见 [09-remediation-plan.md](09-remediation-plan.md)。

## 11. 这套框架的边界

- 它整合的是本次审计的**代码事实**，不是产品市场判断；UI 的 P0→P1 重判按“无数据破坏”口径，若按品牌/信任口径可保持 P0。
- P2 的“约 117”是报告原始计数，未逐条去重；框架只把它们归入六个结构类，不声称每一条都已独立复核。
- 04 的 C2/C3、部分 A2 触发条件标 `likely`；框架保留这种不确定性，不把推断写成事实。
- 目标参考架构是判据，不是本轮实施计划；任何重构仍需 DCR/版本/发布门。

## 12. 一句话结论

**当前系统的主要矛盾不是“某个功能有 bug”，而是“事实、写权威、恢复与验证没有形成同一个闭环”；P0-1 是闭环断裂的安全症状，E1-E7 是闭环断裂的元症状，core/五层锁/重复状态机是闭环断裂的结构后果。** 先恢复闭环，再减少结构熵，才是系统级解法。
