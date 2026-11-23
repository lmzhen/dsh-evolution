# 84. 检索增强凭据：可选 Key、固定模型与降级不变设计

状态：设计基线 v1（2026-11-23，待实现）。  
适用范围：`evolution-merge` 的 ④ 向量、④.5 精排/判别；不包含 ⑤ 最终判决。  
上位文档：[10-system-framework.md](10-system-framework.md)、[11-target-architecture.md](11-target-architecture.md)。  
任何偏离本设计的实现必须先改本文或写 DCR/supersede，禁止代码先漂移。

## 1. 结论

把两把 API Key 的**来源**从后台配置/环境文件搬到 UI，但不改变检索流水线的模型、阈值、种子和降级策略。

- 唯一可编辑项：`SILICONFLOW_API_KEY`、`BAMBOO_API_KEY` 的凭据值。
- 模型、端点、档位顺序、阈值、prompt、`seed_mode`、`round_count`、`floor_jitter` 全部固定，不进入 UI。
- Key 由平台 `ctx.credentials` 解析，UI 通过 `remote.credentials` 写入；不新增插件自有 secret 存储，不把 Key 放进 `cfg` / report / run.meta / 日志 / 客户端快照；作为运行参数传给 engine，不写 `process.env`，也不进 cfg。
- 不配置 Key 时，engine 配置与当前逐字段相同；配置 Key 时，只让原本存在的云端档可用，不新增或重排 fallback。

## 2. 现状与证据

### 2.1 检索模型

`packages/evolution-merge-engine/vendor/skill-merge-pipeline/models/registry.json`：

| 阶段 | 固定模型 | 来源 | floors |
|---|---|---|---|
| ④ 向量 primary | `Qwen/Qwen3-Embedding-8B` | SiliconFlow API | body 0.75 / summary 0.85 |
| ④ 向量 fallback | `BAAI/bge-m3` | SiliconFlow API | body 0.8 / summary 0.6 |
| ④ 本地档 | `potion-multilingual-128M` int8-256 / pca64-int8 | 本地静态表 | body 0.95 / summary 0.6 |
| ④.5 精排 API | `startlux-decision-27b-autothink` | Bamboo `/v1/decisions` | — |
| ④.5 本地 | `StartLux-Decision-0.8B-Q8_0.gguf` | llama-server q8/q4 | — |

`config/schema.js` 当前默认：`embed_backend=chain`、`rank_mode=auto`、`seed_mode=run`、`floor_jitter=0.02`、`judge=stub`（wrapper 在可用时把它改成 `deepseek` 并传 platform runner）。

### 2.2 当前 Key 读取路径

- embedding：`embed/remote.js` 的 `readKey` 先读 `SILICONFLOW_API_KEY`，再读 `~/.dsh/.credentials.yaml`。
- 精排基线：`rerank/index.js` 的 `scoreRemote` 读 `process.env[BAMBOO_API_KEY]`；本设计增加显式运行 Key 参数，env 仅保留为无 UI Key 时的兼容来源。
- wrapper：`evolution-merge/src/index.ts:273-286` 只传 `embedder_model`、`embedder_model_last`、`judge`、`maxTokens`、`timeoutMs`；`domain/engine-input.ts` 将 `embed_backend`、`rank_mode`、`judge`、`models_dir` 等列为禁止项。
- UI：`evolution-ui` 的家族设置页只有参数卡和诊断卡；`evolution-merge-ui` 的“合并建议 → 高级”只有审批设置，没有凭据面。

结论：现在缺的是**凭据来源的产品化入口**，不是模型配置。

## 3. 不变量

1. **I1 单一事实源**：密钥事实只属于平台 `ctx.credentials`，插件不保存第二份。
2. **I6 契约生成**：credential refs、官方 Key 获取链接、固定模型展示文本有单一生成源；UI 不手抄。
3. **I7 验证绑定事实**：无 Key 路径的 engine cfg 必须有逐字段快照测试；Key 不能进入 report。
4. **流水线策略不变**：不配置 Key 时 cfg 与当前相等；配置 Key 时不改变档位顺序、模型、阈值、prompt、seed/round/floor、降级 reason 集合。
5. **仅凭据变化**：Key 只影响原有云端档的可用性，不新增 provider、不改 route、不增加 fallback。
6. **安全**：Key 只向 Host 单向流动；UI 不回显；report/run.meta/日志/诊断/客户端快照不出现完整值。引擎冻结使 Key 必须经过既有的 env 接口；wrapper 记录原 env，dispose/清空时恢复，不向子进程主动传递。

## 4. 目标架构

```text
设置 UI（evolution-ui settings）
  仅 describe/set/unset 两个固定 ref
        │ remote.credentials
        ▼
平台 credentials（唯一秘密 owner）
        │ ctx.credentials.resolve(ref)，每次 scan
        ▼
merge host：RetrievalCredentials 端口
  { embedding?: string; ranker?: string }
        │ 作为运行参数，不进入 cfg
        ▼
merge-engine.screen(input.credentials)
  ├─ engine：显式运行 Key 传入 provider（7 个声明式 sourcePatchSet）
  ├─ ④/④.5 档位、阈值、seed、降级顺序完全不变
  └─ 其余 stage / judge / seed / thresholds 完全不变
        ▼
report / run.meta / logs：无 Key
```

### 4.1 平台侧

不修改平台，只消费已有 seam：

- `packages/credentials/credentials/src/index.ts`：`resolve` 每次操作解析；`describe` 只返回 `configured/source/writable/masked`；`set/unset` 是写入路径。
- `packages/api/settings-controller/src/credentials.ts`：浏览器 `remote.credentials.describe/set/unset`，值不回传。
- `packages/client/ui-primitives/src/settings-form/*`：`SettingsSecretField` 是标准 write-only 控件；family settings 的编译面不直接引用平台 Client 源（跨 face 会破坏 rootDir），家族卡片用自己的 password 输入 + 同一 `remote.credentials` 语义，平台仍是凭据 owner。
- `packages/client/ui-settings/src/client/contract/slots.ts`：`openSettings(sectionId)` 用于合并页跳转。
- `packages/client/ui-settings-models` 是同一凭据模式的既有实现，仅作范式，不复制其业务组件。

### 4.2 插件侧

新增 `packages/evolution-merge/src/domain/retrieval-credentials.ts`：

```ts
export interface RetrievalCredentials {
  readonly embedding?: string
  readonly ranker?: string
}

/** resolve per scan; no cache across operations */
export async function resolveRetrievalCredentials(
  ctx: { get(name: string): unknown },
): Promise<RetrievalCredentials>
```

- 用 `ctx.get('credentials')` 可选读取，不允许必选注入；凭据服务缺失时返回空对象，引擎继续走现有 env 路径。
- 每次 scan 前解析，不缓存到模块变量；不写 `process.env`；作为运行参数传入 engine（不进入 cfg）。
- `evolution-merge/src/adapters/engine-screen.ts` 增加 `credentials?: RetrievalCredentials` 透传。
- `evolution-merge/src/index.ts` 不再把 Key 放进 `cfg`、`engineInput` 或 params。

### 4.3 Engine 侧（显式运行 Key，实质冻结）

用户确认：门禁应保护 skill 匹配/合并的**实质行为**（档位、模型、阈值、prompt、seed、降级、stage 顺序），而不是具体函数实现的字节。允许对 engine 做最小“凭据传输”改动；其余实质文件仍按字节校验。

实现：

- `vendor/src/scan.js` / `src/engine.js` 的 `screen(input)` 接受 `credentials?: RetrievalCredentials`，通过 `runPipeline` 的运行时 `state.retrievalCredentials` 传递；不进 cfg、不进 report。
- `vendor/src/pipeline/index.js` 的 live semantic stage 从 `ctx.state.retrievalCredentials` 取显式 Key，传给 provider；`stages/rerank.js` 同理。
- `vendor/src/screening/semantic.js` 的 `RemoteEmbedder` 使用显式 `key`（已支持 `o.key`）；`vendor/src/rerank/index.js` 的 `apiKeyConfigured/scoreRemote` 增加同语义显式 `credential`。
- **不改** stage 顺序、模型、阈值、prompt、seed/round/floor、降级链、judge 逻辑。
- `clearRetrievalCredentials` 不再需要；不写 `process.env`。

门禁升级：`verify-upstream` 从“全文件字节相等”改为“实质冻结 + 声明式传输补丁”：

- 允许 `UPSTREAM.json.sourcePatchSet` 列出的 7 个文件使用 patched hash，且 reason 必须非空、路径必须在 allowlist；
- 其余全部 vendor 文件（含 `models/registry.json`、`data/minhash_params.json`、`config/schema.js`、`screening/candidates.js`、`pipeline/compose.js`、`judge/**`、prompt 相关文件）仍必须与 upstream 字节相等；
- 新增 parity/回归测试证明无 Key 路径 cfg/report 不变、档位/阈值/seed 不漂移。
- gate-58 改名为 engine substance parity；local + ci-static 都跑。

### 4.3.1 实质覆盖清单

`UPSTREAM.json.substance` 单独冻结 19 个实质面，不依赖 7 个 sourcePatchSet 的 hash：

| 面 | 文件 | 方式 |
|---|---|---|
| 步骤顺序 | `src/pipeline/compose.js`、`pipeline/index.js` | exact |
| 配置参数默认/上下界 | `src/config/schema.js` | exact |
| 随机种子/floor jitter | `src/screening/candidates.js` | exact |
| 模型/档位/floors | `models/registry.json`、`src/embed/registry.js` | exact |
| MinHash/LSH 参数 | `src/data/minhash_params.json` | exact |
| 判定 prompt/provider | `src/judge/prompt.js`、`judge/deepseek.js` | exact |
| 降级分类 | `src/degrade.js` | exact |
| 语义选择/精排 | `screening/semantic.js`、`rerank/index.js` | 去 credential 行后 hash |
| stage 接线/scan | `pipeline/index.js`、`stages/rerank.js`、`scan.js` | 去 credential 行后 hash |
| 外层 judge/stage/report 接线 | `src/engine.js` | 去 credential 行后 hash |

`verify-upstream` 同时校验：324 文件基线 bytes/hash、7 个 sourcePatchSet、19 个 substance fingerprint；任何 steps/config/prompt/seed/threshold 改动都会红，只有 credential 传输行可从 normalize 清单排除。

```text
ENGINE SUBSTANCE OK 324 (declared credential patches: 7; substantive fingerprints: 19)
```

### 4.4 共享常量

`packages/scripts/retrieval-contract.json` 是唯一源，生成：

- host：`packages/evolution-merge/src/domain/retrieval-contract.generated.ts`
- client：`packages/evolution-ui/src/panels/settings/retrieval-contract.generated.ts`
- 合并页只读状态可复用同一个 client 生成物

字段至少：

```json
{
  "refs": { "embedding": "SILICONFLOW_API_KEY", "ranker": "BAMBOO_API_KEY" },
  "links": {
    "siliconflow": "https://cloud.siliconflow.cn/account/ak",
    "bambooRegister": "https://bamboonode.dev/register",
    "bambooKeys": "https://bamboonode.dev/tokens"
  },
  "models": {
    "embedding": "Qwen/Qwen3-Embedding-8B",
    "embeddingFallback": "BAAI/bge-m3",
    "ranker": "startlux-decision-27b-autothink"
  }
}
```

生成器带 `--check` 门禁；UI 不得再手写 refs/links/model id。

## 5. UI 信息架构与文案

### 5.1 位置

主编辑入口：**设置 → 自进化 → 检索增强（可选）**，放在家族设置页标题之后、现有参数组之前。

- 为什么不是合并页：Key 是全局服务凭据，不是单次运行参数；设置页已有家族参数和诊断，符合“全局配置在设置”。
- 合并建议页只放状态与静态指路：`检索增强：本地模式/部分云端/云端已启用` + “检索增强在设置 → 能力进化配置”；不出现 Key 输入。状态由 host view 返回布尔事实，不返回 Key。
- 点击“去设置”使用平台 `openSettings('evolution')`；若当前面板 props 不可达，只显示静态提示，不硬编码 URL/路由。

### 5.2 卡片文案（中文源，母语审校后）

```text
检索增强（可选）

想让相似技能筛得更准，可以配置下面两个 API Key（只配一个也行）。不配置也能正常使用，只用本地模型。
当前：向量和精排都用本地

SiliconFlow API Key                 [未设置]
  用于计算向量相似度；模型固定为 Qwen3-Embedding-8B（备用 bge-m3）。
  获取 SiliconFlow API Key

StartLux 精排 API Key               [未设置]
  用于精排相似技能；模型固定为 StartLux-Decision-27B。
  在 Bamboo 注册后，到 API Keys 页面新建 Key（分组选 default）。
  注册 Bamboo    获取 Bamboo API Key

API Key 只保存在本机，保存后不再显示。
改动从下一次合并扫描起生效。
                                      [保存]
```

### 5.3 文案键（最终）

| key | 中文 | English |
|---|---|---|
| `retrievalTitle` | 检索增强（可选） | Retrieval enhancement (optional) |
| `retrievalIntro` | 想让相似技能筛得更准，可以配置下面两个 API Key（只配一个也行）。不配置也能正常使用，只用本地模型。 | To screen similar skills more accurately, add the two API keys below (one is enough). Without them, screening uses only local models and still works. |
| `retrievalEmbeddingLabel` | SiliconFlow API Key | SiliconFlow API key |
| `retrievalEmbeddingHint` | 用于计算向量相似度；模型固定为 {model}（备用 {fallback}）。 | Used for vector similarity. Fixed model: {model} (fallback: {fallback}). |
| `retrievalRankerLabel` | StartLux 精排 API Key | StartLux ranking API key |
| `retrievalRankerHint` | 用于精排相似技能；模型固定为 {model}。 | Used for ranking similar skills. Fixed model: {model}. |
| `retrievalRankerHelp` | 在 Bamboo 注册后，到 API Keys 页面新建 Key（分组选 default）。 | Sign up for Bamboo, then create a key under API Keys (group: default). |
| `retrievalGetEmbeddingKey` | 获取 SiliconFlow API Key | Get a SiliconFlow API key |
| `retrievalGetRankerKey` | 获取 Bamboo API Key | Get a Bamboo API key |
| `retrievalRegisterBamboo` | 注册 Bamboo | Sign up for Bamboo |
| `retrievalConfigured` | 已设置 | Configured |
| `retrievalNotConfigured` | 未设置 | Not set |
| `retrievalSourceEnv` | 来自环境变量 | Set from an environment variable |
| `retrievalSourceStore` | 已保存在本机 | Saved on this machine |
| `retrievalCurrentLocal` | 当前：向量和精排都用本地 | Current: local vectors and ranking |
| `retrievalCurrentEnhanced` | 当前：向量和精排都走云端 | Current: cloud vectors and ranking |
| `retrievalCurrentMixed` | 当前：向量走云端，精排用本地 | Current: cloud vectors, local ranking |
| `retrievalCurrentRanker` | 当前：向量用本地，精排走云端 | Current: local vectors, cloud ranking |
| `retrievalApplyHint` | 改动从下一次合并扫描起生效。 | Changes take effect on the next merge run. |
| `retrievalSecretNote` | API Key 只保存在本机，保存后不再显示。 | API keys are stored only on this machine and never shown again. |
| `retrievalSave` | 保存 | Save |
| `retrievalWorking` | 处理中… | Working… |
| `retrievalSaved` | 已保存 | Saved |
| `retrievalCleared` | 已删除 Key | Key removed |
| `retrievalOperationFailed` | 操作失败：{message} | Couldn’t complete the change: {message} |
| `retrievalClear` | 删除 Key | Remove key |
| `retrievalUnavailable` | 当前环境不支持保存 Key；用环境变量配置仍然生效。 | This environment can’t store keys; keys set through environment variables still work. |
| `retrievalLoading` | 正在读取… | Reading… |
| `retrievalReadFailed` | 读取 Key 状态失败 | Couldn’t read key status |
| `settings.retrievalHint` | 检索增强（可选）在「设置 → 能力进化」里配置，也能看当前状态。 | Set up and check retrieval enhancement (optional) in Settings → Capability evolution. |

8 语言已经过独立母语审校：术语冻结为“检索增强 / 能力进化 / 向量 / 精排 / API Key”；模型名不翻译；所有 locale 的 `{model}`、`{fallback}`、`{message}`、URL 和技术名保持。

### 5.4 状态与交互

- 空值：`未设置`，状态行说明本地模式；允许保存空/删除。
- 已设置：只显示状态与来源，不回显 Key；来源为 `env` 时隐藏“删除 Key”，来源为 `file` 时显示并调用 `credentials.unset`。
- 凭据服务缺失：显示 `retrievalUnavailable`，禁用输入；读取失败显示 `retrievalReadFailed` + Host 诊断，不冒充“不支持存储”。
- 保存失败：显示 Host 返回的 refusal 文本，不清空已有状态。
- 保存与删除的通知分开：`retrievalSaved` / `retrievalCleared` / `retrievalOperationFailed`。
- 不在 UI 显示 API URL、模型下拉、多提供方选项。
- `测试连接` 属于后续增强，本版不做，避免把 Key 放进额外探测请求。

### 5.5 母语审校结论

- 8 个 locale 各一名独立母语审校，只读；无 P0，P1/P2 按术语统一后合并，不逐条平均。
- 术语冻结：功能名“检索增强”；设置栏目“能力进化”；步骤用“向量 / 精排”；不再用“判别”指 ④.5；模型名保留原文。
- 状态语义修正：来源为 `env` 时只读并隐藏“删除 Key”；保存与删除通知分开；读取失败与“不支持存储”分开；保存/删除共用操作失败文案。
- 链接：两个 Key 链接分别命名为“获取 SiliconFlow API Key / 获取 Bamboo API Key”，并补 Bamboo 注册链接；避免同名不同目标。
- 模型展示用产品名 Qwen3-Embedding-8B / StartLux-Decision-27B，不展示内部 slug；固定模型事实不变。

## 6. 行为矩阵

| 配置 | 向量 | 精排 | 与当前差异 |
|---|---|---|---|
| 无 Key、无 env | 本地档链 | 本地/vec | 完全不变 |
| 仅 SiliconFlow | 云端 Qwen3→bge→本地 | 本地/vec | 只启用 embedding 云端档 |
| 仅 Bamboo | 本地档链 | API→本地 Q8→Q4→vec | 只启用 rank API 档 |
| 两把 Key | 云端→本地 | API→本地/vec | 只启用两个原有云端档 |
| Key 错误 | 同无 Key 的降级路径 | 同无 Key 的降级路径 | 不新增 fallback |
| 凭据服务缺失 | 走 env | 走 env | 与当前一致 |

## 7. 验收与测试

### 7.1 不变式测试

1. 无 Key：`engine.screen` 的 `cfg` 快照与改造前基线逐字段相等；`run.meta.json`/`report.json` 不含 key 字段。
2. 有 env Key：engine 行为与改造前一致；explicit credential 与 env 值相同。
3. UI 保存后：下一次 scan 解析到；不需要重启。
4. 错误 Key：embedding/rank 的失败与降级顺序、reason 与改造前相同。
5. 清除：恢复本地/降级路径。
6. Key 不出现于日志/report/diagnostics/客户端快照；`describe` 只返回 configured/source。
7. 生成物 `--check`：refs/links/model ids 单一来源。
8. UI 文案：8 locale key 完整、无硬编码；空态/已设置/来源/不可用/清除/保存失败覆盖。
9. 真实 fresh profile：本地模式、配置、错误、清除四次运行，report 的 `used_mode` 与 provider 档位可解释。

### 7.2 测试位置

- host：`evolution-merge/tests/retrieval-credentials.spec.ts`
- engine：`evolution-merge/tests/engine-credentials.spec.ts`、`engine-config.spec.ts` 快照
- UI：`evolution-ui/tests/settings-retrieval.client.spec.tsx`、`evolution-merge-ui/tests/retrieval-status.client.spec.tsx`
- 平台 seam：复用 credentials/remote mock；不复制平台测试
- 真实：fresh npm profile 验收脚本/记录

## 8. 实施顺序与文件影响

1. **设计/契约**：本文件；`retrieval-contract.json` + 生成器 + `--check`；UI 文案 key 冻结。
2. **Engine 显式端口**：`merge-engine/src/engine.js` 接受运行 Key，7 个声明式补丁取 `ctx.state.retrievalCredentials`；更新 `UPSTREAM.json.sourcePatchSet` 与 `verify-upstream` 实质冻结门禁；重新生成 `src/index.bundle.js`。
3. **Host 凭据端口**：`evolution-merge/src/domain/retrieval-credentials.ts`、`adapters/engine-screen.ts`、`index.ts`、`scan-run.ts` 透传。
4. **UI**：`evolution-ui` settings store/card + `ui-primitives` secret field；`evolution-merge-ui` 状态/链接；8 locale。
5. **测试/文档**：上述测试、report/run.meta 泄漏测试、真实 fresh 验收；更新包 README、INSTALL、索引。
6. **发布**：全量门禁、CI、独立复核、用户确认版本后才发布。

## 9. 回退与迁移

- 无数据迁移：Key 是平台 credentials 记录；清除即恢复旧路径。
- 回退代码：删除 UI 卡片/链接，不同步 credentials；env 路径仍可用。
- 不修改 engine 配置 schema；无旧配置需要迁移。
- 不删除现有 env 变量支持；Credential refs 与 env 同名，行为兼容。

## 10. 非目标与边界

- 不提供模型名、API URL、多提供方选择；模型/端点固定。
- 不改变 ⑤ 判决；`judge` 仍由平台聊天模型/现有 runner 决定。
- 不改变 `seed_mode`、`round_count`、`floor_jitter`；当前默认 `run` 的随机性保持原样。
- 不把 Key 用于其他插件；只为冻结引擎投影到它既有的两个 env refs，并在卸载/清空时恢复。
- 不做连接测试；错误在下一次扫描中按现有降级语义暴露。
- `mergeModelsRoot` 本地模型路径仍是内部 config，不进入此 UI。

## 11. 已知问题拆分

- 当前 wrapper 的 `judge: 'deepseek'` 只是引擎统计/回退标记，实际 runner 使用 `agentDefaultModel`；本设计不改变它，另有独立 P2 记录，避免 UI 把“判别 Key”误认为最终判决配置。
- 当前 seed 默认 `run`，两次运行可能不同；本设计不改，若将来要可复现需单独 DCR。
- `ENGINE_FORBIDDEN_KEYS` 继续保留；本次不放开模型/路由配置面。

## 12. 实现进度（本 goal 内持续更新）

- 已落地：`retrieval-contract.json` + host/client generated contract + `--check` 脚本；host `resolveRetrievalCredentials`；engine `screen(credentials)` explicit runtime key（7 个声明式 sourcePatchSet；其余 vendor 字节与 19 个实质 fingerprint 通过；engine 4 个测试）；`evolution-ui` 设置页 `RetrievalCard`（两把可选 Key、来源、保存/清除、不可用/失败状态）；`retrieval-credentials` 单测、`retrieval-card` 10 个组件测试、`MergeSettings` 1 个指路测试、UI 8 locale 经独立母语审校。
- 已落地：合并建议页显示 host view 的 retrieval 布尔事实（本地/部分云端/云端已启用）和静态指路“设置 → 能力进化”；不返回 Key，不出现输入框；
- 真机验证：lab84 fresh profile（0.60.1 dev pack）最终设置页截图 `D:/dsh/_lab84_settings_final2.png`；假 Key 保存后显示“向量走云端，精排用本地 / 已保存在本机”，清除后回到本地模式（测试 key 已清除）。
- 待落地：合并页可点击打开设置（需平台公开 openSettings seam）、全量门禁/发布链、真实官方 API Key 端到端。
- 已知偏差/修正：explicit runtime key 需要 7 个声明式 sourcePatchSet，DCR-6 已把门禁从字节冻结改为实质冻结；UI 字段使用家族自己的 password 输入而非直接 import 平台 `SettingsSecretField`（编译 face 约束）；凭据写入仍是平台 `remote.credentials`，语义不变。

## 12.1 DCR-6：实质冻结取代字节冻结（用户确认 2026-11-24）

字节冻结的本意是防实质回退，不是禁止为实现逻辑等价变化而改具体函数。为完成 UI 凭据接入，采用 explicit runtime key：

- 7 个文件进入 `sourcePatchSet`（凭据传输 + pipeline + 两个上游 prompt-input 补丁），逐文件写 reason；
- 其余 vendor 文件仍字节冻结；实质面（模型/阈值/prompt/seed/降级/stage 顺序）由未修改文件的 hash 和 parity 测试共同保护；
- 不再使用 env 投影，不写 `process.env`；
- 门禁 `verify-upstream` 现在验证“允许的传输补丁 + 其余字节相等”，不是无条件字节相等。

这取代 DCR-5 的 wrapper env 方案。

## 12.2 本轮验证状态（2026-11-24）

- 定向：30 tests 通过（engine explicit-key 2、engine substance 4、host resolver 3、UI card 10、merge settings/status、merge routes、api retrieval、i18n/gates）。
- 本地全量：Node 22 + `D:\dsh-homes\_suite-home` 下 3122 passed / 6 failed；6 个失败全部是 `evolution-host/tests/installer.spec.ts` 与 `installation-matrix.spec.ts` 的本地 installer 环境（EPERM `evolution` mkdir / 60s 超时），无 feature 失败。
- CI 全量已绿：run `45221992667`（commit `b8be64eb`）9/9 jobs 成功：platform line、pack release bytes、cohort validate、validate released upstream、validate node22、desktop install、cohort evidence；publish 未执行（非发布 tag）。
- 本地门禁：`run-gates local` pass=62 / fail=0 / cannotDecide=3（gate-05 构建产物、gate-29 缺 plane home、gate-81 health admission；均为未注册 cannot-decide，后续按 gate 语义收口）；已重新生成 `line-manifest.json` / `check-taxonomy.json` 并同步 overlay。
- engine 实质门禁：`ENGINE SUBSTANCE OK 324 (declared credential patches: 7; substantive fingerprints: 19)`。
- 未发布；最终 fresh npm/web 验收和独立复核待后续轮次。

## 13. 与审计台账的关系

- 完成 80-p2-ledger 中可随本组收口的 P2；其余按 owner/reason/expiry/判据保留或 DEFERRED。
- 若实现中发现本文未覆盖的架构变化，先更新本文/10/11 或写 DCR，再改代码。
