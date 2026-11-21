# tool-skill-manage 审计

审计对象：`D:\dsh\dsh-evolution-mirror` @ 564431ac；平台权威源码：`D:\dsh\harness-rc3`。
范围：`packages/tool-skill-manage/src/**` `tests/**`、`packages/evolution-skill-discovery/src/**`、
`packages/evolution-skill-health/src/**`、`packages/evolution-commands/src/**`（skill_manage 相关与公共命令接缝）。
只读审计，未改源码。

## 结论

工具主链路（注册 → 参数校验 → admission 门禁 → approval staging → 单一 write provider → 结果渲染）
整体接缝正确，HEAD 的 plan/provider 化已把 5 个内容写动作的并发语义收敛到 `SkillWritePlan` + target 锁。
但仍有 **6 个 P1**，全部是「机制与宣称不一致」而非风格问题：

1. read-before-write 的证据在真实平台事件形状下把**失败的 skill 读取算成成功**，门禁在测试里绿、在宿主里可被绕过；
2. approval staging 只给 5 个动作存 plan，`delete/restructure/extract` **无 plan、无 anchor**，extract 的预览与实际回放不是同一份字节；
3. `action=list` 只把数量渲染给模型，名字放在模型不可见的 canonical value 里，与工具描述「list returns names only」相反；
4. 模型必填的 `summary` 在 5 个内容写动作上只校验、不落库（history 里是 host 兜底文案）；
5. `strictCrossSource` 开启时，空库/空视图被当作 unknown，**连第一个 create 都会被拒**，且无测试覆盖；
6. 设置「只紧不松」的 `internal/config` 钩子用的是 cordis 4.0.x 的调用约定；platform 权威树是 cordis 4.1.0，
   `this` 为 null、fiber 改从首参传入 → 该规则在目标平台上**恒不生效**（第 1 条同类：测试按实现期望的调用方式驱动接缝）。

P0 = 0（按「数据不可恢复 / 越权 / 泄密」口径；若沿用仓库对写入门禁的定级先例——P1.13 并发 patch 被定为已发布 P0——第 1 条可升 P0）。
另：`evolution-commands` 的 `/evolution` 命名空间两套解析器、`evolution-skill-discovery` 每 pre-step 两次整树扫描，见 P2。

## P0

无。

## P1

### P1-1 read-before-write：失败的 skill 读取被计为「读过」（门禁可绕过）
- 平台写点 `harness-rc3/packages/core/tools/src/batch.ts:255-265` 把 `tool/result` 落成
  `{turn, step, message: ToolResultMessage, error?: info}`；失败标志在 **`message.isError`**
  （`harness-rc3/packages/llm/llm/src/message.ts:299-307`），payload 顶层**没有** `isError`。
- 家族归一化器只读 `data.isError`/`data.error`/message.content 里 `type:'tool-result'` 的 block
  （`packages/evolution-core/src/tool-dispatch.ts:164-184`）。普通 `Error`（非 HarnessError、无 `error.info`）
  不产生 `data.error`，也找不到 `tool-result` block → `ok` 判成 **true**。
- 后果链：`skillReadNameOf` 从 call 参数取名字（`tool-dispatch.ts:529-538`）→ `collectReadSkillNames` 把失败读取
  放进 read 集合（`555-562`）→ `READ_BEFORE_WRITE` 放行（`write-gates.ts:322-350`，调用点 `index.ts:1544-1550`）
  → 非前台写入可**盲改**模型从未读到的正文；同一 `ok` 也把失败读取计成 usage view（`usage/index.ts:148-158`）。
- 测试为何绿：`tests/write-gates.spec.ts:33-39` 的 `readFrames()` 在 **payload 顶层**伪造 `isError: failed`——
  平台从不写这个字段；这是测试**自造了实现依赖的形状**（同类见 P1-6）。
- 定级：gate 的安全目标（v32 REV-06(a)「failed/timeout read 不得通过」）在生产形状下失效；历史版本可恢复，
  故记 P1（按 P1.13 先例可升 P0）。

### P1-2 approval staging：`delete/restructure/extract` 无 plan 无 anchor，extract 预览不绑定回放
- staging 只为 4 个动作写 `staged_from_sha256`（`index.ts:1603-1663`）；`planFromStaged` 对
  `delete/restructure/extract` 返回 undefined（`index.ts:281-323`）。
- replay 仅在「无 plan 且是内容写动作」时拒绝旧记录（`index.ts:281-283`、`1740-1742`）→
  上述 3 个动作走 `executeCore(operation)`，在**批准时刻**重读/重规划当前字节（`index.ts:1743-1744` → `1111`/`1138`/`1187`）。
- extract 更糟：预览按 staging 时字节算出前后 diff（`index.ts:389-415`，测试
  `tests/approval-preview.spec.ts:114-131` 明确覆盖），但回放重新调用 `buildExtractPlanFromLibrary` 从当前库重算
  （`index.ts:1169-1175`）——操作者批准过的 diff 不是最终落盘的 diff；restructure 预览直接
  `available:false`（`index.ts:416`），操作者**盲批**。
- 同时违反仓库自己的目标文档：`docs/developer/architecture-optimization/skill-write-single-provider.md`
  §2 原则 4/6/8.1（intent 必填、pending 存完整 plan、replay 不再按 action 拼 anchor）。

### P1-3 `list` 不把名字给模型
- `executeCore` 的 list 分支返回 `skills: list.map(s => s.name)`（`index.ts:986-993`），但
  `output.render` 只渲染 `ok/message/proposal`（`index.ts:1456-1468`），message 只有
  「已列出 N 个技能。」；canonical `value` 对模型不可见（平台 `harness-rc3/packages/core/tools/src/pipeline.ts:545-575`
  只把 `render` 结果作为 content 面）。
- 工具描述写着「list returns names only」（`index.ts:1422`）。模型调 `action=list` 得不到任何名字，
  与 `review` 的完整列表形成重复入口。全部测试只读 `result.value`，没有一条断言渲染文本（如
  `tests/tool-skill-manage.spec.ts:497-500`）。

### P1-4 模型必填的 `summary` 在 5 个内容写动作上不落库
- `summary` 在 `executeCore` 被规范化并作为 `change`（`index.ts:949-960`），但只传给
  `delete/restructure/extract`（`index.ts:1111`/`1138`/`1187`）；create/update/patch/write_file/remove_file 走
  `planCreate/planUpdate/planPatch/planWriteSupport/planRemoveSupport`（`index.ts:1061-1127`），这些 API 没有
  summary 参数（`packages/evolution-core/src/skill-write-service.ts:89-241`）。
- staging 的 plan 其实带了 summary（`index.ts:291-323`），但单 op `apply()` 只把 `origin` 传给 mutator，
  `plan.summary` 只在 `applyMulti` 使用（`packages/evolution-core/src/skill-store.ts:4039-4057` vs `4139`）；
  各 mutator 把自己的 auditSummary 写死成 `'created'`/`'updated'`（`skill-store.ts:2134`/`2279`），history 走
  `hostChangeSummary` 兜底（`skill-store.ts:1764-1772`）。
- 结果：模型被强制提供 summary（patch 缺则 E；结构的后台写缺则 E，`index.ts:967-975`），描述里承诺「for the
  skill history」（`index.ts:1445`），但历史里永远是 host 文案。删除/restructure/extract 正常。

### P1-5 `strictCrossSource` + 空目录视图 = 拒绝一切写入（含第一个 create）
- `catalogWinner` 把 `summaries.length === 0` 判成 `probeUnknown`（`index.ts:877-893`）；
  `crossSourceRefusal` 在 strict 下对 unknown 直接拒绝（`index.ts:837-857`）。于是空库/空视图（首个 create、
  或 preset 视图未发布）会返回「cross-source check could not be performed … fix the catalog view」并永不写成功。
- `strictCrossSource` 是用户可改的 write 设置（`index.ts:150-171`/`738-748`；`tests/skill-settings.spec.ts:30` 仅给默认值）；
  「读不到」与「读到但是空」是两种事实，空且可读的视图应回答 `probePresent({winner:undefined, view:[]})`。

### P1-6 设置「只紧不松」规则在目标平台恒不生效（cordis 事件调用约定漂移）
- 家族钩子 `ctx.on('internal/config', function (this: Fiber, _previous, next) { … if (this !== ctx.fiber) return value; validate… })`
  （`index.ts:807-818`）；平台权威树 cordis 4.1.0 的发射点 `fiber.context.waterfall('internal/config', fiber, () => config)`
  （`harness-rc3/vendor/cordis/src/fiber.ts:678`），`_resolve` 只在**首参是对象/函数**时把它当 thisArg
  （`harness-rc3/vendor/cordis/src/events.ts:162-171`）——这里首参是事件名，于是 thisArg=null，fiber 作为
  **第一个 listener 实参**传入；`Reflect.apply(callback, null, [fiber, next])`（`events.ts:246-260`）⇒ `this===null`，
  `this !== ctx.fiber` 恒真 ⇒ **校验永不执行**。平台自家监听器已按 4.1 改成读首参
  （`harness-rc3/packages/llm/llm-pi-ai/src/index.ts:198-207` 用 `(fiber, next) => fiber !== ctx.fiber`）。
- 家族开发机 cordis 4.0.5 用旧约定（`waterfall(this, 'internal/config', config, next)`，`node_modules/@deepseek-ai/cordis/src/fiber.ts:641-643`；
  旧 platform 的 llm-pi-ai 也写 `function(this: Fiber…)`，`harness-0.2.1/packages/llm/llm-pi-ai/src/index.ts:177-179`）——照抄了旧版。
- 测试为什么绿：`tests/skill-settings.spec.ts:119-129` 用 `ctx.waterfall(ctx.fiber, 'internal/config', …)`，即**显式传
  thisArg 的旧调用方式**（4.1 的启发式仍接受），只证明 listener 逻辑、没证明平台发射路径。
- 后果：`validateSkillSettings`（`index.ts:187-197`）在目标平台上不拦任何放宽候选，用户/设置面可把
  `skillContentChars`、`maxSkillFileBytes`、`maxSkillNameLength`、`maxDescriptionLength` 提到部署值之上
  （`evolution-curator/src/index.ts:480` 同类钩子亦然，越界同源）。

## P2 / 技术债 / 屎山

1. **动作表只剩一半是表**：`SKILL_ACTIONS` 的 `gate`/`summary` 全仓无消费者（`skill-actions.ts:24-50`；运行时只读
   `mutates`/`needsName`：`index.ts:46`/`948`/`1204`），summary 真实策略又写成 origin 条件分支（`index.ts:964-975`）——
   表说 restructure `summary:'required'`，代码只对非前台要求；`commitSkillAction` 是 `return run()` 的空接缝（`skill-actions.ts:59-61`）。
2. **按 action 手写分支三份**：`simpleActions` 12 个闭包每次调用重建（`index.ts:1061-1203`）；`planFromStaged` 再写一遍
   动作语义（`291-323`）；`previewSkillWrite` 第三遍（`325-417`）。extract 分支 65 行内联、缩进错位、`let result` 无类型（`1145-1202`）。
3. **两个门禁上下文装配器**：admission 手拼 `WriteGateContext`（`index.ts:1544-1590`），execution 用 `skillWriteGateContext`
   （`1016-1021`/`1711-1716`）；后者文档明说手拼是「漏 protectedNames」的来源（`write-gates.ts:94-102`）。summary/descriptionStrict
   检查在 `executeCore`（`967-975`/`1047-1058`）与 `replayExecutionRefusal`（`1710-1731`）各写一遍。
4. **tool 仍直调内容 mutator**：`library.archive`(1111)、`restructure`(1138)、`extract`(1187)、`setPinned`(1128-1129)——
   违反 single-provider 文档 §2 原则 1「tool 不直接调用任何内容 mutator」。
5. **pin/unpin 用 `mutates:false` 兼职表达「不是内容写」**（`skill-actions.ts:48-49`），于是同时跳过 approval（`1595`）、
   cross-source（`1522`）、usage 计数（`1239`）；字段语义被重载，三个调用点各记一次例外。
6. `planFromStaged` 在同一对象字面量里**被调两次**（`index.ts:1671`）；它在 `skillSupportTarget`
   （`evolution-core/src/skill-observation.ts:91-96`）遇非法 file_path 会抛——抛点在 `approval.request` 参数构造中，成裸错误。
7. extract `dry_run` 有写副作用：写 proposal report（`index.ts:1191-1197`）；`proposalFromPlan` 用两次不同 `runId`
   （`1181` vs `1195`）→ 落盘报告与返回的 proposal 不同源。`proposal_id` 路径因 `name===''` 绕过 cross-source 与 read gate
   （`index.ts:1522`/`1152-1167`，`write-gates.ts:129-135`）。
8. 陈旧注释：`index.ts:586-588` 称 approval 是 `inject` 硬依赖，实际 `inject` 为 `['tools','skillUsage','evolutionIo']`
   （`49`），approval 是软注入（`1733`）。
9. 取消/超时：execute 全链不读 `exec.signal`（唯一转发在确认卡：`678`），未声明 `timeoutMs`；extract 起子智能体固定
   120s（`228-247`）。平台契约要求异步体观察/转发 signal（`harness-rc3/packages/core/tools/src/contracts.ts:33-36`）。
10. 观察桥解释「不透明」平台 token：`skill-observations.ts:108-118` 自己拼 `dev:ino:size:mtimeNs:ctimeNs` 与 FsVersion
    比较，而平台声明该 token「consumers MUST NOT interpret」（`harness-rc3/packages/fs/fs/src/types.ts:28-34`）。当前与
    fs-local 巧合一致（`fs-local/src/fsio.ts:74-76`），设计文档已登记降级（`skill-write-concurrency.md` §14），
    换 backend 即静默零观察，测试用同一函数自证。
11. `fs/observed` 监听器（`80-104`）对「任何」present 事件授权写，只校验 actor.session、不校验读发起方；回调内
    `statSync+readFileSync`（`114-118`/`93-98`）同步读全文件，大文件阻塞事件循环。
12. 工具注册 disposer 被丢弃（`index.ts:1419`），与平台自家 `tool-skill` 同款（`harness-rc3/packages/skill/tool-skill/src/index.ts:165`）；
    但 `tools.register` 绑定 ToolsService 自己的 fiber（`core/scope/src/store.ts:226-233`），行热重载会「already registered」
    失败（`core/tools/src/index.ts:68-71`），值得注释或 effect 化。
13. 只读动作也付写入前置成本：`writeReadNames`/`writeReadSupportFiles`（`index.ts:1535-1543`）对 list/review 也执行；
    每个 mutating 调用都做一次全树 catalog 扫描（`catalogWinner`，`877-893`）。
14. 结果 schema 声明 `pending_id` 但 `render` 不提它（`index.ts:1464`/`1468`），只靠 message 文字；`skills` 字段对写动作
    恒为 `[]`（`1271`）。

### evolution-skill-discovery
15. 每个 `agent/pre-step` 两次整树扫描：`ProjectionRuntime.project`（`projection-runtime.ts:219-222`）→ `SkillIndex.read`
    （`skill-index.ts:62-77`）同时调 `ctx.skills.snapshot()` 与 `library.list()`（markerFacts，`main-entry.ts:66-82`）；
    markerFacts 只在 `evolution/skill-mutated` 才变，却被无缓存重扫（`main-entry.ts:141` 只清 search cache）。
16. `PlatformSource.snapshot` 丢掉 `query.signal`（`main-entry.ts:67`），平台 `SkillLookupOptions` 带 signal
    （`harness-rc3/packages/skill/skill/src/index.ts:103-108`）→ 已取消的 step 继续扫盘。
17. `search.allowedSkillKeys` 引用其后才声明的 `map`/`policyFor`（`main-entry.ts:117-127` vs `145`/`161`），只靠
    `mode==='off'` 在 `142` 提前 return 才没踩 TDZ——隐式顺序约束，无注释无守卫。
18. `searchHealthy` 闭包 mutable，首个成功搜索翻转 prompt 文案（`main-entry.ts:115`/`135`/`174`；`projection-runtime.ts:196`）
    → 投影文本依赖无关调用历史，prefix cache 抖动。
19. search 缓存 `rebuild`/`invalidate` 无调用方（`search.ts:117-126`/`221-223`）；构建抛错时按 viewKey 抓「第一个」旧条目
    并标 stale（`search.ts:212-217`），可能拿旧 digest 的引擎回答新视图。

### evolution-skill-health
20. 每次 GET 重读全部 proposal report（`routes.ts:100-104`；`index.ts:26-31`），无上限/无缓存而 panel 会轮询；
    wire 声明 `proposalStatus:'stale'`（`client/api.ts:25`）但 host 从不返回该值。

### evolution-commands
21. **一个命名空间两套解析器**：`/evolution` 分发用 `parse.ts:81`（`index.ts:438`）；`command-catalog.ts:16` 的 `parseCommand`
    （含 flag/positional 校验）只被 `evolution-merge` 用（`evolution-merge/src/commands.ts:26`）。`HOST_COMMAND_DEFS` 的
    `flags/positional/readOnly/needsRun/rowActions` 不进入分发（只 `flagsOf` 取名字、help 取 usageLine），声明与执行脱节；
    `hostCommandDefForName`（`host-command-defs.ts:50-52`）无调用方。
22. handler 再按 raw input 二次匹配（第三次解析）：`skill-history-commands.ts:22`/`41`、`restore-commands.ts:21`/`35`，虽然
    `def.id` 已知；`skill undo --to=v2` 被 `parse.ts:96-99` 接受，但 `skill-history-commands.ts:43` 只认 `--to v2` →
    版本选择器被静默忽略并把 `--to=v2` 当技能名。
23. `skill.pin/unpin` 在命令面另建 `SkillLibrary` 直写（`index.ts:464-485`），与 restore/undo 的 `unreplayableWriteRefusal`
    （`428-435`）不同口径（E-70 有意为之，但成为第二个写权威点）。
24. 陈旧注释：`index.ts:394-397` 仍提「quoted restructure heading」，而 `restructure` 已不在命令表（`host-command-defs.ts:8-37`）。

## 平台接口对照

| 接缝 | 家族用法 | 平台权威 | 判定 |
|---|---|---|---|
| 工具注册 | `registerEvolutionTool(ctx, defineTool(...))` → 适配器 `ctx.get('tools').register`（`evolution-adapter/src/tools.ts:14-34`）；`index.ts:1419` 丢弃 disposer | `ToolsService.register`（`harness-rc3/packages/core/tools/src/index.ts:128-153`）；effect 绑 ToolsService 的 ctx | 形状正确；disposer 丢弃与 platform 自家 tool-skill 相同（P2-12） |
| 参数 schema/校验 | `parameters` 13 动作 + 嵌套 `section/restructure/extract`（`index.ts:1435-1455`）；运行时由 `defineTool` 校验 | `defineTool` 校验（`core/tools/src/schema.ts:555-633`，`execute` 先 `validate`） | 正确；replay 通道无 schema → core 自写 `ARGUMENT_SHAPE`/`MISSING_ARGS`（`write-gates.ts:243-291`），重复但必要 |
| output 契约 | `output.schema` + `render`（`index.ts:1456-1468`） | `ToolOutputDefinition`（`contracts.ts:16-24`）；value 校验后仅 content 进模型（`pipeline.ts:545-575`） | 契约合规；`list` 的 names 未进 render（P1-3） |
| 取消/超时 | 仅确认卡转 `exec.signal`（`index.ts:678`）；无 `timeoutMs` | `ToolDefinition.execute` 契约要求观察/转发（`contracts.ts:33-36`）；`timeoutMs` 需协作实现（`contracts.ts:63-70`） | 未按契约（P2-9）；写体短，风险有限 |
| 并发分类 | `isConcurrencySafe: () => false`（`index.ts:1470`） | 只有 `true` 才并行（`contracts.ts:71-84`） | 正确 |
| session/event | `ctx.on('session/event',(session,event))`（`skill-observations.ts:66`）、usage 同型（`usage/index.ts:122`） | 声明 `(this: Scoped<Session>, session, event)`（`harness-rc3/packages/core/session/src/index.ts:79`） | 签名正确；事件 payload 语义误读见 P1-1 |
| fs/observed | `(target, observation, actor)`（`skill-observations.ts:80`） | `fs/observed(target, observation, actor)`（`harness-rc3/packages/fs/fs/src/index.d.ts:68`） | 签名正确；**解释** FsVersion 违反「MUST NOT interpret」（P2-10） |
| skills.list | `catalog.list(scope?{scope}:undefined)`（`index.ts:887`） | `list(options?: SkillViewOptions)`，`cwd/signal/scope` 均可选（`skill/src/index.ts:103-119`） | 正确；空视图语义自行定义（P1-5） |
| config waterfall | `ctx.on('internal/config', function(this:Fiber,_prev,next){ if(this!==ctx.fiber)… })`（`index.ts:807-818`） | cordis 4.1.0 发射：`waterfall('internal/config', fiber, next)`，`this`=null、fiber 在首参（`harness-rc3/vendor/cordis/src/{fiber.ts:678,events.ts:162-171}`）；平台先例改读首参（`llm-pi-ai/src/index.ts:198-207`） | **不兼容**：钩子静默失效（P1-6）；首参命名 `_previous` 亦误导 |
| userQuestions.ask | 失败一律 fail-open，仅 `ASK_ABORTED` 拒绝（`index.ts:666-700`） | `ASK_ABORTED`/`CALLER_NOT_LIVE`/`DELEGATED_CALLER`（`harness-rc3/packages/interaction/user-questions/src/index.ts:44-148`） | 有意 UX 取舍；`DELEGATED_CALLER` 会静默变成「继续写」 |
| 命令注册 | `commands.register({name,description,input,handler})`（`evolution-commands/src/index.ts:1282-1306`；`main-entry.ts:205-227`） | `CommandDefinition.handler(invocation)=>CommandResult`（`harness-rc3/packages/interaction/commands/src/index.ts:61-78`、`types.ts:34-41`） | 正确 |
| HTTP 路由 | `{path,methods:['GET'],requestBody:'buffered',fetch}`（`skill-health/src/routes.ts:89-119`） | `ConnectionFetchRoute`（`harness-rc3/packages/client/connection/src/rpc.ts:152-176`） | 正确；proposal 全量重读（P2-20） |
| 内部 core 边界 | 全部走 core 公开子路径（`dsh-evolution-core` `/skills` `/extract` `/io-registry`，package.json exports 已声明） | — | 无私有导入；但 tool 直调内容 mutator 属家族内部边界违规（P2-4） |
| 系统提示/设置 | `systemPromptPort(...).variable()/section()`；`settingsPort(...).configure({auto:false}, ctx.fiber)` | `systemPrompt.section/variable`（`core/system-prompt/src/index.ts:485`）；`settings.configure(presentation, owner:Fiber)`（`harness-rc3/packages/settings/settings/src/index.ts:266-277`） | 正确（同 fiber、section→variable 反序释放） |

## 更优实现

1. **修 read 证据**：`readDispatchRecord` 的 native 分支补 `data.message?.isError !== true`；夹具换成平台
   `commit()` 写入的 `createToolResultMessage` 形状（或直接 import helper）；加「失败读取 → E-318」真实形状回归。
2. **审批全动作 plan 化**：`SkillWriteOp` 增结构 op（delete/restructure/extract，自带 expected），staging 统一
   `plan: await service.plan(owner, action, args)`；删 `staged_from_sha256` 四段分支、`planFromStaged`、
   `isContentWriteAction`；`previewSkillWrite` 改为「plan → before/after」单一投影（对齐 single-provider §2/§8.1）。
3. **`list` 渲染名字**：`render` 拼 `value.skills`，并加一条 `tools.execute` 级 content 断言（现有测试全走 `value`）。
4. **summary 落库**：`applyOne(op, origin, change?)` 接 `plan.summary` 透传 `audit()`，`plan*` 增 `summary` 参数；
   短期不做就把 patch/结构 summary 从「必填」降为「有则记录」，别让模型提供没人消费的数据。
5. **空视图不是 unknown**：`catalogWinner` 用 `probePresent({winner:undefined,view:[]})` 表示「读成功且空」，
   `probeUnknown` 只留 list 抛错/服务缺失；补 strict + 空库 create 成功测试。
6. **观察桥可验证化**：`skillPlatformVersion` 换成平台 probe（或 fs-local 暴露 stat 探针），非本地 backend 标记
   unsupported 并 log 一次，而不是静默零观察。
7. extract `dry_run`：只构造一次 proposal（同一 runId），返回与落盘同源；dry_run 不写 report。
8. 命令面：`/evolution` 也用 `command-catalog.parseCommand(HOST_COMMAND_DEFS, argv)`，删 `parseSubcommand` 与
   handler 内 raw-input 二次匹配；`skill undo` 读解析后的 `flags.get('to')`。
9. **配置钩子按平台 4.1 约定重写**：`(fiber, next) => { const value = next(); if (fiber !== ctx.fiber) return value; … }`
   （照 llm-pi-ai 现行实现），测试改用 cordis `fiber.resolveConfig()` 驱动，而非手工 `ctx.waterfall(ctx.fiber, …)`。

## 覆盖清单

- 通读 `packages/tool-skill-manage/src/{index,skill-actions,skill-observations}.ts`；测试 10 个 spec（按用例检索，
  `tool-skill-manage.spec.ts` 未逐行）；`test-support/tool-host.ts` 确认测试走真实 `tools.execute` 且只断言 canonical value。
- 机制对照：`evolution-core` 的 write-gates / skill-write-service / skill-write-plan / skill-reads / tool-dispatch /
  skill-store（apply/applyOne/applyMulti/audit/writeSupportFile/validateSupportPath）/ skill-observation；
  `evolution-approval/src/index.ts`（request/runner/preview）；设计文档 single-provider 与 concurrency（含实施记录）。
- `evolution-skill-discovery/src`：main-entry、tool、search、skill-index、identity、projection-runtime、usage、catalog、awareness、security。
- `evolution-skill-health/src`：index、routes、client/{api,index,Panel,health-presentation}。
- `evolution-commands/src`：command-catalog、registry、host-command-defs、parse、index（分发/skill.*/pin/注册）、host-commands/*。
- 平台权威对照：core/tools/{contracts,index,executor,pipeline,schema,batch}、core/session、core/scope/store、core/system-prompt、
  llm/llm/message、skill/skill、skill/tool-skill、fs/{types,index.d}、fs-local/fsio、interaction/{commands,user-questions}、
  client/connection/{rpc,rpc-host}、settings/settings、llm-pi-ai、vendor/cordis/{events,fiber}（4.1.0，与 4.0.5 对照）。
- 未覆盖/无法确认：`skill-health/client/Panel.ts` 仅静态扫描，未上真实 UI（unverified）；commands 的 doctor/params/diagnostics 主体不在 skill_manage 接缝内未逐读；strictCrossSource 空视图路径无测试（机制确定，运行时 unverified）。
