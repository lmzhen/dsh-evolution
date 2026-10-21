---
name: gate-mutation-probing
description: Prove a gate or test can fail before trusting its pass.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: ["Testing", "Gates", "Verification", "Mutation"]
    related_skills: [dsh-evolution-maintenance, codebase-defect-audit]
---

# Gate Mutation Probing

A static rule or a test that has never failed is not evidence that it works. This skill
mutates the thing a gate guards — in a throwaway copy — and requires the gate to go red
**for the intended reason**, one branch at a time. It does not cover authoring the gate,
and it is read-only against the real tree: every mutation happens in a copy that is
deleted afterwards.

## 造变异前的五问（每一条都对应一次实测空跑）

判据的「被判对象」有五个层次，任何一层没量清楚，探针就会落在判据看不见的地方、**返回绿**——绿在这里不是"判据没错"，是"什么都没测"：

1. **读哪个文件** — 同一棵树里，插件源码对某条判据可见、对另一条不可见（实测：错误码表门禁只读 errors.ts 与它同目录的 README，改插件源码无效）。
2. **读哪个字段** — 同一份数据里，判据可能只看图例不看站点数组、只看名字不看版本。
3. **读哪个区间** — 有的判据只比较被两个标记夹住的那一段，而这段可能**只有一行、两端标记在同一行上**（别按「标记分居两行」的直觉写选择器）。
4. **扫哪些目录/后缀** — 「扫面」是每条判据的私有属性（实测：客户端面文案判据只扫 src/client，插件源码对它不可见，对另一条判据则相反）。
5. **明确不看什么** — **排除项同样是扫面**：判据可能明文排除一类行（实测：与技能根同名的状态存储字段行被排除，改它等于白跑）。读判据时不仅要知道它看什么，还要知道它**明确不看什么**。

**锚点的两条前提**：①唯一——冲突时证明器会报命中次数，这本身就是最有用的读数；②**落在真实内容上**——落在注释块里的锚点会让追加的代码继承注释上下文而被剥离（实测四种变体：改错文件／内容写成注释／锚点不存在／锚点在注释块）。前者机器能兜，后者只能靠人选锚点前看一眼那一行属于注释还是代码。

**两种高命中配方**：①**集合差**——找到判据比较的两个集合，只改其中一个成员的同一属性（名字／条目／根符号／注册项）让两集合不再相等，本会话连续四条命中；②**生成物头部就是配方**——头部写着「GENERATED，不要手工编辑」，那么一次手工编辑就是它的红（三次印证）。

**第 6 问：被判对象有没有缓存或兜底，让"不可用"根本没发生？** 造"依赖不可用"的红时先证明它真的不可用：指向死 registry ⇒ 客户端长重试、命令超时（不是干净的红）；离线模式但本地已有缓存 ⇒ 依赖从缓存成功，检查根本没进失败分支（实测两次空跑）；可用形态是**清空的缓存目录 + 离线**。⇒ 变异生效的前提是目标真的进不了那条路径，不是你以为它进不了。
**第 7 问：这次执行里，同一被判对象被命中几处？**

**计数仪器：临时加宽 ⇒ 跑 ⇒ 数剩余 ⇒ 恢复加宽。** 一个判据放宽后会点名 N 处真正的问题，但**让判据在树上保持放宽**会把门禁变红 ✗。做法：临时放宽（并保留原字节）⇒ 跑一次拿点名清单与计数 ⇒ **逐字节恢复** ⇒ 树保持绿。每修好一处，计数就减一（实测 3 → 2 → 1）⇒ 这就是"**N of M 已修**"的证据，且全程不留红链。

**判据自带空转自检时，粗暴加宽会被当场否掉。** 有的守卫把"这条规则会不会空转"做成自检：加一个过宽的名字（例如裸 `read`）⇒ 它立刻报 `detector self-test failed … the rule would pass vacuously`。⇒ 两个含义：①加宽必须**精确**（用无歧义的名称，如 `readSupportFile`）；②加宽与**样本表**必须**同批**演进（样本要取"真实事故形态"并保留一条干净样本）；③自检通过本身就是"这次加宽是精确的"的最好证据。 采集器若把"同名脚本出现在哪些行"合并成一份，多次调用会被并成一份假不匹配（实测：同一脚本两次调用 ⇒ 旗标重复出现 ⇒ 假红）；反过来，只在多处匹配里改**第一处** ⇒ 剩下的仍满足判据 ⇒ 假绿。⇒ 先数命中处数（这本身就是读数），再决定"按每次调用比较"还是"改全部命中"。
**跨包契约的根因：先读被调用方源码，再用探针定案；探针必须在两个互不相干的夹具上复现。** 实测：同一处跨包缺陷我先后提出三个根因假设（缺某个信号／服务缺席／判据通不过），**全部被读被调用方源码否证**（对方代码明写会"迟到构建"、测试台确实装配了该服务、判据用的是 getter 的返回值）—— 三个错误根因都拦在读码阶段，**没有一条进入改码**；真正的落点一个探针就钉死，再**换个包换个夹具复现一次**才排除单点巧合。⇒ 顺序是"读码排除 ＋ 仪器定案 ＋ 跨夹具复现"。

**探针报"取不到"时，必须交叉第二种取法。** 同一份读数我第一版只用 `ctx.get(name)` 得到 undefined，无法区分"服务不在"与"取法不对"；第二版同时打印访问器（`typeof ctx.name`）与 `ctx.get(...) !== undefined`，两者一致才敢下结论。⇒ 凡是要下"取不到／不存在"的结论，都要有第二条取法或第二个夹具背书。

**先确认"要证的那件事"在这条路径上可观测，再造红证。** 实测：给图命令的夹具加策略桩后，门禁**确实**读到了保护名单（探针确认），但红证仍然写不出来 —— 因为 ①`delete`（归档）**按设计被放行**（可逆）②`edit` 在门禁之前就校验新正文的 frontmatter，而该命令的 `rawInput` **表达不了合法 frontmatter** ⇒ 拒绝信息来自更早的检查，**门禁的拒绝被遮住**。⇒ 遇到"删掉调用必红"写不出来时，别硬凑断言，先问：**这条路径上，被改的那一步是第一个做判断的吗？** 三条出路按优先级：①换到能构造合法输入的入口（例如经 approval 暂存的完整正文）②用形状类拒绝（缺字段／未知字段）③**把该执行点抽成一个可单测的函数**，在它自己的单测里断言"受保护即拒" —— **删函数体即红**，判据落在改动的那个执行点上。

**改语义前，先把"编码旧语义的判据"找齐；新旧判据必须同时绿。** 实测：把"取第一个能读到的候选"改成"取第一个**有内容**的候选" ⇒ 我**新增**的判据（第一份空＋第二份有内容 ⇒ 取第二份）**绿了** ✓，而一条**既有**判据（`doctor.spec`：只有一份、无家族分区 ⇒ 状态 `none`）**红了** ✗ —— 第一刀用 `continue` 把 `none` 变成了 `absent`，**丢掉了区分** ✗✗。修法是**"记住见过的"模式**：优先取第一个有内容的；穷尽时返回**第一份见过的**（它仍回答"文档存在但没有分区"）；一份都没读到才是 `undefined`。⇒ 口径：**语义一变，先 grep 全部断言该语义的用例**（含其它包），当**规格**逐条过，**不能只看新判据绿**。

**探针与检索的四类自伤（同一次排查里我犯了三次）。** ①**截断自己的输出**：`Select-Object -First N` 把目标行切掉，据此误判"探针零命中" ⇒ 探针要**过滤到目标输入**或**去重后不截断**。②**探错文件**：失败在 `commands.spec.ts`，我却探 `preset.spec.ts` ⇒ **先确认失败用例属于哪个文件**再插探针。③**一次 grep 就下结论**：grep `flagsOf('preset` 未命中便断言"运行时不用表" —— 而 `index.ts` 里就写着 `flagsOf('preset')`，**是模式漏了它**，白查两轮 ⇒ 关键结论要**枚举调用点全部命中**或**直接读函数体**，别用一次检索否定一个机制。④**多行块锚点**：拿一整段做 `replace` 锚点**匹配失败**（文件已被前轮改过）⇒ **读实现 → 按行替换 → 回读断言**。

案例细节（E-08 九处活碰撞与 preset 分支根因、S1-06 "记住见过的"模式）：`references/semantics-change-and-probe-cases.md`。

**判据的观测点必须落在"变异会改变的那个量"上（同一项我连废三版夹具）。** 计划原文写着「两个不同实例并发 update 同一技能，**第二次必须读到**第一次的内容」⇒ 观测点＝**读到的字节** ✓。我先后写了两版都不成立：①`Promise.all([a.update(), b.update()])` ⇒ **夹具造不出交错**（假 io 立即 resolve，第一个整个跑完第二个才开始）⇒ 断言"并发"前先证明夹具**真的**并发；②**断言最终内容** ⇒ 在 `update` 的**整体替换**语义下最后写永远胜出，**与锁无关** ⇒ 恒真、无判别力。第三版记录每次读到的字节才成立。⇒ 规则：**先问"变异会不会改变这个量"**；不改变就换观测点。

**"第 N 次读"的下标要先看真实序列，别按想象挑。** 我按"每个 update 读一次"取 `seen[1]` ⇒ 实际是 `v1,v1,v2,v2` —— **`update` 读两次**（CAS 基线 ＋ 正文）。⇒ **探针打印真实序列**（一次定案），再挑下标；推断读次数是白花两轮的原因。

**模块级共享状态的判据必须与其它用例隔离（否则整包红、单跑绿）。** 我引入模块级 per-root 队列后，新判据单跑绿、**整包红** —— 因为包内其它 spec 也用同一个 root 键，**共用同一条队列**，读顺序被外部任务左右。⇒ 判据用自己的唯一 root（`/skills-<tag>-<uuid>`）；**"单跑绿、整包红"几乎总是指向共享状态**，别先怀疑抖动。

**测试与 `node --check` 抓不到"用了没导入的名字"；改了标识符或类型关系就必须跑类型线。** 家族 spec 走 vitest + 类型剥离，`node --check` 只查语法 —— 两者都会放过一个未导入的标识符。本次会话同一类坑犯了两次：都是新写的块用了 `x`／`y`，而导入行里没有它们，测试全绿、语法全过，只有 `node -e "tsc -b"`（全项目构建）一点名（`TS2304: Cannot find name …`）。⇒ 规则：**凡本轮改的是标识符、类型别名、跨包类型关系，验证必须包含类型线**；绿的是测试不算数。

**别用"文件里已存在这个名字"当"已导入"的判据。** 同一个坑的第二种形态：我写了 import 的自检条件 `!t.includes(name)` —— 而**使用点自己就让这个条件为真**（我已在本轮把调用写进文件），于是 import 被整段跳过。⇒ 导入的存在性只看**导入区**（匹配 `from …` 那一行）或干脆无条件替换导入行；**永远不要用一个全局子串检查去决定"要不要加导入"**。

**探针自己也会骗人：别用 `JSON.stringify` 打带方法的对象。** 实测：`JSON.stringify(ctx.get('evolutionPolicy'))` 得到 `{}`，我据此误判"服务是空的"，而真相是**函数不参与序列化**；改成打印具体字段（`policy?.get?.()`）后一次看穿。⇒ 探针只打印**你要判断的那个字段**，不要打印容器。

**假绿：断言"文本在"而值从未产生。** 实测：把 `${await fn()}` 写进了**单引号字符串** ⇒ 用户会看到**原始占位符**，而我的断言（消息 `toContain` 那段文案）**照样通过** —— 因为文案在、**插值不在**。**抓出来的方法只有一个：把真实产物打印出来**（`console.log(message)` ⇒ 一行就现形）。⇒ 口径：凡断言"某个动态值出现在消息/报告里"，先打印一次原文；能打印就别推理。同类：断言"包含三态之一"只证明**有测量**，不证明**测量对**，两者要分开陈述。

**红证必须打在改动的那个执行点上；打在相邻层上等于没打。** 实测：把 `runMaintain` 里的读数调用变异为空数组，预期那条"转发"用例变红 —— 结果**仍然全绿**，因为该用例断言的是**直接调用**被改函数的下游，覆盖的是"转发"而不是"运行接线"。补上一条**运行级**用例（用既有夹具捕获交给子智能体的请求，断言其中含该字段）后，**同一变异立刻变红**。⇒ 变异前先问：这条断言会不会经过我改的那一行？不经过就先补一条会经过的。

**改完必须回读核验落盘；排查必须取原文。** 两处自伤（都发生在同一轮）：①`t.replace(...)` 之后**忘了 `writeFileSync`** ⇒ 修改从未落盘，我却据此判断"另有别的问题"；②用过度转义的过滤模式（`violation\\(s\\)`）grep 日志 ⇒ 什么都没匹配，于是把"**没有匹配**"误读成"**没有该类型问题**"。⇒ 写法固定为：**替换后回读该文件断言新内容存在**；**判定失败类型时打印原文尾部**，不用可能写错的过滤器。

**探针第一次就通过 ＝ 一个发现，不是成功。** 预期要红的夹具若首跑即绿，先别改断言，**先加观测**：把关键计数与各时刻状态打印出来（例如座位被调用了几次、渲染文本在每个阶段是什么），用读数判断"场景到底有没有发生"。实测：某读竞争夹具首跑通过，加观测后立刻看见"迟到的旧答复确实进来了"，而断言之所以过是因为——

**零假设必须对准缺陷的真实足迹。** 同一次竞争里，"新值还在不在"会**通过**（过期行是**被追加**的，新行没消失）；真正该断言的是"**过期值根本不该出现**"。规则：写断言前先说出"这个缺陷在可观察面上**具体长什么样**"，断言就写那一句；写完自查"把修复回滚，它会红吗"。

**先标定仪器，再用仪器。** 拿类型检查当红证之前，先跑出干净基线（退出码 0）；注意退出码语义（类型错误 1／配置或项目级错误 2）。实测：某 gate 的 tsc 形态依赖 CI 才检出的上游树，本机直跑得 exit 2（配置级），**不是**类型错误 ⇒ 该红证只能交给 CI，本机不得用未标定的输出来证明任何事。同一道理：**转译型测试运行器（如 vitest）不做类型检查** ⇒ 用例全绿**不能**代替"编译通过"，凡"必填参数／改签名"类改造都要另找编译期证据。

**证明"某物被渲染／被派生"时，只能在派生物里检索。** 我给报告新加了一个可选字段并断言"这行会被渲染出来"，检索面却选了**整份报告**的 JSON —— 而字段本身就含那句措辞 ⇒ 断言**自证**，什么都没证明。规则：证渲染就在**渲染产物**里找；证派生就在**派生后的字段**里找；输入面里的同名文本不算证据。自查问法："如果渲染那一行被删掉，这条断言还会过吗？"

**给报告／事实加可选字段，要断言两个方向。** ①有值时**必须携带**（含原文措辞）；②**无值时必须省略**（不能变成空数组噪音）。实测：carries=true 与 omitted-when-absent=true 两条一起才算契约成立；只有第一条时，字段会慢慢退化成"永远存在的空壳"（与登记册里大小为 0 的登记同一类病）。

**探针没执行也会返回绿**：给探针加一行专有输出当哨兵，并**直读尾部**确认它出现；只看"没有报错"会把自己没跑成的探针当成"判据没抓到"。同一道理适用于插进大脚本的检查块——位置错了它永远不执行，而门禁照绿。

**先分诊再数进度**：未证明清单里混着「还没造变异」与「造不了变异」两类。按判据主体的位置分（仓内／在另一棵树／仓外／本地缺席），把后一类登记豁免并写明 reason 与 expiry；否则分母里混着永远做不到的项，进度条会一直显得落后（实测：36 项待办分诊后只剩 17 项真清单）。

实测台账（本会话 30 条已证明、28 条豁免、四种锚点变体、五次探测的因果链）见 `references/evolution-ledger-2026-10.md`。
**放宽一条判据（loosening）同样要红证**：撤掉声明/条件，要求被它压住的观测**回来**，并让对照器失败。实测：把一条声明从侧表里撤掉 ⇒ 该轴的现场观测从 0 变 1，对照器 exit=1 并报「live=1 registered=- fail a live gap is not registered」。⇒ 只证「加了会红」不够，还要证「撤了会回来」，否则分不清是判据在判、还是数据本来就干净。

**证明过程中不要让仪器重写被测数据**：实测一次红证失败于「我夹了一步生成器」——它把刚被我删掉的键又写了回来，于是红证"通过"得毫无意义（exit=0）。⇒ 红证只改判据读到的那份字节，中间不跑任何会重写的工具；确需重跑生成器时，重跑后再改一次。

**证明器的记录是别的登记册的证据源**：`verify-mutations --only <id>` 本身就是这条判据「怎么把绿变红」的最忠实声明（本会话据此把 36 行的 drill 直接派生出来），而 `provenAt`／`provenSha` 是**痕迹不是策略**——任何对策略数据做身份哈希的地方都要把它们排除（实测：逐字节哈希会让每次盖章都改身份）。

**长跑的证明要落盘再读，且读尾部**：输出重定向到文件（`Out-File` 只在管道结束才写，「文件为空」不等于失败），失败信息写在**最后**——实测一次只读了头部，拿到全是对账通过的行，真正的失败在尾部。


## When to Use

- You just added or widened a static check, lint rule, or property test and are about to
  call it done.
- 「闸不能红就不叫闸」/ "how do we know this gate actually bites?"
- A gate reports green on a tree you have reason to distrust (a refactor, a port, a
  green result that arrived too easily).
- You added coverage for a new file, a new call shape, or a new access form.

## Prerequisites

- A copy mechanism: `robocopy <src> <dst> /E /NFL /NDL /NJH /NJS /XD node_modules .git`
  (Windows) or `cp -r`.
- A dependency bridge when the gate's tests need installed packages: a **junction** to
  the real `node_modules` beats copying it —
  `New-Item -ItemType Junction -Path <copy>\node_modules -Target <src>\node_modules`.
- The gate's own command, runnable with the copy as the working directory.

## How to Run

Per mutation: restore **every** file you have mutated → apply exactly one mutation → run
the gate inside the copy → record which assertion failed → next mutation.

## Quick Reference

Pick one mutation per branch the gate claims to cover:

| target | mutation | expected reading |
| --- | --- | --- |
| the guarded line | delete it | the gate names that `file:line` |
| the comparison the gate encodes | neuter it (`if (a !== b)` → `if (true)`) | the *specific* assertion fails, not just "something failed" |
| an early return | delete it | the boundary assertion fails |
| the output the gate parses | reword it | the parse/lookup fails |
| the registered name or entry | rename it | the "cannot parse this" blind-spot branch fires |
| **the gate form itself** | run the **old** form and the **new** form over the same probe lines | old: **green (missed)**; new: red — the sharper reading, because it proves the new form catches a class the old one structurally could not |

## 判据要先证明它**能区分**候选项

一条判据在"两个竞争假设"下给出**同一个读数**时，它什么都没测。2026-10 实测：给"整组保留"改动做夹具时用了 `keep=2`（组大小 2 ≤ keep）⇒ 无论实现怎样都是 2 条 ⇒ **白测**；只有 `keep=1` 才能分辨（现状 1 / 只修 A 仍 1 / 只修 B ⇒ 3）。

- **做法**：先写下"这个参数下两个假设的预期读数分别是多少"，**不同才值得跑**；能用**纯函数**就别用上层夹具（构造输入 → 调用 → 比对保留集合），因为上层语义（例如"基线条目是否带标签"）会把根因盖住。
- **同类**：判据只覆盖一个半边也算白测 —— 例如只查"空输出"会漏"有输出但没对象名"。

## 序号本身就是证据

派生量（自增版本号、条目序号、计数器）与你的模型不符时，**它是在告诉你中间发生过什么**，别当噪声。实测：`keep=1` 下只剩 **v4** ⇒ 说明**一定铸过 v3**（哪怕它已被剪掉、你看不到）⇒ 顺着这条线找到根因（剪枝删掉 predecessor ⇒ 下一次写误判"未曾记录" ⇒ 多铸一条**无标签** baseline ⇒ 同组被拆成相邻段），一次到位。
**期望值必须按事实更正，别为了好看写 `red`。** 实测：一条记录的 `expect:"red"`，实跑报 `NOT PROVEN RED: expected red, the check returned cannot-decide`。弄坏登记表之后判据**读不到自己的登记** ⇒ 真实结论就是 `cannot-decide`；而 `cannot-decide` **不是**绿——这正是家族的核心教义（不能决定 ≠ 绿）。⇒ 把 `expect` 改成事实值并写明理由（「a green here would be the defect」），再 `--only` 复跑盖章。硬凑一个 `red` 只会让这条记录长期不可复现。

## 验证类命令的输出一律不截断（第五次同族自伤，代价是一次失败的发布 run）

**症状**：本地验证「通过」，CI 却列出十几条你本该看见的错误。
**机制**：命令的输出被**按行数**截断（`Select-Object -First 20`／`head -20`／`| head`），而被砍掉的尾部正是失败清单。实测：本地类型线输出 33 行、读了前 20 行，被砍掉的后 13 行里就是那 8 条类型错误 —— 于是打了 tag、CI 红、`publish` 未执行，白跑一次发布。
**修法**：**验证类命令的输出要么全打印，要么只按内容过滤（`Select-String <目标>`／`grep`），绝不按行数截断。** 同理适用于探针、日志、`--report` 输出与任何「读数即证据」的场合。
**验证**：把同一命令的输出重跑一遍，逐行确认没有 `^\s+Tests|error TS|×` 之类的关键字落在被截断区；读数行数与关键字计数一致才算读到。

## 锚点失锚＝第四种空洞：recording ≠ reproducible（2026-10-15）

**症状**：变异库里有一条 `expect:"red"` 的记录，可它早已不可复现，而 `--coverage` 仍把它计进 `redProven`。
**机制**：锚点选在了**计数或版本号**上（实测：`find: "\"rows\": 65"`，清单行数 65→69 之后锚点出现 **0 次**）；runner 只在 `--only <id>` 时才检查 `occurrences === 1`，`--coverage` 的完整性判据只看字段在不在 ⇒ 失锚静默。
**修法**：锚点选**不随计数漂移**的字符串（源码里的独特语句、稳定的属性名）；并给 `--coverage` 加一条「锚点可命中」判据——`occurrences !== 1` 的记录不得计入已证明。
**判据**：改完立刻 `--only <id>` 实跑一次，看它是否仍 `PROVEN`；`--only` 会自动盖 `provenAt`/`provenSha`，**别手填**。

## 改生成物/JSON 前先照抄同族形状（三次同族自伤）

① 读寄存器用了**顶层键**，而它在 `facts[].machine.X` ⇒ 报「0 条」的假读数；② 改已有的转义串时**凭印象**构造了两个反斜杠而文件里是一个 ⇒ 替换 0 命中；③ 插块漏了值的**收尾引号** ⇒ JSON 直接破损（`Bad control character`）。
⇒ 规则：先 `JSON.stringify(那一行)` 照抄；插块先**复制一个同族条目**再改字段；改完立刻 `JSON.parse` 回读。

## 判据的三种"空洞"（任一命中都等于没测）

1. **空输出**：`exit 0` ＋ stdout 空 ⇒ 不是通过、是没跑（把入口主体删空必须报红）。
2. **不点名对象**：只断 `ok === false` / 只断 exit code ⇒ 无法归因（可能"拒错了东西"）⇒ **拒绝必须点名被判对象**（`expect(msg).toContain(<path/名字>)`）。
3. **不验对象形态**：先断言被测对象的形态（数组/长度/首元素）再谈"有值/无值"；下标或嵌套层取错会静默给出 0 或 undefined，账目与判据一起失真。

**同源两条**：①**断言必须盯被测动作真正触及的路径**（本会话一次手改了另一个文件，撤销照常成功、看着像实现有洞，实际是断言看错了地方）；②**测试要跑"提交里的那份代码"** —— 撤回/回退后必须把工作副本（overlay）同步回去，否则绿测跑在不存在于任何提交的代码上。
## 空输出也算红（green-but-empty）

一个 `exit 0` **且没有任何输出**的入口不是"通过"，是"没跑" —— 它比恒红更危险，因为整条门禁链都会照过。2026-10 实测：把整份 gate 脚本用**被截断的 `read` 结果**整文件 `write` 回去，执行体被写成空壳，`--self-test` 与 `--json` 双双**空输出 + exit 0**（`git diff --stat` 形如 `153 deletions, 0 insertions`），CI 会照过。

- **判据要进自证**（别只写在报告里）：运行时入口**必须有输出** —— 自证形末行含 `SELF-TEST OK`；报告形必含对象标识（`face=` / `reason=` / `exit=` / 被判对象名）。
- **一条规则覆盖两个半边**：`exit 0 但 stdout 缺被判对象标识（或缺输出）⇒ 红`。只查"空输出"会漏"有输出但没对象名"，只查对象名会漏"整个入口没跑"。
- **红法**：把入口主体删空 ⇒ 断言必须报红；再让入口吐一行但去掉对象名 ⇒ 同样报红。
- **不可证伪必须显式声明**：`run-gates --drill <id>` 对没声明 drill 的条目 exit 1 ⇒ 要么给仓内夹具根的 drill，要么在册子里**显式**写 `noDrillReason`。实测：给整个册子直接开断言时，**48 条** script 条目既无 `drillCmd` 也无 `noDrillReason` ⇒ 当场把生成器变红 ⇒ 正确处置是**先降级为提示（带清单）＋写明迁移路径**，而不是折中放行或让树红着。
- **提交信息不得声称没落地的东西**：我先写下"已加断言"的 commit message，断言其实**没插进去**（锚点没匹配）⇒ 历史与事实不符，只能 amend。插入动作要**逐锚点打印命中结果**，没命中就改信息或重做。

## 你测的必须是提交里的那份代码

- **撤回/回退后要同步工作副本**：在镜像里撤回了实验补丁却没同步 overlay ⇒ 测试跑的是一份**不在任何 commit 里**的代码（"绿"没有意义）。回退三步：还原文件 → 同步 overlay → 用标志串/哈希确认残留为 **0**。
- **失败归因先 stash**：改完跑全量套件见到多处失败时先别认领 —— `git stash` 你的改动、复跑同样文件，区分"我改坏的"与"既有的"。实测两次：一次是**既有缺陷**（另一处 spec 在 stash 后同样红），一次是**并行负载**造成的假超时（单跑该文件 15/15 全绿）。
- **大套件里的超时读数是可疑读数**（70+ 文件一起跑时出现 5s 边缘失败）：先单跑，再一并复跑"可疑的那几个文件"，最后才谈是不是你的改动。
## Procedure

1. Copy the tree; never mutate the real one.
2. Express each mutation at **line level and line-ending agnostic**: match a line after
   stripping a trailing `\r`, never an anchor that contains the newline.
3. **Assert the anchor matched exactly once** and abort otherwise — a mutation that did
   not apply produces a meaningless "the gate stayed green" reading.
4. Restore all mutated files before the next mutation.
5. Require the **intended** assertion to fail. A red for the wrong reason is not a pass.
6. Record the readings (mutation → failed assertion → exit code), then delete the copy
   and the probe scripts.

## Pitfalls

- **A test double narrower than the real contract makes the guard a no-op too — the mirror of the fat-double failure.** Two measured cases in one round: (a) a fake config that supplied only *some* of the real groups left a knob reading `undefined`, so `size >= undefined` was always false and the cap gate silently never fired; (b) a fixture record was 4x2 while the new cases were written against 8x4, so two of three views fell out of bounds and the red test was measuring the *coordinates*, not the logic. Remedy: derive doubles from the real contract (parse the shipped schema, e.g. `Config(undefined)`), state the fixture's physical facts (dims/enums) in the case and check each against them, and treat "the assertion failed somewhere unexpected" as a fixture bug first.
- **Restore byte-exactly, and re-verify integrity — a green gate does not prove the file is intact.** Two ways this bites: (a) rewriting a mutated source file with a shell string write (`Set-Content` in PowerShell) **re-encodes it** — Chinese comments came back as GBK and the module became invalid UTF-8; the grep/import gates still printed `20/20 通过` because none of them parse the module, and only the unit tests exposed it (`7/7 fail`, `ReferenceError`). (b) Therefore: take the backup as a **file copy** (`Copy-Item x x.bak`) and restore by copying back — never by re-writing the text through a shell; or mutate with the same literal-anchor edit tool you will use to undo it. After every restore run, in this order: `node --check <file>` → that file's direct test → the full gate → the full suite. A green gate alone is not a restore proof.
## Pitfalls

- **A mutation placed in a stripped region is not a mutation — it is a false green.** When the checker calls `stripComments` (or any normalizer) before matching, a payload injected into a **comment** never reaches the matcher: the gate prints `通过/0` and that reads as "the gate caught nothing", when the truth is "the guard was never exercised". Measured twice in one round — `tools.register(` and `writeFile('x','')` inserted into comment lines both reported green; the same payloads moved into **real code positions** both went red. So when a mutation fails to turn a gate red, suspect the **mutation** before the gate, and always place it where the checker actually reads (code, not prose).

- **A file-set gate passes vacuously when its set is empty — and that reads as green, not as an error.** Grep-shaped gates have **three** parts, not one: the match expression, the **file set**, and a **set guard**. Measured: a recursive walker that skipped directories *by name* also ate `lib/tools/` (the directory being checked) ⇒ that rule scanned **zero files** and reported `通过/0` for months of runs, while the whole-tree empty guard stayed green. A set guard asserts a **minimum** count (`<`, never `!==` — more files is normal evolution, fewer is the dangerous direction); when the set is genuinely empty, the right reading is the loud failure (`FAIL E-VACUOUS …少于预期`), not silence. ⇒ Probing a file-set gate means probing **all three**: mutate the code (match fires), delete one member of the set (guard fires), and confirm the guard is red **before** the directory it guards exists.
- **Line endings decide whether the probe works at all.** With `core.autocrlf=true` the
  worktree is mixed — `git ls-files --eol` shows which files are `w/crlf` while the index
  stays `i/lf`. An anchor ending in `,\n` matches **zero** times in a CRLF file, and zero
  matches reads as "the gate does not bite" — a false accusation against a working gate.
- **Cross-contamination.** Restoring only the file you just mutated leaves the previous
  mutation in place, so the reading shows two violations where one was expected.
- **No mutation-applied assertion** is the worst failure mode: a no-op mutation reads as
  a green gate and tempts you to weaken something that was fine.
- **Proving the construct is not proving the wiring.** When the real trigger is not
  reachable (a CI-only condition, a tag ref, an event you cannot fire), run the
  construct's branches locally and **state the boundary** instead of implying the whole
  path was exercised.
- **One mutation per branch, not one overall.** "It can go red" is not "it covers the
  class"; a gate with three independent conditions needs three mutations.
- **The mutation label can be the thing that breaks.** A rule description written as a template literal with CJK type-parameter brackets — `` `…（ctx.<服务>）…` `` — is read as **interpolation** and throws `ReferenceError: 服务 is not defined` at load, so the gate dies before any mutation runs (measured: the label alone took the checker down). Two rules: never put `<name>` inside a template literal or backtick-quoted text in code, and — before trusting a green reading — confirm the gate **ran at all** (a crashed gate and a silent one both show up as "no violations printed").
- **Some doors cannot be probed.** If a check has no reachable mutation, say so plainly
  rather than inventing one that proves nothing.
- **A gap report is a claim about your check, not about the world.** Before believing a
  sweep that suddenly finds gaps, falsify the check itself: is the target path right (a
  root-relative name for a file that lives under `docs/` yields an empty string, and every
  check against it "fails")? Is the pattern anchored on the sentence the document actually
  writes, or on the wording you expected? Is the thing you are hunting even in that file,
  or does the spec delegate it elsewhere ("section 3.5 of *that* file is authoritative")?
  Measured: a 26-check sweep reported 4 gaps and **3 were the probe's own errors** — wrong
  file, wrong target, over-literal pattern. Only one was real. Report the split, and never
  let your own false positive become a "fix" to a document that was already correct.
- **When a value and its schema are a pair, the failure message will not name the missing key — diff the key sets instead.** A consuming validator that matches against several alternative branches reports the generic `must match exactly one … (matched 0)`. Do not read that as "something upstream broke": it usually means **one key declared but absent from the value, or present but undeclared** (measured: an undeclared `levels`, then an un-declared nested object). Ten-line probe that ends the guesswork: `Object.keys(value).filter(k => !(k in schema.properties))` and the reverse, run against the branch the value is supposed to match.
- **Flat scalar keys survive schema subsets that nested open objects do not.** Measured: a nested `{type:'object', additionalProperties:true}` field failed the platform's output schema subset even though every key matched, while the same facts expressed as `decode_channels` / `decode_scaled` / `decode_notices` validated immediately. When reporting structured facts to a model through a constrained schema, **flatten** — it is easier to declare, easier to validate, and easier for the reader.
- **A rollback is a change: verify the module still holds together, not just that the block is gone.** Removing an added block can leave a **dangling call to the very thing you added** (measured: an edit left `regionOf` calling a module it could never import ⇒ `ReferenceError` ⇒ 25 tests red), and the fix attempt that replaced a helper body outright silently dropped the **undefined-input branch** (`if (!region) return …`), which every whole-image call needs. Two habits: after reverting, run the suite **and** re-read the function you touched as a whole; replace the **entire** function body rather than the line you think is wrong.
- **Never "clean up" a multi-line structure by deleting lines; never claim a pair is updated when only one half is.** Two measured failures from one round: (a) an `edit` that replaced a single line but dropped a multi-line array item's closing brace left the file as a **syntax error** — and syntax damage hides better than logic damage, because a static criteria script stays green and only `node --test`'s file-level failures expose it; (b) filtering lines by content to tidy the wreckage also removed **adjacent closing braces**, taking a second file down with it. Rules: express every structural change as an exact text replacement of the **whole** block; when a value and its schema/type declaration are a pair, edit them in the **same** change and re-run that pair's validator immediately — the symptom of a half-updated pair is a generic-looking "must match exactly one of …" from the consuming gate, not a message naming the missing key. Recovery that works: print the damaged region line-by-line (escaped), restore the deleted brackets/statements from what the surrounding code requires, then re-run both gates.
- **A gate must assert the *target*, not a proxy that happens to hold today.** Measured: the assertion guarding a control-surface convergence encoded "this group has no advanced items" — a *structural* fact that was true only as a side effect of the layout, so when the convergence was finished by moving one control, the assertion failed while the goal was actually met. Rewriting it as "the first screen shows exactly N controls" made it track the requirement itself. Test: read each assertion and ask *which requirement would still hold if this passed for the wrong reason?* If the assertion names a shape rather than the property you promised, it will fight you at the first legitimate change — and it will not catch the regression it was written for.
- **Style-level defects need a style-level gate, or the fix is only a belief.** Measured on a client stylesheet: two literal colours (`color:#fff` on a primary button — unreadable in dark mode; a focus ring drawn with the brand colour instead of the focus token) were fixed, and then **reintroducing them left every gate green** — the test file passed and the static criteria passed. Hard-coded colour/geometry values are invisible to behaviour tests by construction, so the class needs its own rule: "client-side files may use only the platform's semantic tokens (`var(--dsw-*)`), no literal colours", plus a **red proof** (put the literal back ⇒ that rule must go red). Generalisation: after fixing anything whose correctness is *visual*, ask which mechanical rule would have caught it — if none exists, the fix ships as an assertion of faith.
- **A presence check can be fooled by prose.** "Does the file contain X?" is satisfied by a **comment, JSDoc line, or fixture** — the same false-green class as a gate that passes on an empty file set. Measured: a guard written as "the entry already imports the new module" matched the **path string inside a comment I had just written**, so the missing `import` line survived until six composition tests died with `ReferenceError`. Rules: check **structure** (an import statement, a parsed symbol), never a free-text appearance; write such guards as a real parse/regex on statement position; and after adding any guard, re-run the suite — a guard that passes is exactly when you stop looking.
- **Quantized/re-bucketed values need a *crossing* choice, or the gate is decorative.** When the thing under test quantizes (rounding, color depth, bucketing, hashing into bins), pick a mutation that lands in a **different bucket** — otherwise the "changed" input produces a byte-identical reading and the gate passes for the wrong reason. Measured: a 4-bit path maps 119 and 127 to the **same level (7)**; a reverse gate written with 120 proved nothing until it used **140** (→ level 8). Companion check for *expected* values: five minutes with a one-off probe beats an argued formula — a hand-derived expectation was wrong twice in one file (the sampling grid hits pixels **1 and 3** for 2 columns over 4, not 0 and 2), and only the probe caught it.
- **Probing both directions.** Mutation proves a gate can go red; a falsified sweep proves
  it can go red *for the right reason*. A check without the second half manufactures work.

## The blast radius uses the same rule as the product

When a shared value moves into a new module, the wiring points are **not** just production: every
hand-built test double that assembles its own dependencies must gain the same key, or the tests fail with
`TypeError: <fn> is not a function` — measured: one new module ⇒ **six** test files needed the new key, and
the failure surfaced only in the composition tests (the ones that actually call `apply()`). Two habits:
1. Prefer **one shared deps builder** over per-file doubles; where a file insists on its own, keep the "two
   assembly points" rule explicit (production + the shared double) and let a wiring gate enforce it
   (`工具读的每个 deps 键，两个装配点都注入了` — it catches the half-wired case for you).
2. Grep for **the dependency-object shape** (`sessionIdOf`‑like keys), not for the filename, to enumerate
   the affected doubles — the filename may appear in comments (see the presence-check pitfall above).

## Declaration vs implementation: the gate nobody writes (2026-10-13)

- Symptom: a contract (output schema / parameter declaration) and its implementation are **each internally consistent** but disagree with each other. Two instances surfaced in one round: the renderer read a key the return value **never contained** ⇒ a false "auto-degraded" warning printed on **every** successful call; a parameter whose only legal values were 4/2/1 was declared as a **free integer** ⇒ the declaration was wider than the implementation.
- Mechanism: behaviour tests ask "what did the function do", never "what did the declaration say". Neither defect turns any behaviour assertion red — so both survive a green suite indefinitely.
- Three mechanical rules that catch the class: ① **returned key set ⊆ keys declared in the output schema**; ② **every key the render/presentation layer reads must actually exist** (check the object key by key, not by name-matching the source); ③ **a parameter with a finite value set must carry `enum`** — the platform's own schema compiler can check this, so land it in the existing real-compiler gate rather than a new scan.
- Red proof: delete the key (or the enum) ⇒ the new rule must go red; note that running only the behaviour suite stays green — that gap is exactly what the rule exists to close.

## Placing a new rule, and the two ways it silently stops working (2026-10-13)

- **Reuse before adding.** Before writing rule N+1, check whether an existing gate already enforces it. Measured: the intended rule "returned keys ⊆ declared schema" was **already** covered by an output-contract test that pushes every return path through the platform's own validator — its header comment even stated that rationale. Writing a second rule for it would have been synonym duplication (a defect in that repo), so the correct action was to *cite* the existing gate and only add the two rules nothing covered.
- **Put a rule where the enumeration already exists.** The uncovered rule ("the renderer must not read keys that do not exist") had no runtime authority — the render only runs in the host UI. Instead of a brittle static key scan, extend the test that **already iterates every return path** with one line: actually call `render(args, value)` and assert the rendered text contains no `undefined`/`NaN`. Zero new fixtures, and the failure names the exact defect. Rule of thumb: *a declaration-shaped defect wants a dynamic gate over an existing enumeration; only use a static scan when no enumeration exists.*
- **Trap 1 — locating an array by "the last `]`" splices into the wrong array.** Measured: inserting a rule that way landed it inside a later `EXPECTED_SETS` literal, producing a runtime `object is not iterable` instead of a syntax error. Locate by "from the anchor line, the first line that is exactly `]`", then read the region back.
- **Trap 2 — a regex-source string that round-trips through a file loses one escape level.** `new RegExp("\\b" + name + …)` written with one backslash too few becomes JS's **backspace** escape (U+0008): the rule compiles, matches nothing, and dies silently. Use `String.raw` when writing such lines, or print the line back and count backslashes. A **vacuity guard** ("if zero candidates found anywhere, report a violation") is what turns this silent death into a loud one — every rule keyed on a code pattern should ship with one.

## After moving copy into a dictionary, the FIXTURES are the enforcement point (2026-10-13)

- When user-facing strings move into a dictionary, every test that asserted the old literal keeps passing only if the fixture **resolves keys the same way production does**. Upgrade the fixture instead of weakening the assertion: give the fake platform a `register`/`bind` pair that **stores the dictionary and looks keys up** (falling back to the key name, so a missing entry still shows up as a bare key). Measured: with that fixture, three component assertions instantly became proof that the copy comes from the dictionary — write a literal back into the component and they go red.
- **An orphan-key gate must count every usage form.** Introducing "the model carries keys" added a third form — a key passed as a plain string literal (`{ key: 'save.failedTransport' }`) instead of `t('…')`. The existing orphan check only knew the `t('…')` form, so two live keys were reported as unused. Fix the rule (count any occurrence outside the dictionary block) rather than contorting the code to look like the checker.
- **Red proof for a bilingual dictionary is a one-line insert**: add a key to one language block only ⇒ the parity assertion (and the orphan assertion) must fail; remove it ⇒ green. Keep this as the standard probe whenever a dictionary grows.

## When a layer grows, raise the floor — deletion is the dangerous direction (2026-10-13)

A repo health check that counts files per layer should compare with `<` and be **bumped the moment the layer grows**: e.g. a `lib/ops/` expectation raised from 1 to 3 when two modules were added. Rationale (worth stating in the check itself): *adding files is evolution; losing them is the risk* — without the bump, someone deleting or relocating one module silently shrinks the surface that every other rule scans, and the suite stays green. Pair it with the existing vacuity guard so an empty set can never read as "no violations".

## Scope a symbol-keyed rule to an explicit consumer set, not "everything that mentions it" (2026-10-13)

- Symptom: a wiring rule that verifies "every `deps.X` a module reads is injected at both assembly points" was widened to scan **all** source files for tidiness. It immediately produced four violations for `deps.images` / `deps.resolveEviction` read by a module that has **its own** `deps` parameter — a *consumer-defined* contract that has nothing to do with the assembly.
- Rule: when a check keys on a **symbol name**, scope it to the files where that symbol carries the meaning the rule assumes. Keep the set as an **explicit list constant** with a comment naming who must be added when a new consumer appears ("otherwise this check is silently blind to it"). A broad glob reads as stricter but is simply wrong, and its false positives train people to ignore the rule.
- Companion observation: that same round, deleting the key from the **shared** test-double helper left the feature's own test file fully green (it builds its own dependency object), while the wiring rule named the exact read site. Keep such rules even when tests pass — they cover the consumers tests do not.

## Trap 3 — inserting a new test *inside* an existing one silently orphans its tail (2026-10-13, third occurrence)

- Symptom: anchoring on the last assertion of a test block and appending new `test(...)` blocks there splits the original block — the remaining assertions end up **after** the new tests, and the file dies with `SyntaxError: Unexpected token '}'` (or worse, keeps parsing and never runs them).
- Fix: locate with the syntax checker first (`node --check <file>` prints the exact line), then **rebuild the whole region in the intended order** rather than patching braces piecemeal. Anchor insertions on a *blank line after* a complete block, never on a line inside it.
- Related authoring note: assert **the link, not the constant**. `observed.version === DECLARATION.version` makes the test prove the wiring; `observed.version === 1` lets "declaration changed, consumer didn't follow" pass green forever.
- And when a value is a *composite* (an id, a dedup key, a path), assert **containment of the meaningful segment**, not its position: positional assertions make the test vouch for the implementation's layout, so any legitimate reshaping breaks the test while a wrong-but-aligned value passes.

## A mutation that leaves an equivalent guard in place is NOT a red proof (2026-10-13)

- Measured: disabling one of two mirror-image guards (the check for raster A) left the identical check for raster B still firing on the same input, so the new test stayed green — the "red proof" proved nothing.
- Rule: before recording a red proof, state **which single line is the only thing standing between the input and the failure**, and remove exactly that. If two symmetric branches guard the same case, remove both. Otherwise the mutation is vacuous and the test may be vacuous too.

## Pinning a known gap as a fact: write the update condition into the test (2026-10-13)

- Pattern that paid off: a frozen fixture asserted the *current, known-wrong* behaviour and its comment said — in so many words — "when this becomes explicit in the return value, this assertion changes too". Months later the gap was closed and the test told us exactly what to change. **A test that documents a known gap should carry the condition under which it must be rewritten**; otherwise the next person deletes it as an obstacle.
- Corollary that bit immediately: closing such a gap can **remove the only coverage of a success path**. Here the silence *was* what let a fixture's inconsistent inputs (metadata says 10×10, decoded raster is 8×4) pass through the happy path; with the gap closed, that path started failing and the contract gate reported "no case reaches ok:true" — which is the gate doing its job. When you close a tolerated-failure gap, grep the fixtures for inputs that were only ever accepted because the failure was tolerated.

## A rule that bans a lexical feature must scope the regions where that feature is legitimate (2026-10-13)

- Measured failure: a new rule banned "Chinese string literals in the client component layer" (to force user copy through the translation dictionary). It fired on six strings inside the **settings form spec region** — `'token（估算）'`, `'字符'`, `'字节'` — which are the **source of derived dictionary keys**, not untranslated copy. The rule was demanding deletion of the very data it depends on, and the repo's own locale test derives keys from that same region.
- Rule: before shipping a rule that bans a **lexical shape** (non-ASCII text, hardcoded strings, snake_case, colours), enumerate the regions where that shape is *legitimate by design* — key sources, fixture tables, developer logs, comments — and decide **mechanically** whether each can be delimited. If a region cannot be delimited (here: "is this literal a key or copy?" requires following the render path), then either whitelist the region explicitly (accepting the reduced power) or drop the static rule in favour of a dynamic check that traces what actually reaches the user.
- **Do not ship a rule with known false positives.** The tree convention is "gates green"; a red rule with exemptions trains the next person to disable it. Measured handling: the rule was withdrawn, its finding recorded, the tree restored to green (`16/16`, `325/325`), and the rework ordered as "read the render path first, then design to a mechanically decidable subset".
- Red-proof requirement for this family: include the **negative** case — add a value to the whitelisted region and assert the rule does **not** fire. Without it, the exemption will quietly grow until the rule checks nothing.

## 门禁自身的"成功路径"也要测（2026-10-14）

`pretag-gate.mjs` 的架构守卫那一步读的是 `String(out).match(/…\[warn\]: (\d+) architecture guard violation/)[1]`。**干净运行（0 violation）时脚本根本不打印 `[warn]` 行** ⇒ `match` 返回 `null` ⇒ `null[1]` ⇒ `Cannot read properties of null (reading '1')` ⇒ **"检查通过"被判成 FAIL**，且 catch 分支把 detail 写空 ⇒ 看上去像"守卫坏了"而不是"守卫没问题"。
⇒ **判据**：门禁的 self-test 必须**同时覆盖红路径与绿路径**（这条绿路径此前从未被执行过）。改法：`const warn = out.match(…); const violations = warn === null ? '0' : warn[1]`。

**解析别人输出的门禁必须钉对方版本与输出形态**：同一门禁用 `^x <rule>/` 解析 oxlint，而 1.76.0 打印 `x @stylistic(arrow-parens): …` ⇒ 解析出 0 条 ⇒ detail 变成 `(unparsed)`，**失败信息从此不具可操作性**。⇒ 读数里带被解析工具的版本；解析器要么放宽（`^[x×]\s+\S+:`），要么显式声明"版本不符 ⇒ 该读数不作判据"。

**附：本会话第四次踩"把新用例插进已有用例里"**（见上文 Trap 3）—— 用 `lastIndexOf('})')` 定位"文件末尾"会把新测试插进**最后一个测试体内部**（vitest 报 `Calling the test function inside another test function is not allowed`）。⇒ 追加测试**一律追加到文件真正的末尾**（或先按注入文本整体移除再 re-append），**不要用"最后一个 `})`"定位**。

## 构造红：先断言"场景真的出现"，再断言结论（2026-10-14）

独立复验发现缺陷后，我加了一条不变量并宣布"覆盖了"。**变异测试**（把缺陷放回去）⇒ 断言**仍然全绿** ✗ ⇒"覆盖"不成立。
⇒ 规则：**任何新加的判据都先做一次变异测试**；红不了就是夹具没造出场景，**不是**"缺陷不存在"。

**构造场景时，必须先把"场景真的发生了"写成断言**（例：断言"这个单元确实铸过 baseline"）。本会话两次夹具尝试都因此**当场被拦住** ✗ —— 没有那条守卫，夹具会因为"结论恰好成立"而通过，我就会宣布"红已建成"。

**构造这类场景的通用手法（本会话唯一成功的一次）**：当判据需要"**盘上有字节、但索引里没有**"时 ⇒ **用 `node fs` 直接写文件绕过库 API**，再让库去碰这个路径（例：直写 `references/x.md`，再 `restructure(..., toFile: 'references/x.md')`）⇒ 该 landing 的 `previous` 不在索引里 ⇒ **基线分支被触发** ✓。造完**先把"场景真的出现"写成断言**（例：`hasBaseline`），再写结论断言 ✓。

**变异必须验证"变异真的生效"** ✗：本会话把缺陷改回去时，锚点取自**修改前**的文件 ⇒ 编辑失败（`mutate ERR`）⇒ 紧接着跑出来的"全绿"其实是**未变异代码**的结果 ✗。⇒ 应用变异后**先确认它落上了**（回读那一行／grep 特征串／看编辑是否报成功），**再看测试结论**；否则"绿"证明不了任何事 ✓。

**"造不出场景"要分成两层说**（2026-10-14 由独立复验校正）：「**不变量层面可达**」（守卫断言的存在本身就是构造证明）＋「**功能性后果当前无消费者可达**」✗ —— **不要**写成"不可构造" ✗。构造红若一时搭不出来，**保留该红作见证**（不许因"后果不可达"删红），并写明"产生第一个消费者时该红必须仍生效"。若公开 API 造不出该场景（例：每次写盘时该路径的最新条目都在索引里 ⇒ 基线分支不触发；要触发需"盘上字节存在但从未被索引"，而**没有公开 API**），就把缺陷定性为**潜伏且当前不可达**（修复＝防御性硬化），并在台账里写清"可达性未证实" ✓ —— 这比删掉发现、或假装已覆盖，都更可信。

## Verification

The real tree is green and unchanged (`git status` clean, or hashes identical to the
pre-probe reading), the copy and probe scripts are gone, and every recorded reading names
both the mutation and the assertion that failed.
