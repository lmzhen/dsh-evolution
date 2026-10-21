---
name: dsh-evolution-maintenance
description: 维护家族插件：发布/CI、客户端、门禁、审计与复核报告、参数、宿主重启。
---

# dsh-evolution 项目维护

`@lmzhen/dsh-evolution-*`：把 Hermes 自进化核心（记忆/技能/审查/策展）移植到 DeepSeek Harness 的插件家族。**单线开发在镜像**（改码/提交/打 tag 全在镜像；扁平布局）。`D:\dsh\deepseek-harness\packages\evolution\` 是**更早的上游线**（不含家族代码，同路径文件与镜像不同）——不在其中改码，也不让 `publish-chain` 跑 step 1（它会 robocopy 该树覆盖镜像）。**新版本用 `--no-sync`**（跳过 step 1，仍做 normalize＋版本守卫＋commit/tag/push）；**`--resume` 只用于"远端 tag 已存在"的续跑**——它会先校验 tag→commit 等于本机 HEAD，新版本用它会直接以 `tag v<ver> not found remotely — nothing to resume` 退出。判断口径：tag 已推过 ⇒ `--resume`；还没推 ⇒ `--no-sync`。发布仓库是 `github.com/lmzhen/dsh-evolution`（扁平布局，本地克隆 `D:\dsh\dsh-evolution-mirror`）。原版 Hermes 参考在 `D:\claw\hermes-agent`。

> 详见 references/governance-discipline.md
> P1 的三张成本账（E4/E16/E12/E15）与家族测试床唯一入口：references/p1-ledgers-and-testbed-entry.md
> 功能域地图（对外解释／专利取点／域内论文筛选先读）：references/functional-domain-map.md
> 评审通道的平台事实（llm.complete 参数面/消息形状/前缀缓存实测/钩子取参）：references/review-channel-platform-facts.md
> 本节引用：references/client-plugin-ui-seams.md · references/dispatch-vocabulary-and-cadence.md · references/docs-refresh.md · references/gate-rules-and-client-test-lane.md · references/growth-invariance-and-read-counts.md · references/hermes-upstream-comparison.md · references/live-acceptance-playbook.md · references/live-host-health-check.md · references/new-package-and-row-registration.md · references/platform-report-v44.md · references/plugin-extension-seams.md · references/rc4-release-runbook.md …
## 长任务的推进纪律（用户口径，逐项适用）

- **每一项按固定顺序**：①读全部相关文档 ②定性分析 ③读全部相关代码与引用 ④基于全部上下文做具体设计 ⑤最后才改码。跳步＝返工；涉及底层/多面/动结构的大改**必须先完整设计，禁单步最小落地**。
- **专家顾问模式**：拿不准就按领域点名队友；**专家只给建议、不得改码**；**每完成一步就向专家同步「已完成步骤 ＋ 当前代码基准」**，并要求他们**以当下插件存在的代码为基准**，不引用被替换的旧结论。
- **撤回而不硬撑**：一个读数在排除两条假设后仍解释不通 ⇒ 恢复现场（保持树绿）、把「读数 ＋ 已排除的假设 ＋ 具体 file:line」发给领域席，等判据再一次做完，不盲试。
- **通道受限时"先试替代、不行就略过"**（用户口径）：常驻团队会占满子会话额度（`subagent limit reached (active child limit: 8)`）⇒ 先试**不经过团队**的通道：`dsh.cmd --profile <name>` 可引导，但已装 profile 只有 `desktop`（**Electron 独占**，CLI 引导直接报错）与 `web`（**只提供服务，无 prompt 入口**）⇒ 当前机器**没有 CLI 一次性会话通道**；自建 profile（`--from-default-profile`）属更大改动，不擅自做。**不行就把该步记为"待外部执行"并继续别的工作**，不要原地重试。
- **持久化字段要读写双折**：给版本/记录加字段时，**写入端的条目字面量**与**读端的字段折叠对象**都要带上 —— 读端漏折的字段会在**下一次写**时永久丢掉（实测：`unitId` 写进了索引、`listVersions` 读不到，补上读端折叠才通）。
- **同一字段要覆盖所有写入点**：一个索引/记录若有**多条铸造分支**（after 条目、baseline 条目、removal 条目…），新字段必须**逐条**带上 —— 漏一处，同组条目会在"按组剪枝"时被**拆成相邻段**（实测：只标 after 条目 ⇒ 剪枝把同单元拆开，读数退化成"只剩一条"）。
- **剪枝会影响铸造**：预算变小 ⇒ 前一次写的剪枝可能删掉 predecessor ⇒ 后一次写在"predecessor 未记录"分支**多铸一条条目** ⇒ 同一场景在预算大/小时新增条数不同 ⇒ **不要断言总条数**，只断言"每个写过的路径至少一条 after 条目 ＋ 同组条目共享组键"。
- **缺陷先钉住再修**：把"今天必红"的验收判据写成 `it.fails(…)`，套件保持全绿同时把缺陷钉在代码里；修好后**翻成 `it(…)`** —— 翻牌动作本身就是"已修"的证据。
- **编辑现场纪律**：整文件写前断言「读到字符数 == 文件字节数」；`edit` 报 `file changed` / `file no longer exists` ⇒ 先 `read` 一小段重建观察再改，删除过的路径改用新文件名或经 shell 重建（不要整文件回写大文件）。
- **模型行为类因果实验**（判"模型会不会跟技能指针/用目录条目"）的方法与实测读数：references/model-behavior-experiments.md；单元化版本与 G3a 的现场事实：references/unit-versioning-and-g3a.md。

## 给有门禁的仓库加模块：三处必须同步（2026-10-16，hermes-claw 实测）

**症状 → 机制 → 修法 → 验证**：新增一个源文件后 `npm run doc:check` 立刻变红，报『IMPL 体积基线 = 实测』的四个数全部错位。

1. **机制**：门禁里的『体积基线』组会**机械重算** `plugin/**` 与 `plugin/src` 的**文件数、总行数**（行数按源文件换行符计数），并与手册头部那句基线逐一比对 ⇒ 任何增删文件都会红。
   **修法**：改手册头部基线句（四个数字一起改），**不要**去改门禁。同一轮还要把新模块补进模块地图（§2.1），否则文件数与地图条目对不上。
2. **别越界**：模块地图与『单一所有者表』**不受门禁覆盖**（权威面只有 manifest / config-fields / features / hooks / constants / commands）⇒ 它们靠人维护，但**收尾条件要求文档与代码一致**，所以仍要手工同步。
3. **顺序**：先跑门禁看**差值**（它会把文档 X vs 实测 Y 四个数一次列全），再改基线，再一次跑到 32/32。
   **验证判据**：`typecheck=0` ∧ `verify` 全绿 ∧ `doc:check` 该组通过——三条同时成立才算这一步完成。

**工具纪律（同一仓库）**：①**复用既有工具而非自造**——`sha16` 来自 `util.ts`，被四处共用，新模块直接 import；②**常量只落 `constants.ts`**（仓库明文规定：不可配置常量的唯一真源）⇒ 在别处再写一个同义常量＝制造二份真相，本轮就被自己的断言抓到过一次。

**`verify.mjs` 的块作用域坑**：它的断言块是 `{ … }` 独立块，模块顶层 `const { readFileSync } = await import(…)` **不进入块作用域**；块内要用就在块内重新 `await import`，且换名避免与顶层同名冲突（本轮报 `ReferenceError: readFileSync is not defined` 即此）。

## 拟合之前先做「三点能否被一条直线解释」的检验（2026-10-16）

**症状**：把三个实测点写成一个过原点的比值（`y = x / k`），断言立刻用实测打回，三点分别差 1、1、3 块。

**机制与判据**：先**反解**——对每一点算它要求的斜率与截距；若**任意两对点解出的 (a,b) 明显不同**，则单一直线根本不成立（离散化取整会把误差放大到无法被一个斜率吸收）。此时写公式就是**伪拟合**，比承认只有三个锚点更糟。

**修法**：改成**实测锚点表 + 相邻线性插值 + 锚点外夹取**，并在注释里写明「锚点之间是插值、锚点之外是外推，精度 = 最小锚点间距」。
**验证**：断言里让**每个锚点逐点复现**（锚点值必须原样算出），另加一条「锚点之外夹取」的断言防止它偷偷外推。


## 计数器清零的边界：把"进入下游"与"完成"分开（2026-10-16）

**症状**：流水线式功能（到点 → 产出 → 等下游消费）里，若把"清零"绑在下游**消费完成**上，下游**一直不消费**就会让计数器永不清零 ⇒ 触发器每轮重跑、产出无限堆积。

**机制**：一次运行其实有两个可判定的阶段——『**这次运行本身成功了没有**』与『**这次运行占用的周期用掉了没有**』。绑成同一个边界，两者就只能同生共死。

**修法（两级边界，各自可观测）**：
- **健康级**以『产出通过校验』为界（通道还能用吗）；
- **节律级**以『产出进入下游队列』为界（周期用掉了吗）；
- 下游**未消费＝待决状态，不是失败**——它既不加失败计数，也不阻塞节律；
- **零产出但校验通过**必须是**独立的第三种状态**（『跑了但没产出』），与『校验失败』和『压根没跑』三者**各自可观测**，否则遥测里分不清是模型不说话还是通道没工作。
**验证**：断言里为**每个边界各写一条**（推进 / 不推进 / 第三种状态），并额外断言"失败不改游标"——只测成功路径等于没测这套设计。

**落点纪律**：让清零**在结构上只有一个写口**（例如只有 `finishReview` 能推进游标），这样"清零必须在确认有效之后"是代码结构保证的，而不是靠调用方自觉。


## 跨文件迁移/删除的纪律：先删后补，让编译器枚举（2026-10-16 实测）

**症状**：把一个通道/框架的脚手架整体换掉时，凭记忆列依赖点必然漏项。

1. **先删后补**：把要删的整段一次删掉，跑 `typecheck`/`verify`，**让编译器与门禁枚举出真实依赖点**，以此为准而非凭记忆。本轮靠它一次定位了 4 条硬编码钩子清单门禁（数量、expectedHooks、能力矩阵行、文档口径）。
2. **删除会暴露「存在理由已消失」的代码**：判断某函数是否该迁走，先问**它为什么存在**。本轮两个大函数（37 行的『替无工具 worker 采集事实』、以及派发失败兜底）都是**旧通道特有**的——换通道后它们的**存在前提消失**，正确处置是删除，**不是搬过去再为新通道造等价兜底**（那就是补丁嵌套）。
3. **改名不等于改行为**：若某个 API 把两种行为绑在一个名字下（如「判定并消费」伪装成 getter），**只拆命名、不改行为**，并给旧名留**薄别名**指向新名——既有测试与调用点逐字不动（`verify` 既有断言全绿即证据）。绝不复制第二份实现。
4. **删掉的边界断言要「重述」而不是「删除」**：一条断言往往同时编码了（可能已废弃的）设计与（仍然成立的）不变量。旧设计死了，就把断言**移到不变量现在所在的那一侧**——本轮 3 条断言因此变成『校验迁移本身』的断言。删掉它们等于静默失去那条不变量。
5. **断言检查「某名字不存在」时必须先剥注释**：注释里提到该名字会让「不存在」检查**假红**，或让「存在」检查**假绿**。写一个剥注释小工具（块注释＋行注释）再匹配，并把它用在所有源码级存在性断言上。
6. **说「某符号无人调用」之前必须搜全仓**：本轮两次断言『reset*Counter 无人调用』『某函数只在待删代码里被调用』，两次都被 grep 立刻打回。**这类断言很廉价，但错一次就会带着错误前提设计一整轮。**
7. **删除后必须回头审计「推断面」而非只审计「调用面」**：删掉一个生产调用方，可能让一条**来源/身份推断**永久失效——而推断失败常常**静默降级到最高权限**。本轮实录：删掉旧通道的会话登记后，`origin` 的两条推断路都不通，评审驱动的写入会落成 `origin: user`（权限最高，且被当成用户当轮要求、跳过管理标记与生命周期），我此前为它加的权限守卫**永不触发**。
   判据：`resolve*` / `is*` 这类**推断函数**的每一条返回分支，都要问『**现在还有谁能让它成立**』；删调用方之后必须重问一遍。
   根治方向：**来源是产出的属性，不是下游要猜的**——由**制造该产出的模块**显式带上（仓库已有 `hermesOrigin` 这类显式通道时优先复用，不要新造机制）。顺手把『该由谁填这个字段』写成注释＋断言，因为下一个接线的人会照抄邻近的既有写法。
8. **往巨型检查文件里插断言前，先确认落在哪个块**：这类文件的断言常分散在多个大括号独立块里，顶层 `await import` 与块内变量**互不可见**。本轮把断言插进了错误的块，`ReferenceError` 被测试当场抓到——**同一个坑本轮第二次出现**（前一次是 `readFileSync`）。落笔前先查该块的导入面与作用域。
9. **量一条共享指标前，先钉死「参照物是谁」**（用户 2026-10-16 直接点出）：把「**上一轮同类运行**」当参照物是本轮踩过的实质错误——评审是主对话的分支，两次评审之间**本就该不同**，拿它们互比量到的是**分支点位移**，不是失效。
   ⇒ 判据：共享指标的参照物必须是**该次运行的源头**（这里是主对话），且两次读数必须取自**同一时刻、同一分叉点**；中间**不能夹任何我们自己发出的调用**（探针自己会把缓存喂热，污染第二个读数）。
   ⇒ 更隐蔽的一半：**期望值可能掩盖分歧**。本轮 `expectedHitTokens` 只按 system 段算，于是一个「只命中 system、对话部分早已分叉」的结果**看起来像近满命中**（9472/9600）。凡只看单一分量的期望值，都要问一句「它没覆盖的那部分，失败时会表现成什么」。

10. **同一症状的两条相反成因，先加一行诊断再动手**：『零产物』既可能是**模型判断为无需产出**（`status: completed`，回复合法但为空），也可能是**回复从未通过校验**（`status: failed`）。二者修法相反（调提示词 vs 调判据）。本轮加一行打印 `outcome` 即定案：`{status: completed, proposals: 0}` ⇒ 是判断，不是通道。**在改判据或改提示词之前，先花一行把这两者分开。**
11. **『下界当期望』会让指标永远为绿**（本轮自伤，先看这一条）：凡期望值只覆盖整体的一部分，它就会**把其余部分全灭的失败报成通过**。实例：缓存期望值只按 system 段算（9 600），于是『只命中 system、对话段零复用』读出来是 9 472/9 600 ⇒ 看着像近满命中，**掩盖了 32k 提示词里 22k 从未被复用**，让我连着几轮得出相反结论。
   ⇒ 判据：**期望值必须覆盖你要判的那个量**；做不到就**把分量拆开单独报**（本轮修法 = 报 floorTokens 与 conversationHitTokens 两个数，判定从 hit 拆成 reuse/floor）。
   ⇒ **名字也是防线**：叫它 `systemFloorTokens`（下界）而不是 `expectedHitTokens`（期望），下一个读者不会再用错。
   ⇒ 验证：**注入变异证明它能红**——把 floor 分支改回 reuse，3 条断言当场变红；改不红的断言多半没在测东西。

## 里程碑同步与两类"假红"（2026-10 立，用户点名要求）

- **同步节奏**：每到一个**关键节点**就向**全部席位**广播一次，固定五段 —— ①已完成步骤（按 G 组点名，带提交号）②当前代码基准（mirror HEAD／工作树／overlay 是否同步）③待裁定项（哪一席给什么判据）④纪律更新（本轮新立或复述的红线）⑤下一步。关键节点＝一个 G 组收口／一条判据由红转绿或由绿转红／出现需跨席裁定的设计问题／提交链新增 ≥3 个提交／**读出口径发生变化**。涉及某一席领域时**另发专项**（带 `file:line` 与读数），并要求其**以当下代码为基准**复核。
- **假红之一：用错测试入口**。家族 spec **只有唯一入口** `npx vitest run -c D:\dsh\_tools\vitest-family-preflight.mjs <spec>` —— 裸 `vitest run <spec>` 走根配置 ⇒ `root=MONO` ⇒ 挂**旧线** `schemastery 3.18.1`（无 `.volatile()`）⇒ 整套 import 崩，**看起来像环境坏了**。已写进该 preflight 文件头。
- **假红之二：整目录跑**。一次跑 `evolution-core/tests`（78 文件并行）会出现 6 处 **5s 超时**假红（durations 50–63s），而同一批文件**单独跑全绿** ⇒ **判红前先单独复跑**；复跑顺序：单文件 → 可疑的几个一起 → 才谈是不是自己的改动。
- **归因先 stash**：改完跑套件见到多处失败时，`git stash` 掉自己的改动再跑同样文件 ⇒ 立刻分清"我改坏的"与"既有的"（本会话两次实测：一次既有、一次纯属负载）。
- **提交前确认仓**：`git rev-parse --show-toplevel` 必须是**镜像**；`deepseek-harness` 是构建线/上游线（其 `packages/**` 未跟踪）⇒ **只读**，改动一律落镜像后同步（判定用哈希，不用 `git status`）。

## 成本账的两个口径（block vs markup）与"预测只作方向"

- 目录行成本有两个都可辩护的口径：**行 markup** ＝ `- ` ＋ 反引号 ＋ name ＋ 反引号 ＋ `: ` ＋ desc ＝ **name+desc+6**；**块口径**＝每行另含 1 个换行 ⇒ **+7**。**账本只允许一个口径**（成本类结论一律用**块**），并用**恒等式夹具**钉住：`块 − markup ≡ 目录行数`。
- **delta 不许只报一个总数**：同时打印 **Σname／Σdesc／每条明细** ⇒ 两侧对不上时能机械定位到哪一项（本会话就因只报总数而与席位的 378/384 互相怀疑，最后发现是我自己算错）。
- **预测只作方向，验收读数一律现场实算**（同一份数据、同一公式）；预测值入档时标注"预测"。
- **一份数据、两个都可辩护的判据 ⇒ 读数必须标注判据**：本会话同一套探针在两个口径下同时为真 —— **覆盖口径**（argmax 里**含**期望技能）＝12/12，**收紧口径**（**并列也算红**）＝10/12。两个数都对，但**账本里必须写清用的是哪一个**，否则下一轮会把"口径差"读成"回归"（反之亦然）。落地时一处写判据、一处写读数，成对出现。

## 测量前先断言被测对象的"形态"

**第三次同型实例（2026-10-14，家族测试/门禁审计）**：**任何分组／计数／取值之前先断言形态与键** —— ①剪枝单位（"按条目 vs 按文件"口径不同、结论可相反）；②管道读退出码（管道掐断上游退出码 ⇒ 三态一律以门禁自打印的 `exit=` 为准）；③**按 `argv[0]` 分组**（64 条门禁里 63 条以 `node` 开头 ⇒ 产出假重复组）；改用**规范化完整 argv**（逐 token、分隔符统一、`packages/evolution/` → `packages/` 前缀归一）后：唯一键 63、重复仅 1 组。**判据：分组键必须与被判定的语义同粒度；同粒度做不到就先声明粒度。**

报"有值/无值"之前，先断言对象的**形态**（`Array.isArray`／长度／首元素）：本会话一次把**数组**按字符串下标取值，报成"别名缺失"，白耗一轮并写出一张失真的缺陷单。同一族的错误还有**取错嵌套层**（`parseFrontmatter(c).frontmatter.description` vs 顶层 `.description` ⇒ 静默读成 0，账目显示"零成本"）。
## 分类索引（正文只留模式与现行事实；案卷、实录与长文在 references/）

> 2026-10-11 结构手术：正文曾 99 103 字符＝硬上限 100k 只余 900 字符（再写即被拒）。按双轨把 **5 个实录密集章节整体迁出**，正文 17 735 字符（软带 20k 以内）。被迁的章节连同其内引用一并搬走，**内容零删减**——只是换了个家，读法＝按下面的问句找文件。

| 需求 | 读 | 需求 | 读 |
|---|---|---|---|
| **改包/提交前**查已知缺陷（default 导出冲突、schema 分库、reconcile 双挂载、死代码、静默降级清单…） | `references/bug-patterns.md` | 全量审计与审计模式集（fan-out 审计法、enum 别名守卫、写锁三模式、事件日志不变式、信息丢失六形态） | `references/audit-method.md` |
| 定「写正文还是写 references」＋加载成本 100k 硬顶口径＋借用外部阈值的计量纪律＋门禁加规则＋技能库手术安全规则＋DSH 缓存前缀纪律 | `references/governance-discipline.md` | 改平台契约/接缝**前**对齐事实（平台缝前置条件、out-of-turn 审批、变量名约束）——判错即设计级错误，改前必读 | `references/three-way-alignment-facts.md` |
| **加新机制前**做平台覆盖差集（平台已有座位就复用）＋技能写通道/版本链/审计落盘位置＋out-of-band 写不留痕 | `references/platform-seats-and-skill-writes.md` | 发布完成后核对文档（README 布局树、聚合依赖清单、安装步骤流、预设行集归属、门禁完整性） | `references/post-release-doc-sync.md` |
| 历史发布实录、API 代批模式、版本演进时间线 | `references/release-log.md` | 本地绿而 CI 红／CI 注解取法／装机最小发布年龄真门 | `references/ci-release-gate-loop.md` |
| 上表之外的支持文件（新会话勿只读正文） | `references/`：**platform-plugin-authoring-docs.md（★ 平台自带插件开发文档的位置与六条硬口径——"平台契约怎么写的"先读它）** · ci-lint-forensics.md（CI lint 取证：作用域／日志能说什么／收敛阶梯／家族抑制写法 ✓）· release-chain-preflight.md（**新增包／改 `packages/scripts/**` 时先自查**：发布顺序表漏登记、两布局脚本漂移 ✓） · client-ui-screenshot-verification.md（**五屏真实截图对照**：CDP 自驱路线＋token/点击祖先/哈希判据等坑 ✓） · client-copy-inventory-and-localization.md（**文案中文化批处理**：先数清三个用户可见面再定批次 ✓）；配套脚本 `scripts/scan-user-visible-copy.mjs`（扫字段式／`ok(`/`err(`／**句子构造器** ✓ ⇒ 打印每包候选数并落清单 ✓）· design-skill-library-maintenance.md · ci-red-triage-and-install-acceptance.md（**CI 三类红的复现法＋装机验内容口径 ✓**）· skill-routing-measurement.md（**目录路由读数：载体／多帧日志／目录指纹／p 与同载率 ✓**）· test-suite-audit-and-pruning.md（**测试集审计：五维剪枝判定＋两条根因＋反误报清单＋子代理委派法 ✓**）· verification-system-framework.md（**验证机制的统一判据：F/R/C/U 四因子＋环层冗余寿观五律＋四动作处置 ✓**）· release-install-and-npm-failure-modes.md · repo-security-hygiene.md · shared-state-run-registry.md · ui-pixel-forensics.md · verification-playbook.md · write-path-extension-patterns.md；`scripts/`：count-platform-cites.mjs · ink-scan.ps1 · probe-command-surface.mjs · probe-live-skill-cost.spec.ts · probe-session-readability.mjs · scan-session-archive.mjs · ts-syntax-check.cjs · audit-test-suite.mjs（**测试集全量普查：规模/形状/等待/子进程/testkit/重复标题/悬空 import ✓**） |

**发布/CI 状态一条命令搞定**：`node <skill>/scripts/ci-release-status.mjs [tag]` —— 打印最近 4 次 run、该 tag 的每个 job 与步骤进度、npm 上关键包的版本，失败时附原始日志里的错误行（本会话手敲同一条 gh/npm 管道十几轮后固化）。还会打印每个 job 的 **`age=Nmin`** ⇒ "是否卡住"一眼可判 ✓；注意 job 可能比 run **晚起跑** ✓，别混用两个时间数 ✓

**搬迁后的自证**：`node D:\dsh\_tools\skill-ref-audit.mjs`（打印 bodyChars/软带倍数、悬空引用、从未被正文提及的支持文件）。引用面守卫（`evolution-core/src/citations.ts`）只认以 `references/`、`scripts/`、`templates/`、`assets/` **开头**的 token，且 restructure 会拒绝搬迁「引用了不存在支持文件」的章节 ⇒ 跨仓库/跨技能路径必须写成显式作用域（如「镜像仓库 packages/scripts 下的 X」），别写成技能内相对路径。

> 详见 references/governance-and-gates.md
> 新增判断逻辑前先读 references/criteria-and-lint-discipline.md（判据重表达／未知语义／本仓 lint 三条／glob 花括号）
> 本节引用：references/add-a-family-package.md · references/fail-closed-contract-change.md · references/gate-arming-audit.md · references/generated-artifacts-and-guards.md · references/platform-client-contracts.md · references/platform-fs-contract.md · references/testbed-line-identity.md · scripts/family-io-consumers.mjs · templates/code-audit-brief.md · templates/role-review-to-plan.md
- `references/client-ui-conventions.md` —— 家族客户端 UI：抄平台度量 + 两套 token + 数据链固定形状。
- `references/umbrella-consolidation-model.md` —— 伞状技能的"合并/剪枝"机制模型（hermes-agent 读实：声明式归属 + 引用重写 + 默认关门控 + 无拆分）。
## 治理类改动的五步执行纪律（所有者 2026-10-13 口径；按「项」而非按「批」）

①读文档（执行稿＋接口契约＋该项目的设计稿）→ ②定性（是债还是不变量／触发条件与失效模式／上游有还是我方自造）→ ③读**全部**相关代码与引用（调用点＋被调用点＋测试＋门禁＋配置面）→ ④详细设计（签名／数据结构／调用点 `file:line`／错误面／**验收判据：命令＋期望输出**／**回滚单元**；允许大范围重写，与契约冲突先改契约）→ ⑤实际改码 ⇒ **该项验收全绿、回滚单元明确，才进下一项**。

**技能库就是这个项目的长期记忆（所有者 2026-10-13 明示：「开发经验已经沉淀在 skill 里，有些在 dsh-maintain 相关的 skill 里，可供参考」）。** 动手前先读相关的既有 `dsh-*` 技能——尤其本技能，以及 `dsh-two-plane-maintenance`／`dsh-session-forensics`／`dsh-plugin-compatibility` 这类维护技能，它们已含大量实测坑；新经验**并入既有 umbrella**（正文只放 2-8 行的模式，案卷、读数与长文放 `references/`，可复跑的探测放 `scripts/`），**不要另起一个只覆盖本次任务的同类技能**。

三条实测要点：
1. **验收判据要落成脚本，而且脚本先自证**：本会话我的检查脚本写成 `/([\w.-]+\.mjs)/.exec(cmd)[1]`（正则**没有捕获组** ⇒ `[1]` 为 `undefined` ⇒ 集合为空 ⇒ 报出"全部缺失"的**假警**）⇒ 检查脚本先打印「集合大小 ＋ 已知样本命中」再判红绿。
2. **验收会反过来改设计**：A3 实测「CI 独有 ⇒ 一律登记为 gate」会把**变异/辅助步骤**（`prepare/publish/install/inject/run/lib-*`）混进执行集 ⇒ 契约把 `kind` 扩为四值、**runner 只跑 `script`/`toolchain`** ⇒ 验收暴露的设计缺口**回写契约再改码**，不得就地打补丁。
3. **生成物用「生成器 ＋ `--check` 幂等」当第一条验收**（二次运行逐字节相同），并在改码前写明回滚单元（本例＝删生成器与产物，不碰既有校验器）。

## 分批落地与文档分工（多期工程）

一个设计档＝一份**批次表**（每批独立可发布、可单独回退）＋**不变量清单**（I1…In，违反即回退）；执行时每批固定四步：改镜像 → sync（overlay ＋ dev 双胞胎：`node D:/dsh/audit-v37/mirror-sync.mjs sync` 走镜像→构建线 overlay；**`packages/scripts/` 下新增或改动的文件还要 `node D:/dsh/sync-mirror-to-overlay.mjs <镜像相对路径…>` 送进 dev 双胞胎**——发版链第 2 步 verify-layout-sync 只比两边 scripts 目录，缺一个就 `layout drift` 中止（0.15.0 实测）；该脚本无参时取 `git status`，工作树干净就必须显式传路径）→ 三件套＋门禁 → 单独提交，然后**回填设计档的实施记录**（哪个提交、什么证据、口径有无变化）。
- **同步清单按「改动文件」列，别按「改动类型」列**（v46 实测踩过两次）：家族包的**数据资产**与脚本一样要过去——`evolution-core/persisted-write-inventory.json`、`evolution-agent/bases.json`、`evolution-core/row-overrides.json`、`packages/scripts/family-facts.json` 都算。忘同步的症状很特别：**构建线真树用例报出镜像根本不报的违规**（实测：只同步了 `verify-arch-guards.mjs` 而漏了写站点表 ⇒ overlay 的旧表让 N20 反查报 5 处「未声明写站点」）。判据：镜像 `verify-regression-set` 全绿、overlay 的 `guard-scripts.spec.ts` 真树用例红 ⇒ **先对「改了哪些文件、哪些没过去」，再怀疑代码**。
- **仓库根作用域的资产在 overlay 里不存在**（`.github/**`、根 `README/INSTALL/CONTRIBUTING`）：事实表里以 `repo:` 前缀或仓库路径声明的机器所有者，在构建线会打印「**not armed in this layout**」——那是预期状态，不是失败（镜像/CI 里同一个缺失仍然是违规，删 workflow 不会静默解防）。
可执行队列另存一份**清单文件**，与设计档分工：清单管「做什么、前置、收益量级」，设计档管「怎么做、什么不能动」——两边不互相抄，改动只落一处。
**口径修正要写回档**：实测与估算不符时（例：某批实测不减行数、反而净增），当场更正设计档与清单里的数字，别让旧估算留在档里当事实。
**设计档／方案计划要拿代码事实过一遍**（用户会专门要这一步）：主张 → file:line → 四档判定（成立／**已存在**／需修正／不适用）→ **修正直接落回正文**。「已存在」常能砍掉一整步；「忽略短期工程量」不等于放大改动面（能用一个谓词解决的就别加字段 + 改 7 处调用点）。方法与实证见 `references/design-vs-code-audit.md`（该文件另收**反向对账**：把各设计档里「计划过但没落地」的项扫出来、四档判定、合成一份总账——用户会点名要这一步）。
**待裁项分两类，别混**（用户 2026-10-11 口径＋当晚澄清）：**非功能分歧**（实现层取舍／架构与机制选型／重构／部署机制）⇒ **自决、不问**，按「忽略短期工程量／允许大范围重写重构／长期最优」执行并在正文写明理由；**仅当多个选项同为最优（真平局）才问**。**功能分歧**（影响体验：功能要不要、交互/文案/默认值取向这类用户能感知的差异）⇒ **要问**，先给判定事实＋长期口径下的推荐与代价。反面实例：把「A 案 vs B 案」抛给他，而 B 案其实在平台上会开第二个写面（长期必错）——那是可判断的**非功能**项，不该问；反过来，把「这个开关要不要给用户」按长期最优自己定了，才是越界。
**门禁与它要抓的数据不能同时落地时：先落「门禁 ＋ 一行带到期的豁免」，再处置、再删豁免**（豁免形态照 `verify-arch-guards` 的 N35 debt：id ＋ 理由 ＋ `expires: group N`）。否则「先开门禁」这一步必然把树变红，只能压成一步大提交或先红后修；豁免的过期组号就是修复的截止点，**每一步都保持可合入的绿**。实例：`verify-param-channel-parity.mjs` 去掉 `Object.keys(namespaces)` 作用域后 `evolution-approval.pendingTtlMs`（E3 行、字段非 `.volatile()`）立刻红 ⇒ 1.1 门禁＋豁免、1.2 补 `.volatile()`＋命名空间、1.3 删豁免。
**若数据能在同一提交里落地，就直接跳过豁免**（2026-10-11 实证）：门禁＋数据＋要求一次落地，树全程绿，比「先豁免后清理」少一个来回、也少一条将来必删的机制；豁免只留给「数据必须由别组／别步交付」的情形（G2 的 101 行暴露键即此法：语法＋数据＋要求同一个提交）。
**临时装置用完即删**（同一条纪律的另一半）：上面那种豁免登记一旦清空就**删掉机制本身**（家族规则「require a current owner and need」），只把**模式**留在本技能里——0.21.0 的 `EXPOSURE_DEBT` 在 1.2 修完后即删（`-41/+2`），留着一个空注册表＝下一批人以为它还在工作。
**负载偶发不静默处理**：门禁单条失败先孤跑＋重跑，判为偶发也要记账（见 `references/generated-artifacts-and-guards.md` §7）。
**技能写入的验收仪器**（`_tools` 的两支快照/账本核对脚本，判「注入后没人动手／只做批准子集／旁路写不落账」）：见 `references/verification-playbook.md`。
## 架构与安装布局（先读）

  **同族第四形态（对 markdown 列表打 patch 时，同会话踩 2 次，两次都静默拼接）**：拿**一个 bullet 的开头**当 `old_string`（如 `- **同属一个"场景"名的文件格式…**`），而文档里已有一条 bullet 以同样文字开头时，patch 会把新内容插进那条中间，**两条 bullet 被拼成一条**——**既不报 matched 2 times、也不报错**，只有随后 `read` 才发现内容重复且丢了一个 bullet。纪律：① 对列表打补丁，`old_string` 必须取**整行直到换行**，或取该行内**同一 bullet 独有的短语**；② 每次 patch 后 `read` 该行 ±2 行做**拼接复核**，不只看目标串是否存在；③ 命中"这条 bullet 我是不是已经写过"时先 `grep` 该 bullet 首句，别直接插。**追加内容首选在 `## ` 标题行之前插入**——但**绝不把标题行本身当 `old_string` 去替换**。
  **同族第五形态（同日再踩，前四次是列表/转义，这次是标题）**：为"在 `## 5. 控制面` 前插入一节"而把该标题行当 `old_string` 时，**若 `new_string` 里没把标题原样带回来，这一节的头就被删掉了**——patch 成功返回、文件不报错，只是章节号从那里开始缺号/错位，又过了几轮才被发现（同日前一次是 `## 8` 变成两个，这次是 `## 5` 消失）。与前四形态同源：**锚点是"位置"，不是"内容"——拿唯一的行去替换，就等于拿它当了靶子**。三条纪律（按成本排序）：
  ① 要"在标题前插入"就写成 `old_string: "## 5. 控制面…"` → `new_string: "<新内容>\n\n## 5. 控制面…"`——**标题必须原样出现在 `new_string` 里**，这是唯一安全的标题锚用法；
  ② **改完立刻跑结构自查**，不要靠记忆：`Select-String -Path <f> -Pattern '^#{2,3} '` 打印全部标题与行号，看有无重号/缺号——这一步是当天两次唯一能发现该错误的手段；
  ③ 同一文件同一区域的多步改动**合成一次 edit**（整块替换），比连打多个 patch 安全。
- **宿主层**：`@lmzhen/dsh-evolution-host` 组合包（cordis.patch.yml 插入所有 infra 行：policy/io/state/memory/skill-usage/approval/threat/review/curator/activity/feedback/learning-graph/replay）。**不含模型工具**。`session-query-sqlite` 是覆盖 base 已有行的 config override（放 insert 块**外侧**），参数化 `openAt`/`path`。
- **预设层**：Evolution agent preset（`~/.dsh/.agent-presets/evolution/`），在 host 之上加 4 个模型工具行：`@lmzhen/dsh-tool-memory`、`@lmzhen/dsh-tool-skill-manage`、`@deepseek-ai/dsh-tool-session-query`、`@lmzhen/dsh-evolution-skill-catalog`。**基座变体（standard/ptc 的预设 id 与 metadata 映射，`AGENT_PRESET_BASES` 冻结表单源）见 `references/agent-preset-bases.md`。**
- **门面**：`@lmzhen/dsh-evolution` 旧单体，已在 npm 全版本 deprecated，`prepare-release.mjs` 的 `PUBLISH_EXCLUDE` 排除它 —— 永不重发。
- 安装：`dsh plugin --profile web add @lmzhen/dsh-evolution-all@<ver>`——**一条命令**（聚合入口=依赖 host + 3 模型工具包 tool-memory/tool-skill-manage/skill-catalog，纯依赖无 patch 行）；细粒度：host-only=`add @lmzhen/dsh-evolution-host@<ver>`，加工具包按需；**两种安装形态**：① variant＝源码树/`install-layered` 生成；② attach＝`dsh plugin add` 挂到现有 profile（**本机为 ②**）；`@<ver>` 可省略装 latest 稳定版，装预发线须显式 `@0.x.0-rc.x`（`next` tag）——**严禁在 latest 上装 rc**（预发布 < 稳定，教程已撤过一次）。**权限诚实注记**：家族插件**不修改任何沙箱/权限档**（grep 全树零 hits——仅配置覆盖如 catalogDescriptionMaxLength 与 session-query-sqlite 参数）——生态文章中"插件可把权限拉满"的风险面家族不触碰；新增插件行时同样禁止加入权限/沙箱改动。**新包名首发必须先走 OIDC 引导**（runbook 末尾）：npmjs 造包名（granular token 全套餐+绕过2FA → `npm publish --tag boot`）→ 包页配 Trusted Publisher（org=lmzhen/repo=dsh-evolution/workflow=release.yml/env=npm-publish/允许 npm publish，WebAuthn 需用户按密钥）→ 实测在 validate 窗口期预配完成即一次 publish 通过。 **⚠️ 任何已发布版本都不要 unpublish**——注册表对已 unpublish 的版本留**永久墓碑**，同版本再发被拒（`E400 Cannot publish over previously published version`），唯一出路是抬版本重切（0.6.0 → 0.6.1 就是这么来的）。首发失败的应急口径：**只用 CI 自己 `evolution-dist-baseline` 工件里的 tarball** 补发（本地打包字节与 CI 不等价——演练克隆 CRLF、CI LF——会被完整性守卫拒），并在 publish 作业**等待环境门**期间先发、后批准，即一次转绿；细节见 runbook。**新包首发三联坑**：①OIDC 按包绑定（漏配=E404 PUT）②**next 初始不同步**——stable 发布会话只动 latest 不碰 next（runbook L88 机制），新包 next=absent、旧包 next 留历史值——需一次性 token `dist-tag add <pkg>@<ver> next` 统一钉正（ADD 端点可用、DELETE 对 granular 403；处置后等 30-60s 传播窗再复检）③发布面三处挂接（exports 子路径/files/tsdown entry——通配 `lib/*.js` 防 chunk 漏包）。

> 详见 references/bug-patterns.md
> 本节引用：references/agent-preset-bases.md · references/client-plugin-ui-seams.md · references/known-limitations.md · references/refactor-verification.md · references/release-log.md · references/review-injection-cadence.md · references/silent-degradation-checklist.md · references/v27-lock-and-audit-lessons.md · references/wake-delivery-unbound-method.md
> 详见 references/audit-method.md
> 本节引用：references/audit-v46-plan-execution.md · references/release-log.md · references/silent-degradation-checklist.md
## 正式版后版本纪律（现行；历史发布实录与发布线基线见 references/release-log.md）

- **⭐ 正式版之后严禁再发同号 `-rc.N`**（预发布语义低于稳定版——`next` 会指向比 `latest` 更旧的版本，教程已撤一次）；正式版后的开发 = **更高一档预发线**或直接补丁线；多批特征程序（如 008 A1/A2/B/C 一类）**程序期 main-only**（每个 main push 由 CI 双绿门禁、publish 跳过=零版本动作），程序完成一次性发布（特征批=minor），发布时处置 `next`（指向新版本或删除，消除 next<latest 残留）。（`next` 残留的现行认定见 `references/known-limitations.md`。）
- **审计报告归档约定**：仓库**不保留任何审计文件**（旧约定"只留当前基线 v6→v7→v12"已随公开仓库清理作废）——审计系列归本 skill 文档（release-log 时间线 + review-function-gaps + 各轮条目），git 历史保留全部原始档案；删除不丢知识。**历史审计轮存档**：v4 轮见 `references/audit-report-v4.md`、v10 轮（审计概况/复核/延后台账）见 `references/v10-audit-notes.md`、v11 后未修挂账清单（含重访触发条件）见 `references/deferred-v11.md`。
- **功能评估否决记录（插件原型跟踪 L1/L2/L3 → 不做）**：**可复用三问模式**——① 原生已有什么（证据/检索面绝不重复造:动态插件调用切片已在会话日志+session-query 可查）;② 派生面是否有稳定身份键（本场景 name+purpose 指纹先天漂移→碎片档案误导>无,否决）;③ 接入数据面前先查"信号窗污染"（若记 run 事件会把 007 轮转的 24000 条信号窗用遥测噪声挤出→否决）。**新功能接入环路面/新增事件类型,必须先过这三问。**

> 详见 references/three-way-alignment-facts.md
> 本节引用：references/011-maintenance-subagent-v2.md · references/archive/alignment-audit-prompt.md · references/audit-playbook.md · references/external-mechanism-borrowing-review.md · references/known-limitations.md · references/maintainability-backlog.md · references/parameter-exposure-and-settings.md · references/platform-seam-preconditions.md · references/prompt-ab-harness.md · references/rc5-hermes-alignment.md · references/review-function-gaps.md · references/usage-audit-checklist.md …
## 真机 UI 自测（浏览器桥被暂停时照样能跑）

宿主是本机 web profile、页面就是 GUI ⇒ **用 Playwright 驱动系统 Chrome（无头）跑真机验收**，不必等用户在侧栏点「跟随当前页面」，也不用他自己点：

- playwright 包在 `D:\dsh\deepseek-harness\apps\web\node_modules\playwright`（1.61.x；CJS 直接 `require` 绝对路径即可），浏览器用系统 `C:\Program Files\Google\Chrome\Application\chrome.exe`（`chromium.launch({ executablePath, headless: true })`）。
- 入口 URL 必须带 token：`http://127.0.0.1:3080/?token=<宿主控制台里那串>`；token **每次重启都换**（读法见 `D:\dsh\_tools\_read-console.ps1`）。
- 家族路由对 loopback 放行，页面内 `fetch('/api/dsh-evolution/...')` 直接可用；平台自己的路由（如 `/api/plugin-manager`）要 token/cookie，探不到就换判据（`--dump-config`、页面 DOM）。
- 走位：`getByRole('button', { name: '设置', exact: true })` → 点 `自进化`；卡片选择器 `.evolution-param-card`，行内按钮是 `批准`／`拒绝`／`预览`。截图落 `〈已清理 2026-10-15：_shots〉\`。现成脚本：`D:\dsh\_gui-probe.cjs（已清理 2026-10-15）`（看页面/区块 DOM）、`D:\dsh\_tools\_card-accept.cjs`（卡片验收：预览→批准→拒绝，逐步抓文本＋截图）。
- **证明页面加载的是哪一版客户端半**：在页面里读一处**只属于新版**的文案（如副标题的改动），比看文件名/时间戳可靠——拼接 bundle 的 `rev=` 只是构建号，旧页缓存与否它都不说话。
- **token 也会在「不重启」的情况下换**：`dsh plugin add`（或任何让 web 服务器重挂的操作）会给同一个进程发新 URL ⇒ 旧 token 的页面只显示 `dsh web authentication required; reopen the URL printed by dsh web`。判定法＝无头打开返回该句就**别改脚本**，重读控制台：`powershell -File D:\dsh\_tools\_read-console.ps1 -TargetPid <宿主 pid> -MaxLines 200`（宿主 pid = `Get-NetTCPConnection -LocalPort 3080` 的 OwningProcess）。
- **验收夹具必须可精确回收**：往状态文件里造记录时**当场记下 id**（`_seed-pending.mjs <id1> <id2>` 这种形态），跑完按同一串 id 删（`D:\dsh\_tools\_cleanup-pending.mjs`，删空即删文件，路由回到 `{"ok":true,"data":[]}`）；临时技能用 `skill_manage delete`（归档到 `.archive`）——注意它同样吃 **E-318 先读后写**：本会话没用 `skill` 工具读过那个技能，delete 会被拒，先 `skill` 读一次再删。
- 它抓到过真缺陷：0.16.0 的待批卡「注册了、但没有任何 `renderSlot` 点它的键」⇒ 真机页面里**根本没有这张卡**；组件级渲染 spec 看不到这一层（修法与护栏见 `tests/section.spec.ts` 模式：驱动真实 `apply()`，要求 section 问遍每个注册键）。

## 发布前预演：pre-tag 门禁怎么跑、读数怎么读（2026-10-14 实战）

**怎么跑**：`Set-Location <overlay>`；`node <mirror>\packages\scripts\pretag-gate.mjs`（脚本只在镜像里，相对参数按 **overlay** 解析；镜像布局是 `packages/<plugin>` 且**没有** `.oxlintrc.json`）。

**门禁三项检查＋各判据**：①**版本三方**（根 manifest ＋ 各包 manifest ＋ CHANGELOG 头）②**家族 lint**（走 overlay 工具链）③客户端 bundle 可重建 ④**已安装 patch 与已发布产物逐字节相同**。默认**只读**；只有 `--fix` 才写回并大声报告。

**读数的三条硬规矩（工具链席裁定，违反即读数作废）**：
1. **判据树只有 overlay** —— lint 规则写在 override 块里、`files` 是**配置根相对 glob**；拿**镜像绝对路径**喂 oxlint ⇒ 规则**根本没加载** ⇒ 打印 `Found 0 warnings and 0 errors` 是**假清白**，不是"镜像更干净"；
2. **读数必须成对带 `cwd=` 与 `oxlint=<版本>`**（CI 钉 1.76.0，本机同版；lock 升版必须重跑并重记）；
3. **报规则分组计数，不报总数**（总数里绝大部分是本地类型感知噪声：`typescript(no-unsafe-*)`／`await-thenable` 等，需要 CI 钉的平台类型 ⇒ 门禁把它们过滤成 noise 行）。

**改风格不要手写正则**：本会话用 `(\w+) =>` 全局去括号 ⇒ overlay 扫描 **494→832（更差）**——`arrow-parens` 是 `as-needed` 且 **`requireForBlockBody: true`**（单参＋块体**必须**括号）；`member-delimiter-style` 是 **multiline 无分隔符／singleline 用 `;`**。**正确机制＝在 overlay 上 `oxlint --fix`，再把改动按路径映射回写镜像**（做法：对 overlay 树做**哈希快照 → `--fix` → 比对 → `packages/evolution/X` ↔ 镜像 `packages/X` 复制**）。

**红项分类纪律（本会话踩过）**：包级跑测试出红 ⇒ **先隔离跑那个 spec 文件**再定性。`skill-consolidate.spec.ts` 在包级跑超时、**单独跑 15 passed / 3.86s** ⇒ 假红；而 `evolution-review` 我一度写成"超时型"，**隔离跑仍红**（6 failed / 45.7s）⇒ 真因是 spec 依赖平台 testkit（`@deepseek-ai/dsh-agent-loop-testkit`，本机未装）。⇒ **环境型红必须点名机制**（缺 testkit／平台基线补丁不在其上方），不得写成"超时"糊过去，也不得计入家族回归。

**类型面（`tsc --noEmit -p …`）分工**：①**构建线 vendor**（`.volatile` 不存在／cordis 无导出成员 ⇒ 换 vendor 副本）；②**包级导出或过期声明**（`@deepseek-ai/dsh-evolution-core` 无该导出成员：先查 core 的 `src/index.ts` 是否导出该符号与本地解析路径，**不猜**）。自己写的类型错**不许用 `as any`／`@ts-expect-error` 压掉**：本地解析到的声明缺字段时，用**结构化读取**（本地 `type X = { … }` ＋ 一次局部 `as`）＋ 给回调**显式标注参数类型**。

**实录（读数与命令逐条）在 `references/pretag-rehearsal-2026-10-14.md`。**

## 本机 `tsc` 报「Module … has no exported member」时，先查两处（2026-10-14）

**症状**：`tsc --noEmit -p <pkg>` 报某包「无该导出成员」，而那个包的 `src/index.ts` 明明写着 `export * from './新模块.ts'`。
**机理（两处，都不在业务代码里）**：
1. **声明过期**：包的 `package.json` 里 `types` 指向**构建产物**（家族是 `lib/types/index.d.ts`）⇒ 消费方解析到的是**上次构建**的 `.d.ts`，新导出的符号**不存在**；实测该文件 3,770 字符、不含新模块名。⇒ 判据：直接看那个 `.d.ts` 里**有没有**新符号（不是看 `src`）。
2. **vendor 落后**：构建/类型检查都要过 vendored 框架副本（家族是 `vendor/cordis`、`vendor/schemastery`）⇒ 副本落后时**整族源码**报 `.volatile does not exist on type Schema<…>` 之类的错 ⇒ **连 lib 都重建不出来**。⇒ 判据：把 vendor 版本与**发布元数据钉的范围**对照（家族是 `packages/scripts/prepare-release.mjs` 的 `VENDORED_*_RANGE`，注释里写明了能力下限与"同步源＝上游 vendor tag"）。

**怎么跑构建（只有一种正确姿势）**：`build-lib.mjs` 的头部写明**只能在 upstream overlay / dev 树里跑**（它按脚本自身位置解析包树）⇒ `Set-Location <overlay>; node packages/evolution/scripts/build-lib.mjs`；**扁平镜像里跑它是 ENOENT by design**（镜像只是发布载体）。
**⇒ 优先级教训**：vendor 落后**不是"只挡类型面"** —— 它同时挡 ①`tsc` 0 错 ②**lib/声明重建**（构建链一环）；CI 能出包是因为 CI 按 lock 装对版本。**别把自己的代码当成根因**，先跑这两条判据。

**发布前的文档事实项（同类，顺手一起查）**：README 里写的家族版本必须与 `package.json` 一致（不一致时门禁的 doc-facts 直接报红）；引用**别的仓库**的 `file:line` 会被规则判红（行号会随对方 bump 失效）⇒ 只引**符号名**。

**案卷（读数、命令、路径）在 `references/build-and-declaration-traps.md`。**


## 改完代码立刻看门禁的"差值"来定位（2026-10-14）

门禁复跑时**先看总数差值**：`family lint` 从 **290 变 291** ⇒ 只可能是你刚加的那一行 ✗（差 1 ＝ 一行一错）⇒ 别通读全量报告，**用增量定位** ✓。
另：家族 `arrow-parens` 是 **as-needed** —— 单参＋**表达式体必须去括号**（`x => x`），单参＋**块体必须带括号**（`(x) => { … }`）⇒ 新写 TS 一律按此形态，别凭手感 ✗。

## 测试集不是"没有债"（2026-10-14 全量审计结论，供下次复核）

- **两条根因决定形状，别先怪测试写法**：①上游 vitest 设了**逐文件 100% 覆盖率**阈值（`D:/dsh/deepseek-harness/vitest.config.ts:284-290`，`perFile: true`）⇒ spec 按「未覆盖分支」长成碎测（238 个文件里 114 个 ≤4 it）；②`evolution-review/src/index.ts:674` 的 `void onTurnEnd(...)` 是 fire-and-forget 且**无 drain 出口** ⇒ 时序用例只能真睡眠（同族 `evolution-feedback/src/index.ts:455` 有 `waitIdle()`，review 没有；`settle-watchdog.spec.ts` 已证明可假时钟化）。
- **跑家族 spec 的唯一本机入口**：`npx.cmd vitest run -c D:\dsh\_tools\vitest-family-preflight.mjs <名字子串>` —— **传名字子串，不要传文件路径**（该配置 `root=` 单仓树、`include=packages/evolution/**/tests/**/*.spec.ts`，传镜像路径会得到 `No test files found`），且要在 overlay 树里跑；按目录整跑会出 5s 超时假红。
- **验证机制的统一判据＝信息量（四因子 F/R/C/U）**：一条检查（spec／门禁／生成器 check／CI 步）任一因子为 0 就是死重 —— **F 能否返回两种判决**（空判据绿/永久红/重言式/非命令 cmd）／**R 对象与场景是否可达**（无消费者/场景可省略/窗口已闭）／**C 判决是否回到能改变动作的环节**（义务转给不存在的接收方/判据输入无生产者/缺参静默跳过）／**U 是否只是相关冗余**（同一判据在 run-gates、CI 步骤、spec、回归集各一份）。五条律（环/层/冗余/寿/观）与四动作处置矩阵、五维评分的投影关系、一页工作流见 `references/verification-system-framework.md`（本轮报告 §11 是它的完整实例）。
- **死测试要按"必要性"判，不按"对象是否还在"判**（所有者 2026-10-14 口径）：对象仍在发货（模块还在、还从 `index.ts` 再导出）照样可以是死测试。六条必要性条件（无消费者／判据已上移／窗口已闭／平台已接管／类型已保证／场景不可达）与检查法、三条反误报、以及本轮已复核的四种形态（含「**spec 是门禁输入产物的唯一生产者**」这个新形态）见 `references/test-suite-audit-and-pruning.md` §9。**口径坑**：按"名字只出现在测试里"机检会大量假阳，必须按**调用点**判并含声明文件自身。
- **门禁层自身有两种假绿/失效形态，比 spec 的问题更重**（本轮 D 组实测）：①**占位符型**——`CONTRIBUTING` 门禁表的 `<plane home>`/`<platform version>` 被 `run-gates` 逐字当 argv 执行 ⇒ `gate-30` 是空判据**假绿**（`--only gate-30` exit 0 且路径里带 `<plane`）、`gate-28` 是**永久红**；②**不跑也绿**——`verify-regression-set.mjs` 缺 `--upstream` 时整组静默跳过仍打印 OK，且 `gate-23` 只在 `profiles: ["local"]` ⇒ CI 从不执行。③**非命令的 `cmd`**——`gate-34` 的 cmd 就是 `--check`，`run-gates` 却报 `ok`；④**义务转给不存在的接收方**——`gate-01` 的 reason 说类型检查在 build line，实测 `action.yml` 里 `tsc` 只在注释散文里、`node_modules/typescript` 0 命中。另外 **spec 的类型检查没有自动化入口**（CI 与 `release.yml` 都无 tsc 步、`gate-01` 只在 local），**19 条 `expiry: 0.26.0` 的到期机制从不触发**（元门禁只判字段存在）。**门禁必要性的清单式检查（含"登记册≠执行器"的基线）见 `references/test-suite-audit-and-pruning.md` §8 与 §10。**
- **成本由子进程驱动、不由等待驱动**（实测：`guard-scripts` 35 例 35.67s、纯函数 spec 1.09s、`curator` 97 例 12.46s）；等待的危害是**易碎**。方法、五维打分与退役台账口径、反误报清单（legacy 语义＝升级连续性、两份 `provider-consistency` 不是复制、testkit＝体检对象）见 `references/test-suite-audit-and-pruning.md`。
## 平台线与本机不一致时（2026-10-14）

- **先量差**：对 `packages/<group>/<pkg>/package.json` 做版本集合比对（**⚠️ 旧文写的 `tools/platform-line-diff.mjs` 在本机不存在（2026-10-15 实测：镜像 `tools/` 为空，`_tools/` 与 `audit-v42/` 全树都没有）——真正的一手面是 ①`packages/scripts/family-facts.json` 的 `platform-line` 事实（写明 Validated platform line: DSH `0.2.0-rc.2`，并 forbid 残留的 `0.1.5-rc.2` 句子）②适配器 `D:/dsh/_tools/lib-line.mjs`（唯一知道解析顺序 mono → profile → closure → upstream → store；`vitest.family.config.mjs:51` 消费其别名表）。**平台线结论**：家族面向 rc.2 正确，本机覆盖层落后（vendor 三件套 `cordis 4.0.1／schemastery 3.18.1／cosmokit 1.8.2` vs rc.2 的 `4.0.4／3.18.4／1.8.5`）属环境滞后 ⇒ 本地构建失败不等于家族错版本**⇒ `same／differ／onlyLocal／onlyUpstream` 四个数。实测 **same=0／differ=201** ⇒ 是**整线升级**，不是换包 ✗。
- **后果与处置**：本机 `build-lib` 在这种检出处**不可能通过**（家族源码按新线 API 写）⇒ **构建面改在 CI 验**；每条读数标注 **`platformLine=<版本>`** ✗不得把这类失败当家族回归。
- **佐证来源**：先查家族自己的安装文档（`packages/INSTALL.md` 写明"验证过的平台线"）＋ 席位裁定，**两处一致才动** ✗。
- **必须显式登记**：走"构建面只在 CI 验"这条路时，说明与发布单里要写明"**本机未执行 `build-lib`**" ✗ —— 否则后人会把"本机全绿"读成"构建已验" ✗；并写死"**CI 构建失败必须阻断发布**"（不许 CI 红而人工放行 ✗）。
- **翻转条件（写进同一处）**：一旦 `dist.next` 非空、或发布链改用**本机 vendor 线**构建 ⇒ 本条**立即翻转**为"必须整线升级" ✗。

- **装机通道的验收（易错点）**：发布通常是**同名同版、内容更新** ⇒「版本一致」**掩盖不了**装到的还是旧包 ✗ ⇒ 装机验收必须出**内容读数**：同一模板带 `face=`／`channel=installed`／`catalogSha256`＋`cap`＋`skills=`，并与源码通道**逐条对齐**（例：描述集合的 Σ 与指纹应与 src 通道相同）✓。
- **产物可得性**：发布产物（tarball/`dist.next`）常**不在本机**（本机 `dist.next` 可以为空 ✗）⇒ 凡涉及产物的判据一律写明"**以 CI 的清单为准**"（`dist/manifest.json`／`publish-order.json`），不得凭本机目录推断 ✗。

## 发布流程

**⭐ 发布无需询问授权，直接做**（2026-10-12 用户明确纠正）：`git push`＋tag＋轮询 CI＋自动代批部署都在授权内。只有授权范围**之外**的对外动作才留一句话（如给**上游**提 issue）。此前把"提 issue 要问"扩成"所有对外动作都要问"，白等十余轮。

详见 `references/rc4-release-runbook.md`（**顶部为发布链执行检查表**——每次发布按表走查，缺一项即停；waiting 出现即 API 代批是硬步骤（**批后必须回读 publish 结论＋npm dist-tags——批准≠发布成功**）；其下新增**发布前评审表**——批次由子代理/交接文档交付时逐项走查：证据表对步骤表、删除文件查 CI overlay 段、新正则跑探针实测）。**0.3.83 起镜像即唯一创作线**（`D:\dsh\dsh-evolution-mirror`），一条命令走完：`node D:\dsh\dsh-evolution-publish-chain.mjs <ver> --no-sync` —— 脚本负责 normalize + 版本守卫 + commit/tag/push + CI 轮询 + `gh api` 代批 + npm 复验。**手工 `git tag -f` / `push -f` 属已退役的双线流程，不再使用**（版本已发布不可撤，修正走下一版）。同 ref 的旧 run 会排队挡住新 run，先「取消工作流程」。

> 发布面完整性 / npm 复验端点 / 忠实夹具口径：见 `references/release-surface-integrity.md`。
>
> **现成脚本**：发布后 npm 侧审计（版本端点／`latest`／上一版孤儿／历史 tag 残留，回答「还有哪些要人工去浏览器做」）用**技能自带**的 `~/.dsh/skills/dsh-evolution-maintenance/scripts/audit-npm-family.mjs <ver>`（不在镜像里，别去镜像 `packages/scripts` 找）；真 pty 手工发布（npm 在非 TTY 下把网页认证 URL 打码成 `***`）用 `scripts/publish-tarball-pty.cjs <tarball>`。**Trusted Publisher 绑定无法从命令行核验**——只能看某包是否曾由 CI 的 OIDC 成功发布过来间接判定。
>
> **发布前本地门禁 = 一条命令**：`node D:/dsh/audit-v42/run-baseline.mjs <prefix>` —— **22 步**（2026-09-28 起多一步 `verify-client-tokens`：家族客户端尺度＝`packages/scripts/client-tokens.json` → `gen-client-tokens.mjs` 生成两包 `src/client/tokens.ts`（字节相同，因为客户端半不能 import core）→ verifier 比对「生成物＝源」＋「`var(--evo-*)` 引用必须被声明」；`verify-arch-guards` 同时补到 **N1–N28**，其中 N25 半径/发丝线、N26 交互色只在可交互选择器、N27 几何无裸像素、N28 浏览器半不碰 node/写盘）（tsc-host / oxlint / vitest-full / **build-lib** / **smoke-built-entries** / 16 项 verify·check，已含 doc-facts `--strict --require-repo-docs`、platform-contract `--upstream`、profile-bundles、`verify-param-registry`、`verify-bundle-rows`、`verify-param-channel-parity`、`verify-family-tool-names`、`verify-skill-roots`）。交付态、修复态、定版态各跑一轮（0.4.1 实证：交付态红在 oxlint 22 处；0.8.0 冻结态与修复后各 21/21）。**步数只增不减，改步数要同步 SKILL.md／runbook／CONTRIBUTING 三处。**

- **⚠️ 门禁与树是绑定的：起跑之后任何源码/文档改动都作废那次门禁**（0.16.1 实证：`p1`/`p2`/`p3` 全被自己随后的改动打断）。纪律：先把改动定稿（**含注释与 docblock**）再起门禁；中途改了 → `job_kill` 旧跑、换新前缀重跑，并把**最终前缀**写进 CHANGELOG 头节（别留旧前缀）。
- **⚠️ 改的是镜像，不是 overlay**：`mirror-sync.mjs sync` 方向是 **mirror → overlay**——只改 overlay 再 sync 会被镜像旧内容**覆盖回去**（0.16.1 实证：一次「写 overlay → sync」把刚修好的注释打回原样）。镜像路径是 `packages/<pkg>/…`，overlay 多一层 `packages/evolution/<pkg>/…`；**把 overlay 风格路径误写成镜像路径**会在镜像里长出一棵 `packages/evolution/` 垃圾树（会进提交）——发布前 `git -C <镜像> status --short` 核对，出现 `?? packages/evolution/` 立刻删。
  **同族第四形态：脚本与门禁注册也分两套布局（2026-10-14 同一发布内踩两次）**：**脚本**路径镜像侧＝`packages/scripts/**`、overlay/CI 侧＝`packages/evolution/scripts/**`（`gate-manifest.json` 的 `tree: mirror|overlay` 决定 cwd；`action.yml` 里带 `working-directory: upstream` 的步同样跑在 overlay 树）⇒ 注册项抄错一侧就是 281ms 的 `Cannot find module`，后续步全 skipped。**新增/改任何脚本路径或门禁行后必做一次全体存在性核对**：抽出 `action.yml` 里全部 `packages/...` 路径在上游树逐个验（本仓 51 条，只允许故意跑在家族 checkout 的两条缺失），mirror 侧把 manifest 行的路径在镜像根验一遍。`CONTRIBUTING` 的门禁表描述的是**镜像树**上的 gate id ⇒ 表里保留镜像写法是对的。详见 `references/bug-patterns.md` 第 32 条 ＋ `references/ci-red-triage-and-install-acceptance.md`。
- **⭐ 发布前两道独立验证（0.8.0 实证：两道都抓到真问题）**：① **对抗式独立复核**——派只读子代理，给逐条断言＋要求证伪，只报 P0–P2（要 file:line 与可复现命令）；0.8.0 抓到 1 个 P0（「判定只看键存在」把**已带用户覆盖**的字段的被拒写入判成成功）＋2 个 P1（冒烟经整作用域 junction **写进已安装作用域**并残留 30 份；规则 N23 的写名白名单可绕过）＋1 个 P2（生成器静默丢行）。**复核给的数字要自己复测**（它报「22 键」，实测 20 键／22 条文案／33 调用点，结论驳回）。② **沙箱彩排**——clone 镜像＋拷 `lib/`＋`prepare-release`＋`publish-scoped --dry-run`＋**解 tarball 核载荷**；只有它回答「行为改动是否真的进了包」（客户端半看 `lib/client.js`）。命令序列、PowerShell 三个坑与四类发现的检查清单见 `references/pre-release-review-and-rehearsal.md`。

- **⚠️ `run_code` 写文件后再 `edit` 同一文件必被拒（2026-09-19 实证，连踩 3 次）**：`[IO.File]::WriteAllText` / `Set-Content` 这类**绕过 write 工具**的整文件重写会作废会话的读取快照，随后的 `edit` 报 `file changed since it was read` 或 `has not been read`。纪律：**批量正则迁移（`writeText`→`writeNode` 那类）之后，先 `read` 再 `edit`**；或整批改动只走 run_code、不做后续 edit。
  **同源第二形态：edit 的 old_string 命中「我刚插入的文本」时必报 matched 2 times（同会话连踩 2 次）**：把一次变更拆成两次 edit（第一次插入、第二次删旧）时，若第二次的锚点落在第一次插入的内容里，文件里便出现两份；`edit` 因多命中而拒绝，而我误以为「已生效」继续推进，直到后来读文件才发现整块被挪到了错误位置（`runStartStates` 被搬到变更循环之后 ⇒ compare-and-set 恒真、所有生命周期写盘被静默跳过）。纪律：① 同一区域的多步改动**合成一次 edit**（整块替换）；② 必须分次时**每次 edit 前重读该文件**——它会因并发写拒绝，但不会因自造重复拒绝（只报 matched N times）；③ 改完立即 `grep` 复核关键标识符的**位置**，不只看它是否存在。
- **⚠️ 在 `run_code` 里生成文件内容时的转义纪律（本会话连踩 5 次，必须照做）**：把 markdown/TS 内容写进 JS 字符串时，**禁止**在串内出现直线双引号（`"`）与反引号——前者直接 `Expected ',', got 'ident'`，后者会把字符串提前截断；后者更阴的变体是把拼接写成 `'...' + T + '...'` 却整段落在引号**内部**，结果是文件里留下字面量 `T`、运行期 `ReferenceError: T is not defined`。**做法**：内容用「占位符 + 数组 join」构建（占位符在 join 前统一替换），中文引号一律用「」，反引号用占位符在 `join` 前替换；改完 `.mjs` 必跑 `node --check`，改完 `prompts.ts` 先单独跑 `tsc`。
  **同族第三形态（本会话再踩 4 次，两处新坑）**：① `String.raw` 里 **`${` 仍然插值**——正则字符类最常中招（`/[.*+?^${}()|[\]\\]/g` 会让整个程序报 `Expression expected`／`Expected a semicolon`／`Expected unicode escape` 这类看不懂的错），字符类里去掉 `{}` 即可；② 单引号串里**再出现英文单引号**必报 `Expected ',', got 'ident'`（例：串内写 `kind: 'exact'`），改写 `kind: "exact"` 或用「」。**最省心的做法**：长文档不要塞进 run_code 的字符串——写一个 `.mjs` 生成器（读 JSON 拼 markdown，全部用双引号），run_code 只负责写脚本与跑它；追加写文档时「读全文→拼新段→整体 write」比 `edit` 找锚点稳（文件尾有空行时，锚点会取到空串，`edit` 直接拒 `must be a non-empty string`）。
- **新增一条守卫 = 三处齐活（本会话 G1 实证）**：① `packages/scripts/verify-<topic>.mjs`（读**同一文本**、默认 warn、`--strict` 响亮失败、真空根要 FAIL）；② `evolution-host/tests/guard-scripts.spec.ts` 的哨兵用例（真树正跑 + 真空 + 故意违规 + 产物缺失/被手改各一）；③ 本地门禁 `run-baseline.mjs` 加一步（步数随之 +1，SKILL.md 与 runbook 的「N 步」要同步改）。
- **⭐ 闸不能红就不叫闸：每条规则用「树外探针」自证（loupe 项目实证）**：把仓复制到 `%TEMP%` 探针目录（`robocopy`，排除 `.git`／`node_modules`），只注入该规则声称能抓的**一个**缺陷，在探针仓里跑门禁，断言 **退出码非零 ＋ 报出的坐标等于注入行**，跑完删掉探针仓。别在工作树里探——半途回退的探针比不探更糟。完整证据＝「真仓 13/13 ＋ 探针仓 12/13 且指名 `lib/tools/list.js:92`」两句同时成立。
- **⭐ 报告坐标不许用占位常数**：规则恒报 `line: 0` 多半是**捕获点只记了文件、没记行**（loupe `tools/check.js` 的 `addCode(c, f)` 实证）；正解是在检测点按匹配偏移换算真行号（`lineAt(text, idx)` 按换行计数），而不是换个常数糊上。换算成立的前提是「去注释后行数不变」，**该性质本身要有测试钉住**（loupe 由 `test/entry-loadable.test.js:132` 保证）——否则坐标静默漂移比恒 0 更坏。同时分清「本就没有行号」（找不到文件／解析边界失效 ⇒ `line: 0` 是对的、**故意不改**）与「没记到」，两者输出须可区分。
- **加一条规则＝改一个已公布计数**：规则数／步数写进 README、状态表或活跃链文档时，同一次提交刷完全部引用（与上面「N 步要同步三处」同源），否则等于新造一个陈旧计数。
- **⭐ 守卫的判定方向：优先「反向」——只白名单无害项，其余一律 fail closed（0.8.0 实证）**：写名白名单必被绕过——别名（`promises as fsp`）、同一模块的另一种写法（去掉 `node:` 前缀）、能写也能读的 API（`open`＋`writeFile`，缝自己用的就是 `open`）、动态形式（`import()`／`require`）全都能溜过白名单。正解＝列**只读** API，导入里凡不在表内即违规；再加动态形式的文本检查；守卫自带的 `detectors` 自检要**每种绕过形状各一条探针**（0.8.0：5→13 条），否则规则名写着「只在缝内写盘」而实际只覆盖一小撮名字。
- **⭐ 生成物守卫要比「全量内容」，别只比子集（0.7.0 实证）**：某个生成物若只被**子集断言**覆盖（例：`verify-param-channel-parity` 只比对生成视图里的 `{ id: '…'` **字段集合**），它的其余载荷（单位／取值域／控件种类／label）就**没有任何守卫**——改注册表不重生成，18 步全绿而浏览器拿旧元数据。正解＝**让生成器自己判新鲜度**（门禁里跑 `gen-<X>.mjs --check`，格式化逻辑只有一处），再补一条哨兵（手改产物 ⇒ 必红）。
- **⚠️ 混合变更集提交前核对暂存集**：`git rm` 自动暂存删除，但随后对**存活文件**的引用修正只是工作区修改——裸 `git commit`（无 `-a`）只带走暂存集 → 删除先推、修正后推 = 线上短暂悬挂引用。纪律：**编辑后 `git add -A` 再 commit**（或提交前 `git status --short` 人工核对"暂存集==意图集"再 push）。**反向同步**：若直接改镜像侧共享文件（包 README/测试注释等），必须回拷 dev 树并用 verify-layout-sync 核对——两布局逐字节一致才算同步完成。**镜像提交三类污染源**（robocopy 双线时代遗留；现仅在做镜像↔overlay 复制时需查）：src 产物 `*.js`/`*.d.ts`/`*.map`、包内 `*.tgz`、工作区残留的已删目录（`.release-staging/`、`packages/docs/`）。
  **暂存复核命令**：`git diff --cached --name-only | Select-String -NotMatch "\.(ts|mjs|md|json|yml|yaml|txt)$"` 应空；误入后 `git reset HEAD -- <路径>` + `git commit` 重提（勿用 amend 推历史，或 `reset --soft` 后重 add，避免 publish 残留 tgz 与旧 tag run 的冲突）。**工作区残留目录的防护永远写 `.gitignore`，不是手工删除**（`.release-staging/`、`packages/docs/` 删除后仍会重现、两次被卷进提交；现已入 .gitignore，`git add -A` 免疫）。

## 发布同步状态核对

- **⭐ 审计项事实双查**：处理审计报告项时「版本漂移/元数据」类**先查镜像当前状态**再立项——normalize-mirror 每版发布都会把全部包 manifest 钉回最新版，此类项往往已随上一版顺带修复（实例：manifest 版本漂移项在派发前核验即划掉）；「test-only export」类同理以**全仓 refs 计数（含 tests/，排除 node_modules/lib/dist/.release-staging）**为准——V4-38 标称的 11 个符号无一满足 refs≤1（全部有生产或跨文件消费方），报告主张被核验推翻，禁止按报告字面删除。
- **⭐ 修复面改动前先做同仓知识 grep**：曾把 `cmd.exe /c` 换成 `npm.cmd` 直启，未检索同仓 `install-layered.mjs` 早已写明的「spawn of npm.cmd is blocked on Windows (EINVAL)」——两处认知互相矛盾，修复引入新 P1。**纪律：任何「修一个主题」的改动，先在仓库内 grep 同主题的既有注释/回退/已知事实**（尤其脚本层与包层各写一份的同类认知），修复与既有结论冲突时先对齐再动手。

**⭐ 发布后必须验证 dist-tags 而非仅 versions（事故）**：一次 CI publish success（日志逐包 `+ @lmzhen/*@<ver>` + "publish run complete"）、`versions.<ver>` 存在，但 **`latest` 仍是上一个版本、新版本挂在 `next`**——`publish-scoped.mjs` 无 `--tag` 时**默认 `next`**（新版脚本按 manifest 版本自动选 tag），而 release.yml 未显式传参。**症状特征**：npm view latest 旧值 + registry `dist-tags` 里新版本挂在 next——发布"成功"但用户 `npm install`（latest）拿不到。**修复**：① **恢复脚本版本驱动自动选择**——`publish-scoped.mjs` 现在按 manifest 版本自动选 tag（prerelease 含 `-`→next / stable→latest），**release.yml 必须裸跑（不许再写回显式 `--tag latest`——那会复现"首个 prerelease tag 被标成 latest"的敞口**；显式 `--tag` 仅手工修复场景覆盖）；② 钉正 dist-tag——**本机 npm 无发布凭据（E401——发布全走 CI OIDC），本地 dist-tag add 不可行**；正解=临时 OIDC workflow（`.github/workflows/fix-dist-tags.yml`，workflow_dispatch + id-token: write + setup-node registry-url，循环 `npm dist-tag add @lmzhen/<pkg>@<ver> latest`），修复后删除该临时 workflow。**EOTP 环节**：`npm login`（默认 auth-type）后 `whoami` 通过但 `dist-tag add` 报 **EOTP**（"This operation requires a one-time password"，URL 在报错与 debug log 中均被 npm 脱敏为 `***`——用户需自己跑一次命令拿完整 URL）；正解=**用户执行 `npm login --auth-type=web`**（浏览器验证后签发完整写权限 token 落盘 .npmrc），此后 dist-tag 不再触发 OTP。**发布验证固定步骤**：`Invoke-RestMethod registry.npmjs.org/@lmzhen%2F<首包> | 'dist-tags'` 断言 `latest==发布版本`（versions 存在不够——**dist-tags 才是安装面**）；再加逐包 `npm view <pkg> dist-tags.latest` 29/29。

核对「git/npm 是否都更新到某版本」时，**别拿仓库里 package.json 的 version 当标准**（`normalize-mirror` 每版把镜像 manifest 钉到 head 版本——仓库版本号不等于发布事实）。正确方法与坑（`@lmzhen/` 而非 `@deepseek-ai/` scope、prerelease 走 `next` tag、`[deleted]` 的 stderr 误报、逐个查询超时、历史错位 tag 判定）见 `references/release-sync-verification.md`。**版本演进时间线（历史实录）、API 代批模式、CDN 传播窗口、轮询脚本坑**见 `references/release-log.md`——发布会话只读这两个引用文件，正文不再复制。

> 详见 references/post-release-doc-sync.md
> 本节引用：references/011-maintenance-subagent-v2.md · references/audit-report-v4.md · references/pre-tag-gate-parity-and-tag-recovery.md · references/refactor-verification.md · references/release-decisions.md · references/silent-degradation-checklist.md
- `references/skill-see-also-model.md` —— 技能"参见关系"的方向与语义（用户裁定）：边写在**读的人那侧**、不记派生、相近不落库；含两套指针文法与"选得到只能靠 description"的落地约束。
## 家族源码改动的闭环（2026-10-14 实战校准）

- **改哪里**：source of truth ＝ `D:/dsh/dsh-evolution-mirror/packages/**`；改完 `node D:/dsh/_tools/sync-mirror-to-dev.mjs` 同步到 overlay `D:/dsh/deepseek-harness/packages/evolution/**`（输出里看 `failedCount: 0`）。
- **在哪里验证**：**镜像自己没有 node_modules** ⇒ spec 里 `import 'vitest'` 会 `ERR_MODULE_NOT_FOUND`（`node --test` 跑 `.spec.ts` 就是死在这一步，不是测试失败 ✗）；**必须在 overlay 里跑**：`cd D:/dsh/deepseek-harness && npx vitest run packages/evolution/<pkg>/tests/<file>.spec.ts`。注意 **vitest v4 已废弃 `--reporter=basic`** ⇒ 用默认 reporter。
- **行为验证用探针**：探针脚本放 overlay 的 `packages/evolution/scripts/` 下**跑完立即删除**（留在仓里会污染工作树）；**同一文件名删过再写会被 fs 层拒绝**（`file no longer exists`）⇒ 换个名字重写即可。
- **读数式验收**（照用户口径）：改前/改后同一探针出数字（例：`related_skills` 运行时边 0 → 68/44，`unresolved=2`），再跑相关 spec 看绿（例：citations+content-hash 24/24）。**先有读数，再谈结论**。
- **闸门口径**：家族闸＝`packages/scripts/pretag-gate.mjs`（7 项，本机事实）＋ `run-gates`（树事实，`gate-manifest.json` 由 `CONTRIBUTING` 表 ∪ `action.yml` **重生成**，不手改）；平台仓的 `pnpm run *` 脚本**不适用于**家族包。
- **门禁与运行时同源读数**：家族 gate（`.mjs`）可以直接 **动态 `import()` 家族的 `.ts`**（Node ≥23 原生类型擦除）⇒ 门禁看到的数字与运行时是**同一个实现**；只有 import 失败才退文本扫描，并在读数里显式标 `reader=text-fallback`（**测量通道必须声明**）。
- **闸门的回退读取路径＝第二个读点**：门禁若带「读器不可用就退回文本扫描」的兜底，两侧结论会相反 —— 实测同一份夹具（YAML 块序列写 `related_skills`），运行时读器得 1 条边、文本兜底得 0 条并报 CANNOT DECIDE。**修法**：去掉兜底；读器不可用时 `exit 2 + reason=reader-unavailable`，**不输出任何可被下游消费的数字**（给 0 会被读成「没有边」）；诊断另开一个模式打印，同样不给数字。
- **两段式判据**（本会话固化）：①退出码 ②stdout/stderr 必含**被判对象标识**；**没有对象名的绿＝红**。夹具须同时覆盖两种语料形态（块序列在真读器下 edges=1、在无读器时**必须 exit 2**）。
- **跳过规则必须与平台同一实现**：家族镜像 `<root>/<name>/SKILL.md`（depth≤2）＋ kebab-case 名字文法；`.archive`/`.backups` 靠**深度**排除、`._x` 靠**名字文法**排除 —— 两套机制不可并成一条前缀规则，也不可自写正则。
- **`run_code` 写长中文内容**：用模板字面量或数组；**字符串内不要出现 ASCII 双引号**（用「」），否则截断报语法错（本会话实测三次）。
- **发现形状只有一个实现**：`evolution-core/src/skill-discovery.ts` 导出 `isSkillName`（kebab-case，`._x`/`Bad_Name` 均 false）、`isPotentialSkillPath`（**depth≤2**：`<root>/<name>.md` 或 `<root>/<name>/SKILL.md`）、`discoverSkillFiles(root)`（非递归、跳过点前缀目录、要含 `SKILL.md`）。**门禁与图谱必须都调它**——两处各自实现就会得到 68 与 63 并存那类症状（差 5 全来自 `.backups/` 快照被当成活技能）。平台判定出处：`skill-filesystem/src/index.ts:677-684`、`parseSkillFile:816-819`、`.system:666/680`。
- **门禁自测夹具模式**（照 `verify-graph-edges.mjs --self-test`）：临时目录里同时放 `live-skill/SKILL.md`、`Bad_Name/SKILL.md`、`._x/SKILL.md`、`.backups/snap/…/SKILL.md`、`.archive/…/SKILL.md` ⇒ 断言**只认出 `live-skill`**；再加**中文语料**断言 `Buffer.byteLength(x,"utf8") !== x.length`，并**显式断言"写成 `s.length === size` 必须失败"**（负例进 self-test 才算闸门能红）。
- **在 `run_code` 里写文件**：长内容用**模板字面量**一次写（内容里避免 `${`），**不要**用 `"..." + q + "..."` 那种拼接——它会直接报语法错（实测两次）。

## 判决面/生成物改形后的四条自检（2026-10-14 G2 实测）

- **改完「声明面」必须立刻取执行器读数并逐项比基线计数**：把 `gate-manifest.json` 的 `cmd` 拆成 `human`+`argv` 时出现三处**只有读数能发现**的静默破坏 —— ①复合行（一个表格格里六条命令）的散文被「已知脚本」集合读出一个名字 ⇒ **一条已登记的 CI 行静默消失**（64→63 行）；②`criterion` 改从 argv 取之后，复合行又从散文里读出「判据脚本」⇒ 判据被凭空发明；③声明的 `argv` 以 `node` 开头而执行器一律用 `process.execPath` ⇒ 生成 `node node script` ⇒ **所有会起进程的门禁读成坏检查**（健康的 gate 由 pass/0 变 exit 1）。判据：改形后**立刻**跑「一个健康门禁 ⇒ pass/exit 0」＋「一个坏样本 ⇒ cannot-decide/exit 2」，并把**行数、分类数、登记数**与改前基线**逐项**对照 —— 计数变了就是发现，不是细节。
- **占位符判在「可执行面」，注解里的占位符不算**：表某一行的注解写着 `<path>`（它并不传这个参数），拿整格 `human` 去扫会把健康门禁误判成 cannot-decide（证据行 `cmd contains <path>`）。正解：扫 **join 后的 argv** —— 多词占位符仍是整段，「整段点名」的纪律不受影响；只出现在注解里的占位符是用法说明。
- **复合/畸形格一律 `null` ＋ 原因，禁「取第一条」**：一格多条命令 ⇒ `argv=null` ＋ `argvProblem="composite-cell: N commands in one table row"`，由元门禁点名。同理：没有 argv 的行**不得**参与「已知脚本」集合、**不得**从散文里推判据 ——「悄悄取第一条」正是上面 ① 的机制。
- **接手一个门禁时先验证它的邻座规则真的在计算**：本轮发现一条规则**只有注释、循环体是空的**（`drillCmd-or-noDrillReason`，且读的是不存在的字段），从未跑过一次 —— 「约定必须有载体（注释＝没有）」的活标本。做法：把断言/规则附近「`for` 体只含 `continue`」「`if` 体为空」的地方逐个点名，先补实现再谈判据。
- **PS 退出码**：工具回报的 `exitCode` 可能与命令真实退出码不一致（同一命令工具报 1、`$LASTEXITCODE` 是 2）⇒ 判红绿一律读命令**自印**的 `exit=`／`$LASTEXITCODE`（同源：管道会掐断上游退出码）。
- **验收树口径**：`D:\dsh\deepseek-harness` 是 README 自述的**过期前 dev 树**（本机实测 `build-lib` 报跨包声明错、`io.spec.ts` 的 `*.lock` 用例稳定红）⇒ 它上面的红**不作家族回归**；行为验收放 CI 现建的 overlay，或在该树里**只单跑**与本步相关的 spec。
- 本轮 schema、基线读数、变异表与提交号：`references/gate-manifest-and-declaration-face.md`。

## 观测模式与「未到期的新约定」（2026-10-14 G2/M3 实测）

- **观测模式绝不能改它观测的产物**：`--report` 若顺手把视图/清单重写一遍，「报告」就正好抹掉了它要暴露的漂移 —— 实测给一个 spec 打了 `@tier` 之后第一跑 `--check` 仍报 OK（假绿 0），因为前一条 `--report` 已经把视图刷新了。改成三分才抓到：「`--check` 只比较／`--report` 只观测／裸跑才写」。判据：任何非写模式**不得**调用写盘；变异轮第一件事永远是「动一个输入 ⇒ 看 `--check` 是否真红」。
- **新约定一律带到期版本，别一上来就红、也别永久豁免**：仓里 0 个 specimen 的新约定（本例 `@tier` 头）在数据里写 `requiredFrom`；版本未到 ⇒ **带计数的登记观测**（实测串：`239 of 239 spec(s) carry no @tier marker (required from 0.26.0, family version 0.25.9)`），版本追上 ⇒ **同一份数据**让它判红。实测：把 `requiredFrom` 改成已过的版本 ⇒ 立刻红并点名全部 239 个；改回 ⇒ 回到观测。
- **证明投影读的是真输入：移动一个输入项，别只读代码**：给一个 spec 加 `// @tier fast` ⇒ 该 lane 的 spec 数 0→1、`--check` 变红（已提交视图滞后）、重生成即绿、撤回并重生成回到基线 —— 四步同时证明**投影、漂移判定、数据家**三件事。同一手法也用于「标记写在头窗口之外」⇒ 观测点名 `file:line`。
- **校验块插入顺序**：往「顺序读值」的校验函数里插新块时，块必须落在它读到的每个值**之后**（本轮把读 `current` 的 `headerContract` 校验插在 `const current = …` 之前 ⇒ 守卫抛 ReferenceError 栈，看起来像崩溃不像判据）。**崩溃 ≠ 判红**：绿转「栈」先查声明顺序与重复声明（同会话另一例：`let LANES` 与后插的 `const LANES` 并存 ⇒ 配置加载失败、`failed to load config`）。
- **lane 身份口径（R71）**：读数必须写 `full(ci=on|off)`，**裸 `full` 不是 lane 身份**；lane 成员＝声明档 ＋ 累进链（pre-tag＝fast＋pre-tag），`ci-only` **正交**、只在 ci=on 时并入 full。投影基线（239 spec／64 gate row）：`fast 45/0`、`pre-tag 45/0`、`ci-only 9/0`、`full(ci=off) 45/0`、`full(ci=on) 54/0`。

## 车道、退出码与保留清单：G4-G5 的实测纪律（2026-10-14）

- **子进程的退出码语义必须映射，不能一律当失败**：家族 CLI 的约定是 0 通过／1 失败／**2 CANNOT DECIDE**。执行器曾把任何非零退出都记成 fail ⇒「平台语料为空」这类**基础设施缺失被读成不变量被违反**（实测 `health-admission` 在账里是 fail/exit 1）。修法：`status===2 ⇒ cannot-decide`，并把**子进程自己那行 CANNOT DECIDE 原文放进 evidence**（判决跟着理由走，不在执行器里重编），同时默认 `stdio: pipe`（否则那行拿不到）。
- **打印出来的 pin 必须被真正消费，否则就是装饰**：配置一直打印 `platformLine=` 与 `adapter=<sha8>`，却从不使用适配器 ⇒ 平台耦合 spec 全部死在解析（`Failed to resolve entry for package @deepseek-ai/cordis`），还被据此误判进 ci-only（判的是**配置的毛病**，不是 spec 的性质）。修法：动态 import 适配器取 `resolveAliases()` 接进 `resolve.alias`，**替换路径必须在盘上存在**才允许（不存在的替换会让 vitest 起不了 forks worker），被丢弃的条目**打印**。修后：加载阶段失败 0、232 个文件跑起来、87 个 spec 回到本档。
- **快档/车道的墙时要按"实测的正确量"定义**：①用逐文件时长求和线性外推墙时是**错的**（预测移出 top-5 到 ~64s，实测只降 8%）；②抬并行不是杠杆（16 核上 `--maxWorkers=8` 只把 179s 变 165s，累计工作砍半而墙时不动）；③真正的杠杆是**文件数**（每文件约 1.2s 的串行地板）⇒ 把快档定义成**实测最便宜的 N 个**（45 个 ⇒ 49.1s 达 60s 目标）。**判据：先找出约束量再优化它；投影只作方向。**
- **生成物里的手写块必须同批进保留清单**（同会话踩两次：`pendingAxes`、`checkMutations`）：给事实加一块手写数据后，若生成器不认它，下一次重生成就把它删掉 —— 两次都是 `gen-*-fact --check` 在**同一次 battery** 里抓到的（绿变 1）。纪律：加手写块与改生成器保留清单**同一提交**，并让 `--check` 进每次 battery。
- **机械批改先量覆盖率再决定做法**：一条严格的静态规则（脚本在册＋结果变量只被用两次＋断言紧随）在 30 处目标上**只命中 1 处**，放宽后 **0 处** ⇒ 说明这些改动与各自的夹具逻辑交错，**必须逐块人判**。⇒ 凡是"看起来能批量摘除"的动作，先在真实数据上量覆盖率；覆盖 ~3% 就立刻改走人判，别硬推机械规则。
- **而且机械规则必须排除「断言失败语义」的探针**（本轮踩到并已修）：`const typo = await run(..., [docFacts, psRoot, 「--stict」])` ＋ `expect(typo?.code).toBe(2)` 也是「跑真树的变量」，但它测的是**失败要响亮**（行为覆盖），不是绿树复跑；机械规则把它连同 `.then(...)` 续行一起摘掉 ⇒ **文件语法破、覆盖丢失**，只有跑一遍 spec 才发现。判据：被摘的行必须断言**成功形态**（`OK`／`0 violation` 之类）；出现 `code`／`exit 2`／`unknown flag` 一类即判为行为探针，**保留**。
- **`*>` 重定向的编码取决于哪个 PowerShell**：**2026-10-15 起 DSH 的 `pwsh` 工具是 7.6.7，`*>` 与 `>` 与裸 `Out-File` 写 UTF-8 无 BOM**（实测 `'中文测试' > f` = 14 字节，首四字节 `e4 b8 ad e6`）；只有显式 `powershell.exe`(5.1) 才写 UTF-16LE（用 utf8 读会得到字符间夹空字节的乱码，表现为正则零命中、字段解析全空）。判据：先按 utf8 读，首两字节 `FF FE` 再 `readFileSync(p, "utf16le")`；或 `Out-String` 直接进 stdout 让工具捕获。
- **增删一条检查会牵动三处计数，必须同批对齐**：从门禁表删/加一行 ⇒ ①**编号表重编号**（原 gate-N..46 整体位移，历史记录里的旧编号不追改，但要写明位移起点）②**文档计数词**（README／CONTRIBUTING／脚本里的「N 步」）③**轴登记的实测计数**（`pendingAxes` 的 no-placeholders／falsifiability 等会随成员集变化）。**别手工找这三处**：跑元门禁与总账，它们会**点名文件:行**（实测：删行后立刻点出 `README.md:267` 与 `verify-client-tokens.mjs:8` 的陈旧 46-step），修完再复跑到 0。
- 本轮的读数、命令与提交号：`references/gate-manifest-and-declaration-face.md`。

## 合并同源测试：先判重的是 harness 还是 subject（2026-10-14 G5 实测）

- **两类重复要分开处置**：①**subject 相同**（同一个包、同一组断言）⇒ 收成一份**表驱动**套件（每包一行）；②**subject 不同但 harness 相同**（四个 spec 各自把 base io 包一层计数器、各自断言「读走了挂载的那个 provider」）⇒ 只把 **harness 抽到 `test-support/`**（一份 wrapper），**subject 留在各自包里**（catalog 读／skill-usage 记录／feedback 证据是不同代码路径）。判据：如果两份 spec 连被测对象都不同，合并它们会**假装**它们是一回事。
- **覆盖不丢的最省事判据：先数 `it`** ——「合并件用例数 ＝ 各原件用例数之和」（实测三份 2＋2＋3 ⇒ 合并件 7 ✓）；不相等就是漏并或重并，不要靠读一遍代码自我说服。
- **删文件前查「独有的那条」**：合并时先列出各件**独有的断言**（实测 agent 版的「不得声明 host 面为运行时依赖」与「行 id 唯一」），把它们**并入**合并件——否则删文件会把覆盖一起删掉。

## 变异账本与生成链：G6 的实测纪律（2026-10-14）

- **一个生成器「读」另一个的产物时，看起来像写入竞争，其实是派生边**：症状＝两个 `--check` 只在某一种执行顺序下同时变红。别急着判「两个写者、后写者覆盖」——**先 grep 两个脚本的 `writeFileSync`**：只有一个写者时，去看另一个的**头部自述**（本例：「derives the rows from the table transcription (gate-manifest.json)」）⇒ 是 **INPUT 边**：重生成前者会让后者的派生产物陈旧。处置：把**顺序写在陷阱所在处**（两个脚本各一条 ORDER 注释）；陈旧已被 `--check` 强制，不需要合并脚本、也不需要谁改成只读。
- **账本要数「证明」而不是「声明」**：`redProven` 若按记录里的 `expect === 'red'` 数，一条**从没跑过**的记录也会被算成证据。修法＝证明动作（`--only`）成功时把 **`provenAt`（时间戳）＋`provenSha`（被还原文件的 sha）写回记录**，计数只认带戳者，并输出 `unstamped=N (ids)`。`provenSha` 让「这条证明对哪一版成立」可查：文件日后被改，戳**显式失效**而不是静默继续算数。⇒ 家族原则「读数必须带测量戳」同样适用于**关于读数的账本**。
- **一次变异探测同时是对门禁覆盖面的探测**：给某 check 写变异后**返回 green**，不是「测试写错了」，而是**该门禁不比较那个字段** ⇒ 这是**关于门禁的发现**。纪律：**删掉那条记录**（绝不留假证明），把缺口登记在册并写明补法。实例：某视图新鲜度门禁对 `version` 与 lane 计数**都不比较**（两次探测都绿）。
- **变异锚必须是唯一串；「追加一行」的写法**：短锚极易命中多次（实测某裸包名在同一文件出现 2 次、同一 manifest 出现 2 次 ⇒ `PATCH NOT UNIQUE`）⇒ **锚用整行**；要追加内容时用 `replace = find + 换行 + 新行`（命中仍是 1）。另外：记录里的 `file` 是**仓库根相对**（写成裸文件名会报 fs ENOENT，不是 NOT UNIQUE——两种报错指向不同的错）。
- **输出文案必须由数据生成**：某门禁结尾无条件打印「count of 0 means nobody has proven …」，在已经证明若干条之后**变成假话** ⇒ 改成按实测值生成（为 0 时才说那句）。**读数输出自身也不许误导。**
- **登记一个新门禁＝四处联动，且元门禁会点名第四处**：①表行 ②文档计数词（README／CONTRIBUTING／脚本里的「N 步」）③事实锚点（`all N steps`）④**声明 vs 执行**：元门禁拒绝「表里声明了但 CI 从不跑、也无登记覆盖」的行 ⇒ 确定性门禁接进 CI action，不能进 CI 的（记录未补全、语料属目标机器）**带 reason ＋ expiry 登记**。

## 写门禁判据与造变异：G6 的实测纪律（2026-10-14）

- **最快的造变异法＝把门禁自己的检测常量抽出来再满足它**：读脚本里的 `const X = /…/`（实测三次连胜：`CLAUSE`、`INLINE`、`TIMER_CALL`），照着它写一行违规样本即可；**同时读 SCOPE／例外段**（有的门禁把某些路径声明为例外，探针放错地方就永不命中）。凭门禁名字猜判据则常空跑（实测两次）。
- **判据要扫「载体」，不能扫「散文」**：表格单元＝命令＋说明；判据若写成 `单元.includes("--check")`，**说明里提到那个词就让判据永远为真**（我为此白跑两轮）。⇒ 判据扫的面必须是**载体本身**（命令串、代码、数据），不是**谈论它的文字**——这正是家族「注释不算证据」的同类错误。**判据必须解析出命令（反引号片段），而不是扫整格。**
- **「声明的形态」可能不是「判官的形态」（实测两例）**：①行**不带参数** ⇒ 脚本按自述默认判**本机**（vacant guard：换机器就 exit 2，判的不是仓库）②生成器行**缺 `--check`** ⇒ 跑的是生成器本体，**重写它发布的产物并 exit 0**——顺手**修掉了它本该报告的漂移**。⇒ 这类行「从不检查」。修法＝把形态写成**会判的那一种**（`--self-test`／`--check`），并配一条机械防线（凡生成器行必须带 `--check`）。
- **「未证明」先查三处，别先怀疑工具**：①**检查实际在跑什么**（argv 是否含 `--check` 这类判据开关）②补丁是否落到**同一个文件**（加取证：打印解析后的绝对路径＋打补丁前后 sha256）③判据源码。本会话三次误判都出在**跳过①**（把"门禁不红"归因于证明器、把"派生吃掉输入"当解释），而**最小判定实验（手工做同样的改动、直接跑那个检查）一次就能定性**。
- **证明器要有三条拒绝语义，账本要数「证明」而不是「声明」**：`NO GREEN BASELINE`（未变异就不绿⇒红证明不了任何事）／`TREE MISMATCH`（检查看不到补丁：变异在某树、检查在另一树）／`PATCH NOT UNIQUE`（锚命中≠1，实测裸包名在同文件与 manifest 各出现两次⇒锚用**整行**；追加一行用 `replace = find ＋ 换行 ＋ 新行`）。证明成功时把 `provenAt`＋`provenSha` 写回记录，计数只认带戳者，并报 `unstamped=N`。**判据有多个并列条件时，每个条件各写一条变异**，否则可能有一半是死的。
- **往长脚本里加判据时，「改的是哪一处」比「改得对不对」更容易出错**：按「锚字符串首次出现」插入，很可能插进**另一个遍历/分支**（实测同一个判据花了四轮、三次撤回，其中两轮是**代码正确但没跑到**——第一次引用了作用域外的标识符把元门禁弄崩，第三次正则与数据都验证过却完全不执行）。⇒ 插入前先确认**这一段属于哪个循环/分支**；插完先写一句**无条件打印**（打印该行的 id 与判定结果的长度）证明它落在热路径上，再写判据逻辑。
- **红证失败时的三分法（各配一个最便宜的探针）**：①**没跑到** ⇒ 在判据块里加无条件打印，看它出不出现 ②**没匹配** ⇒ 拿**真实样本**试跑正则并打印匹配结果（别拿臆想的样本）③**没在判** ⇒ 读该检查的 argv（是否带 `--check` 这类判据开关）与源码。三种原因的修法完全不同，先定性再动手；**同一个判据修两次仍不红，就换成"先证明可达性"的路线**，别在正则上再耗一轮。
- **写判据先试跑正则，红证失败就撤回**：本会话我给门禁写判据时**连错三次**——①引用作用域外的标识符（元门禁直接崩，靠"插完立刻跑基线"抓住）②扫整格而非命令 ③边界正则要求 `gen-` 前是行首或空白，而真实命令里前面是**斜杠** ⇒ 判据永不匹配。⇒ **先用一条真实样本试跑正则（打印匹配结果）再谈实现**；**新判据没有红证不得留下**（打不响的检查就是自己一直在追的 vacuous guard），**红证失败＝撤回**，把修法写进台账下一轮再战。
- **自测形态的行无法用仓库变异证明**：`--self-test` 这类行的主体是**合成夹具**，仓库内改动不可能让它红 ⇒ 这类登记为**豁免**（reason＋expiry，每次运行打印，缺字段不生效）。=> 覆盖口径是「**全部非豁免项**」，不是 N/N。

## 参考文件（按需加载）
- `references/verification-system-framework.md`：验证系统设计框架 ＋ **五条纪律**（形态断言→判决断言／约定必须有载体／计数带测量戳／撤回也要有归属／修复动作不同的红不得同名）＋ 四条写盘·测量纪律（锚唯一、验语义位置、发现模式要证伪、候选集单一实现）。
- `references/grouped-execution-plan-authoring.md`：设计稿冻结后"分组分步执行计划"的写法（组内紧耦合／组间松耦合／按依赖递推＋每组五件套＋通用 DoD）。
- `references/test-suite-audit-and-pruning.md`：测试集审计与剪枝方法 ＋ §8–§10 检查清单。
- `scripts/audit-test-suite.mjs`：可复跑的测试集普查脚本。


> ⚠ 2026-10-15 清理：本文引用的 `audit-v37` 目录已于 2026-10-15 移出 `D:\dsh`（按「audit 只留最高版本」的规则保留 `audit-v46-0.17.1`；发布门禁用的 `audit-v42` 例外保留）。文中这些路径**仅作历史出处**，结论不依赖它们仍然存在；需要复现探针时从 `D:\dsh-trash-20261015\` 取回。
