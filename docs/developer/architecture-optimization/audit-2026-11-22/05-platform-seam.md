# 平台接缝审计：契约 / 适配器 / 组合包（HEAD 564431ac）

范围：`packages/evolution-platform-contract/src/**`、`packages/evolution-adapter/src/**`、`packages/evolution-host|agent|preset|all` 的 src/清单/YAML、各包 `package.json` exports/peerDependencies、`platform-line.json`。
平台证据：权威源码 `D:\dsh\harness-rc3`（tag `dsh-v0.2.2-rc.3`）；声明 cohort 是 `0.2.2-rc.5`，故凡 rc.3 与 rc.5 有差的点另读本机 rc.5 安装闭包（`%APPDATA%\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*`，全部 0.2.2-rc.5）与 `D:\dsh\_upstream\dsh-upstream-0.2.2-rc.5` 对照。只读；未启动宿主、未跑 tsc/vitest。

## 结论（一段）

契约/适配器这一层的**主路径接口调用是对的**：18 个 port 对应的服务名、方法签名、注册/释放模式在 rc.3 与 rc.5 都对得上（见"平台接口误用表"），`modelSelection` 读 view 而非 state、`isRoot` 与平台 `assertLiveRoot` 同判据、`connection.fetch.register` 的路由形状、review-child 的 `createScope + sessions.create` 都是按平台真实形状写的；组合 YAML 的全部家族 row 名都能解析到同包 `exports`，`dsh.client` 声明与 rc.3 的客户端扫描规则一致。真正的风险不在"调错方法"，而在两处**机制性缺口**：① `completeText` 只把 `finish(error)` 当失败，平台把取消归一成 `finish(aborted)`，于是被取消的辅助模型调用会以"成功"返回半截文本，契约里承诺的 `cancelled` 永不产生（P1-1）；② 声明 cohort 是 rc.5，但仓库里唯一面向平台的机械检测（`verify-platform-contract`）锚点录制自 0.1.5-rc.2、默认 `--accept-recorded`，实测对 rc.5 放行 208 条 recorded 差异、只核 18 个 imported symbol，而本地开发类型线接的是 0.2.1-rc.2，等于**声明线上的类型/形状没有任何在仓内生效的判据**（P1-2）。技术债主线是"契约重述平台形状 + `unknown` 化返回值 + 一个退役包拖着一整套活的 bundle 表面"，任何平台改名都只能靠人工发现。

## P0（无则写无）

无。最接近 P0 的是 P1-1（取消被当成功）和 P2-4（工具注册静默 no-op）：前者需要 abort 触发，后者需要"家族 row 早于平台 tools row"的非默认组合，均不满足"默认路径静默数据丢失/崩溃"。

## P1

### P1-1 `completeText` 把平台归一化的 `aborted` finish 当成功，取消返回半截文本
- 证据：`packages/evolution-adapter/src/llm.ts:46-61`（`for await` 聚合 `text-delta`，只在 `frame.type === 'finish' && frame.reason?.kind === 'error'` 时抛，其余 finish 直接 `return text`）、`:49`（把 chunk 结构断言成自定义形状）；契约 `packages/evolution-platform-contract/src/llm.ts:6`（`cancelled` 是声明的失败类型）。平台：`harness-rc3/packages/llm/llm/src/types.ts:163-172`（`FinishReasonMap` 含 `aborted: { kind:'aborted'; failure: LlmFailure }`）、`:488-495`（"`LlmRuntime.stream()` normalizes that failure to a terminal `error` or `aborted` finish"）；rc.5 `dsh-llm/lib/types/types.d.ts:138-158` 同形。
- 机制：取消/超时不是抛错，而是终态 `finish(aborted)` 帧；`completeText` 不 switch 终态 kind，循环正常结束并返回已累计文本。`EvolutionLlmFailureKind` 的 `cancelled` 在整个适配器里没有任何产生点（全会话只 `transport`/`content-refused`，`:42,:56`）。
- 影响：curator / merge-engine / skill-discovery 的辅助调用在 session 取消、step abort、调用方超时后，把半截模型输出当完整结果返回并落盘（技能文本、合并提案）。调用方按"成功"处理，无重试、无降级标记。
- 建议：按终态 kind 收敛——`aborted`→`EvolutionLlmError('cancelled')`；`error` 再按 `failure.code` 映射（`CONTENT_REFUSED`→content-refused，`TIMEOUT`→timeout，`NO_ROUTE`/凭据类→no-route/model-unavailable，其余 transport）；流在没有 finish 帧就结束时也抛 transport。删掉不存在的 `frame.type === 'text'` 分支。
- 置信度：机制确定；触发需 abort（会话取消/超时为常规场景）。

### P1-2 声明 cohort 是 rc.5，但接缝检测按 0.1.5-rc.2 录制且默认容错；本地类型线是 0.2.1-rc.2
- 证据：`platform-line.json:3-7`（version/floor/cohort 全为 `0.2.2-rc.5`，注释要求"peers and engines 是 cohort 的精确并集"）；发布期确由 `packages/scripts/prepare-release.mjs:167-168,194-204` 把 `workspace:` 平台 spec 重写成 `peersRange`。但：`packages/scripts/verify-platform-contract.mjs:8,63,400` 三处自述锚点录制自 **0.1.5-rc.2**，且 `UPSTREAM_SHA` = `fb2c4b9e…`，在 harness-rc3 里就是 `worktree/release-dsh-0.1.5-rc.2` 的合并提交；`packages/scripts/gates/guards.mjs:137-138`（gate-18 local 形态）显式带 `--accept-recorded`。
- 实测：`node packages/scripts/verify-platform-contract.mjs packages --upstream D:/dsh/_upstream/dsh-upstream-0.2.2-rc.5 --accept-recorded` → 退出 0：`30 recorded anchor(s) (symbol-grade 28, text-grade 2) … 18 imported symbol(s), 36 service name(s) … 386 platform citation(s) (208 broken) … 208 recorded difference(s), all accounted for`。即对声明线只有 30 条文本/符号锚 + 18 个 imported symbol 在判，208 条引用差异被"已录制"放行。
- 另一条线：本 checkout 的 `node_modules/@deepseek-ai/*` 是指向 `D:\dsh\harness-0.2.1\apps\cli\node_modules\…` 的 junction，实读 `dsh-llm/dsh-agent/dsh-tools = 0.2.1-rc.2`；`D:\dsh\_tools\setup-mirror-tests.mjs:4` 硬编码 `harness-0.2.1`。rc.5 之后新增/变更的 API（例如 `CONTENT_REFUSED` 只存在于 rc.5：`dsh-llm/lib/types/error.d.ts:21`、rc.3 的 `LLM_FAILURE_CODES` 无此项）在本树既不类型检查也不被测。
- 影响：平台在 30 条锚之外的任何移动（服务换名、方法参数变化、返回形状变化）都会绿着发布；rc.5 专属行为缺少在仓内的类型证明——P1-1 引用的 `CONTENT_REFUSED` 恰是唯一被代码依赖的 rc.5 新行为，却只能靠注释说明。
- 建议：把 gate-18/锚点/dev wiring 的 `--upstream` 统一指向 `_upstream/<cohort>`，去掉 local 形态的 `--accept-recorded`（改为 strict），重录后把 208 条差异压回 0；contract 的端口形状改由平台 d.ts 派生/`satisfies` 校验（见"更优实现"），替代散文锚点。
- 置信度：读数确定；"这 208 条里有无真断"未逐条判定，标 likely（检测面本身不覆盖）。

## P2 / 技术债 / 屎山

1. **`ConfigEditorPort.configuration` 类型说谎**：契约声明 `Promise<unknown>`（`contract/src/platformView.ts:14`），适配器原样透传（`adapter/src/platformView.ts:49-57`），平台是**同步**返回数组（`harness-rc3/packages/boot/config-editor/src/index.ts:49-70`；rc.5 `dsh-config-editor/lib/types/index.d.ts:23`）。现唯一消费者 `await`（`evolution-commands/src/platform-view.ts` 的 `arrayOf`），所以不炸；但这是一个"契约重述平台形状"未被 gate 抓到的活样本。
2. **契约重述平台对象形状，检测面只核 imported symbol**：`PluginManagerPort.listBundles/listPlugins(): Promise<unknown>`（`contract/src/platformView.ts:3-15`）、`PresetDefinitionLike`（`contract/src/presets.ts:7-13`）、`ConnectionRoute`（`connection.ts:5-12`）、`SubagentActivationPort`（`subagents.ts:5-15`）、`UserQuestion`（`userQuestions.ts:3-15`）都是本地接口，成员与平台 d.ts 无机械对照（gate 只数 18 个 imported symbol，见 P1-2 读数）。P2-1 即此类漂移。
3. **能力表双 owner + 死类型**：契约声明 `PlatformCapabilities{present,missing}` 与 19 个 capability 名（`contract/src/index.ts:40-68`），但适配器服务没有 `capabilities` 成员（`adapter/src/service.ts:30-70` 只有 `contract` 与 `ports`）；真实能力表在 `evolution-core/src/platform-services.ts:20-`（36 个 `ctx.get` probe，注释自称"the same list the doctor judges"）。同一个"平台有什么"事实两处维护、命名还不一致（`storage-domain` vs `storageDomain`）。
4. **`registerEvolutionTool` 静默 no-op**：`adapter/src/tools.ts:30-35` 一次性探测 `ctx.get('tools')`，缺失时返回空 disposer——工具不注册、无日志、无重试。平台惯用形态是依赖驱动（`ctx.inject(['tools'], …)` / effect），family 自己在 `tool-skill-manage/src/index.ts:571` 就是这么写的。触发：自定义组合里家族 row 先于平台 `tools` row（平台 service 顺序不保证）。建议改注入或把失败上报 doctor。
5. **`sendMessage` 选项是可选的，平台必填**：契约/适配器 `sendMessage?(sender, targetId, content, options?: {signal?: AbortSignal})`（`contract/src/subagents.ts:15-21`、`adapter/src/subagents.ts:20,34`）；平台 `sendMessage(sender, targetId, content, options: SubagentSendMessageOptions)` 且 `options.signal.throwIfAborted()`（`harness-rc3/packages/subagent/subagent/src/index.ts:368-375`、`src/manager.ts:568`；rc.5 `lib/types/index.d.ts:199`）。当前唯一调用方总带 options（`evolution-core/src/subagent/run.ts:156`），属潜伏类型洞：调用方省略即 `Cannot read properties of undefined`。
6. **`ports` 每次访问全量重建 18 个 port，投影 port 状态活不过一次访问**：`adapter/src/service.ts:40-66` 注释"Deliberately uncached"；热路径每次都取整表（`evolution-core/src/opt-in.ts:108`、`src/subagent/kernel.ts:60,146`）。`ProjectionPort.shape/reason` 是 port 实例字段（`contract/src/projections.ts:26-29`、`adapter/src/projections.ts:34-52`），跨 `platform.ports` 访问即复位为"未答"——`runtime/projections.ts:79-101` 侥幸在同一局部对象上注册并读回。建议 per-service getter + service 级投影状态。
7. **投影 `'unrecognised'` 是死分支、`readerFor` 被丢**：rc.3 `sessionProjections.register` 返回 `Promise<ProjectionHandle>`（`harness-rc3/packages/session/session-projection/src/index.ts:322-336,434-443`，handle 含 `stateOf/readerFor/dispose`），rc.5 仍同（`dsh-session-projection/lib/types/index.d.ts:202-225`）；契约把它建模成 `handle | unrecognised` 并把 `stateOf` 放宽为 `S | undefined`（`contract/src/projections.ts:18-33`），掩盖平台"必有值"的不变量。死分支让 `runtime/projections.ts:95-101` 的 degraded 判定实际不可达。
8. **`dsh.resolverDependencies` 是死字段**：`evolution-host/package.json:25-29`、`evolution-agent/package.json:41-45`、`evolution-preset/package.json:27-31`、`evolution-all/package.json:19-23` 都声明；rc.3 平台全树无读者（只有家族 `verify-dependency-closure.mjs:201`、`prepare-release.mjs:183` 读它），平台的运行时解析包已改为从 `dependencies/peerDependencies/optionalDependencies` 派生（`harness-rc3/packages/boot/app-boot/src/profile.ts:313`）。四份发布清单里挂着一段没有消费者的 `dsh.*` 命名空间。
9. **退役包 `evolution-preset` 仍拖着完整 bundle 表面（屎山）**：`packages/scripts/lib-family-packages.mjs:48,51` 已把它列为 product-retired、排除出发布；但目录里仍有 `dsh.bundle.patch`、与 all/host 近乎重复的 `cordis.patch.yml`、带 `!!js dshHomePath(...)` 的独立 `cordis.yml`、12 个家族依赖、`resolverDependencies`、以及手写的平台 peer `^0.2.2-rc.5`（`evolution-preset/package.json:47-51`）。这套 peer 因"只重写 `workspace:`"（`prepare-release.mjs:194-204`）且 envelope/ranges 只扫 staging（`verify-platform-envelope.mjs:43-50`）而**永不被判定**；同时 `line-manifest.json:78-80` 仍登记它为 `evo-src`、`install-layered.mjs:30,1017` 仍引用 oneclick、`verify-composer-single-source.mjs:42` 仍把它当 bundle——第二个 bundle 真源 + 任何遍历 `packages/*/package.json` 的工具都会被它骗。
10. **`evolution-agent` 的 `agent.cordis.yml`/`bases.json` 是家族自消费死表面**：`agent.cordis.yml:1-10` 自述"0.48 removed the installer composition path… No new profile is generated from it"；平台侧无读者（rc.3 全树 grep 只命中家族脚本/测试）；却仍进 `files`/`exports`，包描述还写"Agent preset exposing memory and skill evolution tools to a session"（与"仅 legacy delta"矛盾）。要么删，要么在描述/文件名上明确 legacy。
11. **`values.ts` 把平台耦合面放大到 10 个运行时导出**：`SessionId/escapeText/BlockAssembler/createUserMessage/createToolResultMessage/defineDomain/domainTable/DomainError/scopeOf/withFileLock`（`adapter/src/values.ts:8-49`）跨 7 个平台包；功能包直接 import 这些值，"只经单一适配包"实际是"经适配包的两个入口、10 个符号"，平台任一导出改名同时打红所有功能包，而 gate 只核 18 个 imported symbol。
12. **契约承诺的失败分类超出实现**：`EvolutionLlmFailureKind` 的 `model-unavailable/no-route/timeout` 无产生点（`contract/src/llm.ts:6`；`adapter/src/llm.ts:42,56` 只有 transport/content-refused），`completeText` 还有不存在的 chunk 变体分支 `frame.type === 'text'`（`:50`；`StreamChunk` 无此变体，rc.3 `types.ts:496-508`）。注释"callers may map these without parsing messages"目前不成立。
13. **zod 窗口不齐（推断）**：契约运行时依赖 `zod ^4.4.3`（`evolution-platform-contract/package.json:34`），rc.5 的 `dsh-session-projection` 固定 `zod 4.6.6`；家族把自建 `ZodType` 传进平台 `ProjectionDefinition.stateSchema`（rc.3 `session-projection/src/index.ts:83-87`），两份 zod 时运行期 duck-type 可用、类型同一性无保证。建议把 zod 声明与 cohort 平台依赖对齐或改为纯类型 import。
14. **能力名与 port 名不一致**：contract capability 集合 19 项用 `storage-domain/session-projections/...`（`contract/src/index.ts:42-61`），`HostPlatformPorts` 18 项用 `storageDomain/projections/...`（`contract/src/service.ts:21-42`）——同一能力两个词表，任何机械映射（doctor/生成器/门禁）都要手写对照。

## 平台接口误用表（已逐项核对）

| 接口（家族用法） | 家族位置 | 平台证据（rc.3 行号，除注明） | 判定 |
|---|---|---|---|
| `ctx.get('agents').get/list`；根判定 `live===agent && origin!=='subagent'` | `adapter/src/agents.ts:22-39` | `core/agent/src/index.ts:580-590`；`interaction/user-questions/src/index.ts:137-150`；`core/agent/src/index.ts:84`（origin） | ✓ 与平台 `assertLiveRoot` 同判据 |
| `sessionProjections.register(def)` → `await` 取 handle | `adapter/src/projections.ts:39-56` | `session/session-projection/src/index.ts:320-336,357-376,434-443`（hybrid promise+disposer）；rc.5 `lib/types/index.d.ts:202-225` | ✓（死分支见 P2-7） |
| `sessionProjections.snapshot(session,['modelSelection'])` 读 `{lastUsed,next}` | `adapter/src/llm.ts:75-82` | `core/agent/src/model-selection.ts:72-90`（view: `next = pending ?? lastUsed`） | ✓ 注释与代码一致 |
| `tools.register/guard/restrict/get/resolve/execute` | `adapter/src/tools.ts:14-35` | `core/tools/src/index.ts:128,162,239,264,375` | ✓ 签名一致；no-op 注册见 P2-4 |
| `llm.stream(GenerateOptions)`；finish 帧读取 | `adapter/src/llm.ts:40-61` | `llm/llm/src/index.ts:206,1185-1197`；`types.ts:163-172,496-508` | ✗ 终态分类漏 aborted（P1-1） |
| `settings.configure({auto}, owner)` / `describe()` | `adapter/src/settings.ts:9-22` | `settings/settings/src/index.ts:266-307` | ✓（owner 以 `unknown` 再 cast，属类型侵蚀） |
| `commands.register(definition)` | `adapter/src/commands.ts:12-19` | `interaction/commands/src/index.ts:285` | ✓ |
| `skills.list({scope})` | `adapter/src/skills.ts:12-18` | `skill/skill/src/index.ts:470`（`SkillViewOptions.scope?`） | ✓ |
| `workingDirectory.ensure(agent, signal)` | `adapter/src/workingDirectory.ts:14-20` | `session/working-directory/src/index.ts:154` | ✓ |
| `systemPrompt.section/variable/context` | `adapter/src/systemPrompt.ts:12-25` | `core/system-prompt/src/index.ts:485,520,568` | ✓ |
| `subagents.getProvider/startActivation/sendMessage` | `adapter/src/subagents.ts:15-37` | `subagent/subagent/src/index.ts:252-292,368,548`；rc.5 d.ts:136-199 | ✓，options 必填见 P2-5 |
| `agentPresets.readDocument/register/resolve/mount/composedPreset` | `adapter/src/presets.ts:8-37` | `preset/agent-preset-registry/src/index.ts:97,193,220,234,297,333` | ✓（`PresetDocument` 少 `name/description` 可选字段，读取不损） |
| `storageDomain.open(spec)`（facility） | `adapter/src/storageDomain.ts:10-19` | `storage/storage-domain/src/index.ts:103,234`（`provide('storageDomain')`） | ✓ |
| `connection.fetch.register(route)`；`allowsRemoteAuthorities` | `adapter/src/connection.ts:20-35` | `client/connection/src/rpc-host.ts:79-101,115-120,234-251,401-411`；rc.5 `rpc.d.ts:117-140` | ✓ 形状一致（`/api` 前缀断言在平台侧） |
| `pluginManager.listPlugins/listBundles`；`pluginInventory.list`；`configEditor.configuration` | `adapter/src/platformView.ts:18-57` | `boot/plugin-manager/src/index.ts:476,500`；`host/plugin-inventory/src/index.ts:71`；`boot/config-editor/src/index.ts:49` | ✓ 存在性；返回值 `unknown` 化见 P2-1/2 |
| `userQuestions.ask({questions,agent,signal})` | `adapter/src/userQuestions.ts:10-18` | `interaction/user-questions/src/index.ts:291-361`；rc.5 `types.ts:146-163` | ✓（少 `wait/intent` 可选字段，当前不传） |
| `createScope + sessions.create(id,{meta:{cwd}}) + scope.ctx.plugin + Session.create` | `adapter/src/review-child.ts:90-120` | `core/scope/src/index.ts:137-148`；`core/session/src/index.ts:1206-1217,617`；rc.5 d.ts:78,194 | ✓ |
| PTC 执行器动态探针 `apply/inject` | `adapter/src/review-child.ts:60-79` | rc.5 `dsh-tool-executor-ptc/lib/types/index.d.ts`（`export const inject` + `apply`）；未声明 peer，靠安装态解析 | ✓（形状）；解析可达性 likely 未实跑 |
| 客户端半：`dsh.client.platform/inject` + `./client` 导出 + 行挂载才被扫描 | `evolution-ui/package.json`、`evolution-merge-ui/package.json`；`evolution-all/cordis.patch.yml:140-155` | rc.3 `client/modules/src/index.ts:2-3,903-908`（扫 Loader entries；缺 `./client` 报错） | ✓ 与"有效 host 半保住扫描可见性"注释一致 |

## 更优实现（机制级，不按条目打补丁）

1. **端口形状由平台类型派生**：`HostPlatformPorts` 各 port 用平台服务类型 `Satisfies`/`Pick` 生成（adapter 单点 type import），contract 只保留 family 语义名；删除手工重述的 `Promise<unknown>`/局部接口。这样 P2-1/2/5/14 一整类漂移变成编译错误。
2. **模型流终态集中分类**：在 `llmPort` 里做一个 `finishToError(kind, failure)` 判别映射，`stream`/`completeText`/`streamRaw` 共用；补 `aborted`、缺 finish、unknown kind 三分支，删除不存在的 chunk 变体。
3. **能力表单一 owner**：adapter 从 port 定义派发 `PlatformCapabilities`（present/missing），删除 `evolution-core/src/platform-services.ts` 的 36 项手写 probe 或改为消费该表；同时统一 capability 与 port 的命名（P2-14）。
4. **port 表惰性 + 服务级状态**：`EvolutionPlatform` 用 per-service 惰性 getter（`ctx.get` 在 getter 里发生，保留 lifecycle 语义），把 `ProjectionPort.shape/reason` 上移到 service，一次注册一次判定，热路径不再重建 18 个对象。
5. **清死面**：删 4 份 `dsh.resolverDependencies`；把 `evolution-preset` 从 `packages/` 移出（文档/legacy 目录）或删掉 `dsh.bundle`/peers/`cordis.patch.yml`，同步 `EVOLUTION_BUNDLE_TAILS`、`install-layered` 的 oneclick 名、line-manifest 登记；`evolution-agent` 的 `agent.cordis.yml`/`bases.json` 二选一（删或独立 legacy 子包）。
6. **接缝门禁对准声明线**：`--upstream` 固定到 `_upstream/<cohort>`、local 形态 strict；把 208 条 recorded 差异压回 0 并在 CI 保留 strict 读数；`values.ts` 的 10 个符号纳入同一 imported-symbol 统计（当前 18 个显然没数全）。

## 覆盖清单

- 逐字读：contract `src/*` 24 个文件 + `package.json`；adapter `src/*` 22 个文件 + `package.json`；host/agent/preset/all 的 `src/index.ts`、`cordis.patch.yml`（host/all/preset 三份）、`evolution-preset/cordis.yml`、`evolution-agent/agent.cordis.yml`+`bases.json`、6 份 `package.json`、`platform-line.json`；`adapter/tests/review-child.spec.ts` 未读（范围外）。
- 平台源码读：rc.3 `core/agent/{index,model-selection,types}`、`core/session/index`（相关段）、`core/tools/index`、`core/scope/index`、`interaction/{commands,user-questions}/{index,types}`、`session/{session-projection,working-directory}/index`、`core/system-prompt/index`（签名段）、`subagent/subagent/{index,types}`（签名段）、`preset/agent-preset-registry/index`（签名段）、`storage/storage-domain/index`（open 段）、`settings/settings/index`（configure/describe 段）、`boot/config-editor/index`、`boot/plugin-manager`（grep）、`host/plugin-inventory`（grep）、`client/connection/src/rpc-host.ts`（全）、`client/modules/src/index.ts`（grep）、`boot/app-boot/{profile-context,profile}`（相关段）、`util/atomic-write/index`（grep）。
- rc.5 安装闭包读：`dsh-llm`（FinishReasonMap/CONTENT_REFUSED）、`dsh-session-projection`、`dsh-client-connection/rpc.d.ts`、`dsh-subagent`、`dsh-config-editor`、`dsh-agent-preset-registry`、`dsh-tools`、`dsh-session`、`dsh-scope`、`dsh-atomic-write`、`dsh-tool-executor-ptc`（package.json + index.d.ts）、客户端 `dsh-client-ui-{sidebar,layout,locale}` 存在性、`dsh-storage{,-json,-domain}` 存在性 + 版本。
- 跑过的命令：`verify-platform-contract.mjs … --upstream <rc.5>`（strict 与 `--accept-recorded` 两形态）；一段 node 脚本核"3 份 bundle patch + agent.cordis.yml 的全部 row 名是否解析到同包 exports"（结果：家族 row 全解析，仅平台 storage 三包不在本仓 packages/）；平台包版本读数（mirror junction → 0.2.1-rc.2；`_upstream/dsh-upstream-0.2.2-rc.5` 存在且版本 rc.5）。
- 未核实：未启动宿主、未跑 tsc/vitest（本 checkout 无 lib/构建线，只读审计）；PTC 动态 import 在真实 profile 安装态的 Node 解析未实跑（标 likely）；rc.5 web 客户端 bundle 里 `configForms` 席位未核（本审计未把客户端半纳入判定）；无 `.release-staging` 目录，发布清单的 envelope/ranges 未实跑。
- 卫生：本报告是唯一写入；`git status` 仅该文件。
