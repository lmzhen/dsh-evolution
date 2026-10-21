---
name: dsh-evolution-platform-seams
description: 改平台接缝前对齐事实：座位图、契约前置条件与上游对照。
---

# 改平台接缝前先对齐事实

DSH 插件与宿主之间的接缝（工具注册、技能目录、审批、profile/预设、会话存储）一旦判断错，
改出来的东西会在另一面静默失效。本技能给出**对齐事实的固定次序**、**权威来源**与**已知坑**，
并说明改动前必须确认的四条前置条件。**不负责**实现细节（那属于具体插件），也不替代平台自带文档。

## 何时用

- 准备改平台的公开面（工具定义、技能装载、审批流、profile 结构、会话/存储路径）；
- 怀疑平台行为变了（升级后行为不一致、审批提示消失、技能目录变了）；
- 要写"与平台契约相符"的判据或门禁规则；
- 需要在两个宿主面（桌面 19387 / web 3080）之间做对照。

## 前提：权威来源的读取次序（禁止逆向猜）

1. **平台自带文档与技能**（最先读，用户的硬要求）：平台实现检出在
   `D:\Apps\DeepSeekHarness\resources\app.asar\dsh\`（**注意：这是 asar 包，只有 Node 能读** —— `readdirSync` 可用，而 `Test-Path`／`Get-ChildItem`／`rg` 都会说"不存在" ⇒ 别据此判断"平台实现不在本机"），以及宿主自带的技能目录（**原生可读**，等价权威面）；
2. **同机自家老项目**：本仓库的既有插件（`packages/evolution-*`）怎么调用同一个接口；
3. **其它插件的源码**：第三方插件在相同接缝上的写法；
4. **最后才是自己动手**。任何时候都不要用"看起来应该这样"替代前三步。

## 快速参照

| 项 | 值 |
|---|---|
| 桌面面 | 端口 19387，home `C:\Users\<你>\.dsh`（本会话所在面常为它） |
| web 面 | 端口 3080，home `D:\dsh-homes\web`（原版 + dsh-web） |
| 两面关系 | **不互见**：技能目录、profile、会话各自独立；改一面不影响另一面 |
| 家族镜像（唯一写入面） | `D:\dsh\dsh-evolution-mirror` |
| 构建线覆盖层 | `D:\dsh\deepseek-harness`（`packages/evolution/**` **未跟踪** ⇒ 判同步用哈希） |
| 同步工具 | `node D:\dsh\_tools\sync-mirror-to-dev.mjs` |
| 家族 spec 唯一入口 | `npx vitest run -c D:\dsh\_tools\vitest-family-preflight.mjs <spec>` |

**座位图（家族评审的常驻八席，改动接缝前先看谁在管）**：Lead（综合与定序）／存储席（版本、索引、单元与剪枝）／
架构席（接缝与结构裁定）／门禁席（判据与台账）／场景席（真实使用场景与载荷）／模型面席（目录、描述、上下文成本）／
UI 席（面板与文案）／工具链席（构建、发布、脚本）。

## 步骤

1. **锁定对象**：写清"哪个接口、哪一面、哪个版本"，并给出 `file:line` 或命令读数；
2. **读权威面**：按上面四步次序读；把平台侧实现读成**结构化事实**（函数签名、参数、返回、错误分支），
   不是"大概是这样"；
3. **跑一次现状**：用最小命令证明当前行为（例如列出技能目录、打印一次目录消息、跑一个家族 spec），
   记录**命令 + 读数**；
4. **确认四条前置条件**（缺一不要动手）：
   (a) 它是平台的**公开面**还是内部实现（内部实现改动要按平台版本走）；
   (b) 当前版本与目标版本，版本差异列清单；
   (c) 是否**两面都要改**（桌面/web 各自验证）；
   (d) **回退路径**：改坏了怎么退（备份文件、`git checkout -- <path>`、或删桩）；
5. **先钉判据再改码**：写一条现在**为红**的断言（`it.fails` 或门禁规则），实现后翻牌 ⇒ 翻牌即证据；
6. **改完立刻自证**：跑判据 + 一次解析自检（`vitest` 或 `node` 加载），再提交；
7. **记账**：把"已完成的步骤 + 当前代码基准（HEAD、树是否干净）+ 残余清单"写进计划文件。

## 坑（都踩过）

- **两面不互见**：在 web 面验证过不等于桌面面可用；反之亦然。断言里要写清 `face=`。
- **`dsh.ps1` 被执行策略拦（PS 5.1 判据）**：**2026-10-15 起 DSH 的 `pwsh` 工具是 7.6.7／RemoteSigned，实测裸 `dsh` 可用**；只有显式 `powershell.exe`(5.1, Restricted) 才必须 `dsh.cmd`；
  且 `--profile desktop` 会报 `profile "desktop" is managed exclusively by the Electron application`（CLI 不能引导桌面面）。
- **构建线覆盖层未跟踪**：`git status` 在覆盖层看不出家族改动；判"是否已同步"要用**哈希**。
- **读文件会静默截断**（>2.8 万字符）：整文件重写前先断言"读到的字符数 == 字节数"，大文件只追加。
- **PowerShell 先解析整条命令再执行**：命令里任何一处语法错 ⇒ **整条都不执行**（容易误以为某步已做）。
  关键动作单独发一条命令；非 ASCII 或转义引号一律写脚本文件再跑。
- **asar 只对 Node 可读**：`…\resources\app.asar\dsh\` 用原生命令（`Test-Path`／`Get-ChildItem`／`rg`）会得到"不存在"，用 Node 的 `readdirSync` 才 3 项 ⇒ 查平台实现**走 Node**，或改查**已装闭包**；否则会误判成"本机没有平台实现"。
- **平台服务的作用域：插件挂的服务，父 ctx 看不到。** cordis 的 `ctx.plugin(P)` 在 **fork** 上运行 P，服务注册在**那个 fork**（`Service` 子类的 `super(ctx, 名字)` 注册点即构造处），provide **只对自身与后代可见**。⇒ 家族读者一律 `ctx.get(名字)?.…`，拿不到就按设计"**无法测量**"降级 ⇒ 表现为**整片 spec 静默失败**（"流水线什么都没做"），而不是报错。
- **判"服务缺席"之前先证作用域**，否则会把接缝问题误判成产品缺陷。三步定案：①读平台插件类是否声明 `inject`（无 ⇒ 无条件 apply ⇒ 服务必然存在，只是不在你能看到的 ctx 上）；②在**两个互不相干**的夹具里探针 `ctx.get(名)` 与 `ctx.名字`（两种取法一致才算数）；③临时用 `new 服务(ctx)` 在**消费方自己的 ctx** 上注册一次，看那条断言是否由红转绿——转绿即作用域定案。
- **家族 spec 的夹具修法（已验证）**：在每处挂载平台依赖之后加一行幂等注册 `if (ctx.get(名) === undefined) new 服务(ctx)`（判空防重名抛错），并**按用例逐个插**——只插文件里第一处会漏掉"每个用例自建 ctx"的文件（实测 73 → 2）。
- **别按名字理解标识符，要追它的消费点**（"不要望文生义"）。同一个词在两个子系统里常指两件事：`contextMode:"fork"` 看着像"fork 对话"，实际是 **bootstrap 文件过滤器**；真正的会话分支是另一个网关方法 `sessions.fork`。判法：把标识符 grep 到**赋值处与消费处**，读消费处的函数体，再下结论。
- **能力边界先于设计**：在动手前先证"这条通道能不能拿到我要的东西"，否则会把"平台没给"误判成"实现没写"。跨平台一份拆解（OpenClaw 插件运行时的子智能体三通道、两个 fork 的语义、活跃运行门禁）：`references/plugin-runtime-subagent-and-fork.md`。
- **探针插件是验证平台 API 的唯一手段，但它自带两个坑**：①插件目录解析不到 `typebox`（宿主装在自己的 `node_modules`）⇒ 放一个转发模块；②`registerTool` 的 `ToolDefinition` **`label` 必填**、工具名必须同时写进 manifest 的 `contracts.tools`。取证时**按 `runId` + 时间对齐 `[model-fetch]` 行**判断"谁发了这次请求"，不要按先后顺序猜。完整形状、依赖修法与取证法：`references/openclaw-probe-plugin-authoring.md`。
- **平台缺陷不提 issue**：从源码枚举触发条件，沉淀成技能或判据。

## 验证

对齐事实是否成立，用**一条可跑的读数**自证，例如：

```powershell
# 技能目录是否真的在目标面（face=desktop）
Get-ChildItem "$env:USERPROFILE\.dsh\skills" -Directory | Measure-Object | Select-Object -ExpandProperty Count
# 家族 spec 是否可跑（唯一入口 + 按文件跑）
Set-Location D:\dsh\deepseek-harness
npx.cmd vitest run -c D:\dsh\_tools\vitest-family-preflight.mjs packages/evolution/evolution-core/tests/unit-head.spec.ts
```

读数必须**成对出现**：判据（"目录里应有 N 个技能"）＋实测值；缺一即标"未核实"。
