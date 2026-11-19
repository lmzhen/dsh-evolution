# 平台端口清单（Phase 0 设计草稿）

> 目标：所有平台服务只经 `evolution-platform` 的 `PlatformPorts` 进入功能层；功能层不再出现 `ctx.get('平台服务')`、结构断言、版本分支。
> 本文是 26 §5.1 的执行清单；Phase 1 按此表逐项收编。
>
> **P0a（2026-11-19）**：端口实现已迁到 `packages/evolution-adapter/src/`（`ports.ts` / `values.ts` / `service.ts`）；`packages/evolution-core/src/platform/` 只保留兼容 re-export。全仓平台 runtime import 现已集中在 `evolution-adapter`，core 不再直接 import `@deepseek-ai/dsh-*`。下文的 `evolution-core/src/...` 路径是迁移前历史，目标状态见 [multi-version-support.md](multi-version-support.md) §3.2。

## 1. 当前端口覆盖（2026-11-16 Phase 1 第一切片后）

`packages/evolution-adapter/src/service.ts` 现在每次读取都重新解析（不缓存 undefined）：

| 端口 | 平台服务 | 状态 |
|---|---|---|
| `agents` | `agents` | 新增：`get` + `isRoot`（`session.header.origin !== 'subagent'`） |
| `subagents` | `subagents` | 新增：`getProvider` / `start` / 可选 `sendMessage` |
| `userQuestions` | `userQuestions` | 新增：`ask` |
| `projections` | `sessionProjections` | 已有 port；`EvolutionProjections` 已改为已挂载即 await、晚挂载走 `ctx.inject` |
| `llm` | `llm` | 已有 port；`EvolutionLlm` 已改为按调用解析 |
| `tools` | `tools` | 已有 port |
| `presets` | `agentPresets` | 已有 port |

Phase 1 完成（2026-11-16）：生产直接访问只剩 `packages/evolution-core/src/platform/` 的适配器；其余端口见下表“完成”行。`configForms` 是客户端 seam，不走 host `EvolutionPlatform`。

## 2. 直接访问清单（扫描，2026-11-16）

扫描 `packages/**/src/**/*.ts`，排除 tests/lib/dist/release-staging；`ctx.get('<name>')` 与 `serviceOf(ctx,'<name>')` 合并。家族自有服务（`evolutionPolicy/evolutionIo/...`）不在本表。

| 平台服务 | 当前拿法 | 主要消费点 | 目标端口 |
|---|---|---|---|
| `agents` | `EvolutionPlatform.ports` | channel/确认 gate/opt-in/curator 已迁移 | 完成 |
| `subagents` | `EvolutionPlatform.ports` | channel/readiness 已迁移 | 完成 |
| `userQuestions` | `EvolutionPlatform.ports` | tool-skill 确认 gate 已迁移 | 完成 |
| `agentPresets` | `EvolutionPlatform.ports` | presets 端口；仅 adapter 直读 | 完成 |
| `tools` | `EvolutionPlatform.ports` | register/get + review raw execute | 完成 |
| `llm` | `EvolutionPlatform.ports` | family request + review raw stream | 完成 |
| `sessionProjections` | `EvolutionPlatform.ports` | projections/runtime adapter 持有 | 完成 |
| `commands` | `EvolutionPlatform.ports` + `commandsPort` | 命令注册已迁移 | 完成 |
| `settings` | `EvolutionPlatform.ports` + `settingsPort` | 8 处 presentation + describe 读取已迁移 | 完成 |
| `configForms` | 客户端 seam | 浏览器设置卡，不走 host `EvolutionPlatform` | N/A |
| `configEditor` | `EvolutionPlatform.ports` + `configEditorPort` | doctor platform view 已迁移 | 完成 |
| `connection` | `EvolutionPlatform.ports` | `http-routes.ts` 已迁移 | 完成 |
| `skills` | `EvolutionPlatform.ports` + `skillsPort` | tool catalog 已迁移 | 完成 |
| `systemPrompt` | `EvolutionPlatform.ports` | tool guidance 已迁移 | 完成 |
| `storageDomain` | `EvolutionPlatform.ports` + `storageDomainPort` | state storage 已迁移 | 完成 |
| `workingDirectory` | `EvolutionPlatform.ports` + `workingDirectoryPort` | skill-discovery 已迁移 | 完成 |
| `pluginManager` | `EvolutionPlatform.ports` + `pluginManagerPort` | doctor platform view 已迁移 | 完成 |
| `pluginInventory` | `EvolutionPlatform.ports` + `pluginInventoryPort` | doctor platform view 已迁移 | 完成 |
| `agentDefaultModel` | `platform/llm.ts` 内部 | 默认模型路由；adapter 自己读 | 完成 |
| `profileContext` | `EvolutionPlatform.ports` + `profileContextPort` | preset source 已迁移 | 完成 |

> 数量以能读到的调用点为准；Phase 1 实施时用脚本生成“服务 × 文件:行”，不靠本文手抄。

## 3. 目标 `PlatformPorts`

```ts
interface PlatformPorts {
  readonly version: PlatformVersion
  readonly capabilities: PlatformCapabilities

  readonly agents: AgentsPort | undefined
  readonly subagents: SubagentsPort | undefined
  readonly userQuestions: UserQuestionsPort | undefined

  readonly tools: ToolsPort | undefined
  readonly commands: CommandsPort | undefined
  readonly settings: SettingsPort | undefined
  readonly configForms: ConfigFormsPort | undefined
  readonly configEditor: ConfigEditorPort | undefined

  readonly connection: ConnectionPort | undefined
  readonly skills: SkillsPort | undefined
  readonly systemPrompt: SystemPromptPort | undefined
  readonly storageDomain: StorageDomainPort | undefined
  readonly workingDirectory: WorkingDirectoryPort | undefined

  readonly pluginManager: PluginManagerPort | undefined
  readonly pluginInventory: PluginInventoryPort | undefined
  readonly agentDefaultModel: AgentDefaultModelPort | undefined
  readonly profileContext: ProfileContextPort | undefined

  readonly projections: ProjectionsPort | undefined
  readonly llm: LlmPort | undefined
  readonly presets: PresetsPort | undefined
}
```

规则：

1. 每个端口有 `available()`/`reason()` 或返回 `undefined`；**不缓存 undefined**。
2. 平台错误在端口边界映射为 `FamilyErrorCode`；功能层拿不到平台原始错误类型也必须能判。
3. 版本差异只进 `platform/adapters/rc1.ts`、`rc3.ts`；功能层只读 `capabilities`。
4. `subagents` 端口暴露 `start(spec): Promise<SubagentRun>`，不暴露平台 `startActivation` 形状；`run/open/continue` 在 kernel 统一。
5. `agents` 端口只提供 `get(id)`、`identity(agent)`（`origin` 判根）；不提供 `roots()`。
6. `connection` 端口只提供 `register(route)`，不把 admission 复制到家族。

## 4. 能力表（初始）

```ts
interface PlatformCapabilities {
  readonly subagent: { readonly named: boolean; readonly flatActivation: boolean; readonly treeSend: boolean }
  readonly tools: { readonly guardInfo: boolean; readonly contextUnavailable: boolean }
  readonly llm: { readonly failureTaxonomy: boolean }
  readonly session: { readonly batchAppend: boolean }
  readonly client: { readonly slotsHoc: boolean; readonly modalTone: boolean; readonly settingsSection: boolean }
}
```

能力探测优先用**声明/版本**，其次用运行时形状；不要在功能代码里散落 `try { x }`。

## 5. Phase 1 验收

- [ ] `rg "ctx\.get\('[a-z]" packages/*/src` 只命中 `platform/`；
- [ ] `rg "serviceOf\(ctx" packages/*/src` 只命中 `platform/`；
- [x] 只保留 rc.3 适配器，功能层零版本分支（DCR-2）；rc.1 `request` 桥已删；
- [ ] 端口晚挂载/消失测试通过；
- [x] `ensureRestrictedPreset` 不同 key 并发不串台；
- [ ] 现有定向测试 + 新端口测试绿（当前：端口生命周期 4/4、preset 9/9、session-projection + channel + preset 24/24、双版本编译 0/0）。
