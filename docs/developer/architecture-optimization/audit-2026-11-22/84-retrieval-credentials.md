# 84. 检索增强凭据：可选 Key、固定模型与降级不变设计

状态：设计基线 v1（2026-11-23，待实现）。  
适用范围：`evolution-merge` 的 ④ 向量、④.5 精排/判别；不包含 ⑤ 最终判决。  
上位文档：[10-system-framework.md](10-system-framework.md)、[11-target-architecture.md](11-target-architecture.md)。  
任何偏离本设计的实现必须先改本文或写 DCR/supersede，禁止代码先漂移。

## 1. 结论

把两把 API Key 的**来源**从后台配置/环境文件搬到 UI，但不改变检索流水线的模型、阈值、种子和降级策略。

- 唯一可编辑项：`SILICONFLOW_API_KEY`、`BAMBOO_API_KEY` 的凭据值。
- 模型、端点、档位顺序、阈值、prompt、`seed_mode`、`round_count`、`floor_jitter` 全部固定，不进入 UI。
- Key 由平台 `ctx.credentials` 解析，UI 通过 `remote.credentials` 写入；不新增插件自有 secret 存储，不把 Key 放进 `cfg` / report / run.meta / 日志 / 客户端快照；为适配字节冻结的引擎，wrapper 只把它投影到引擎既有的两个 env refs。
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
- 精排：`rerank/index.js` 的 `scoreRemote` **只**读 `process.env[BAMBOO_API_KEY]`。
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
  ├─ wrapper：投影到引擎既有的 env Key 接口（vendor 字节冻结）
  ├─ ④/④.5 仍按原 env 读取与档位顺序执行
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
- 每次 scan 前解析，不缓存到模块变量；host 不直接写 `process.env`，由 engine wrapper 投影到冻结引擎的既有 env Key 接口。
- `evolution-merge/src/adapters/engine-screen.ts` 增加 `credentials?: RetrievalCredentials` 透传。
- `evolution-merge/src/index.ts` 不再把 Key 放进 `cfg`、`engineInput` 或 params。

### 4.3 Engine 侧（wrapper-only，vendor 字节冻结）

`packages/evolution-merge-engine/README.md` 明确要求 ①-⑤ 冻结，变更必须 wrapper-only；`verify-upstream` 对 324 个 vendor 文件做字节校验。因此初始计划里的“运行状态透传”不可用：不能改 vendor 的 stage/provider 签名。

采用 wrapper-only 的凭据桥：

- `packages/evolution-merge-engine/src/engine.js` 的 `screen(input)` 接受 `credentials?: RetrievalCredentials`；
- wrapper 把两个值投影到引擎本来就读取的 env refs：
  - embedding → `SILICONFLOW_API_KEY`
  - ranker → `BAMBOO_API_KEY`
- 写入前记录原 env；`clearRetrievalCredentials()` 或下一次扫描传空对象时恢复；host 在插件 dispose 时调用 clear；
- 不修改 vendor 文件、不改 `cfg`、不改 report/run.meta；
- semantic/rerank 的档位、阈值、prompt、seed、降级链不变；Key 只让原 env 路径从“无值”变为“有值”；
- 不在 host 层直接写 env；写 env 是 wrapper 对冻结引擎的适配，不是第二套凭据源。

这是对“运行参数透传”初始设计的明确修正：vendor 冻结优先于 transport 美观；代价是同一进程内两个扫描共享同一组 UI Key（凭据本来就是全局 refs）。错误 Key 仍走原降级链，不新增 fallback。

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
- 合并建议页只放一行状态/入口：`检索增强：本地模式 [去设置]` / `检索增强：云端已启用 [去设置]`；不出现 Key 输入。
- 点击“去设置”使用平台 `openSettings('evolution')`；若当前面板 props 不可达，只显示静态提示，不硬编码 URL/路由。

### 5.2 卡片文案（中文源）

```text
检索增强（可选）

为追求更优的相似 skill 筛选能力，可配置以下 API。
不配置也可正常使用，仅使用本地模型。

硅基流动 API Key                  [未设置]  [设置]
  用于向量相似度；固定模型 Qwen3-Embedding-8B（备用 bge-m3）
  获取 Key：登录硅基流动 → API 密钥 → 新建并复制
  https://cloud.siliconflow.cn/account/ak

StartLux 判别 API Key             [未设置]  [设置]
  用于精排判别；固定模型 StartLux-Decision-27B
  获取 Key：Bamboo 注册后在 API Keys 创建（分组选 default）
  https://bamboonode.dev/register
  https://bamboonode.dev/tokens

当前：本地模式 · 配置后下一次合并扫描生效
Key 只保存在本机凭据中，不会回显。
```

### 5.3 文案键

| key | 中文 | English |
|---|---|---|
| `retrieval.title` | 检索增强（可选） | Retrieval enhancement (optional) |
| `retrieval.intro` | 为追求更优的相似 skill 筛选能力，可配置以下 API。不配置也可正常使用，仅使用本地模型。 | For better similar-skill screening, you can configure the APIs below. Without them, local models are used and the pipeline still runs. |
| `retrieval.embedding.label` | 硅基流动 API Key | SiliconFlow API key |
| `retrieval.embedding.hint` | 用于向量相似度；固定模型 Qwen3-Embedding-8B（备用 bge-m3）。 | Used for vector similarity. Fixed model: Qwen3-Embedding-8B (fallback bge-m3). |
| `retrieval.ranker.label` | StartLux 判别 API Key | StartLux decision API key |
| `retrieval.ranker.hint` | 用于精排判别；固定模型 StartLux-Decision-27B。 | Used for reranking. Fixed model: StartLux-Decision-27B. |
| `retrieval.getKey` | 获取 Key | Get key |
| `retrieval.configured` | 已设置 | Configured |
| `retrieval.notConfigured` | 未设置 | Not configured |
| `retrieval.sourceEnv` | 来源：环境变量 | Source: environment |
| `retrieval.sourceStore` | 来源：本机凭据 | Source: local credentials |
| `retrieval.currentLocal` | 当前：本地模式 | Current: local models |
| `retrieval.currentEnhanced` | 当前：云端增强已启用 | Current: cloud enhancement enabled |
| `retrieval.currentMixed` | 当前：向量云端 · 判别本地 | Current: cloud embeddings · local ranking |
| `retrieval.currentRanker` | 当前：向量本地 · 判别云端 | Current: local embeddings · cloud ranking |
| `retrieval.applyHint` | 配置后下一次合并扫描生效。 | Applies to the next merge scan. |
| `retrieval.secretNote` | Key 只保存在本机凭据中，不会回显。 | Keys are stored in local credentials and never displayed again. |
| `retrieval.clear` | 清除 | Clear |
| `retrieval.unavailable` | 当前部署未提供凭据服务，无法在此保存 Key；仍可使用环境变量。 | Credential storage is unavailable in this deployment; environment variables still work. |

英文为 sentence case；其余 6 语言按 locale 流程由母语审校，不硬编码、不直译模型名和 URL。

### 5.4 状态与交互

- 空值：`未设置`，状态行说明本地模式；允许保存空/清除。
- 已设置：只显示 `已设置` 与来源，不回显 Key；`清除` 调用 `credentials.unset`。
- 凭据服务缺失：显示 `unavailable`，禁用输入；后台 env 仍可工作。
- 保存失败：显示 Host 返回的 refusal 文本，不清空已有状态。
- 不在 UI 显示 API URL、模型下拉、多提供方选项。
- `测试连接` 属于后续增强，本版不做，避免把 Key 放进额外探测请求。

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
2. **Engine wrapper**：`merge-engine/src/engine.js` 的 env 桥、`clearRetrievalCredentials`、重新生成 `src/index.bundle.js`；vendor 零改动，`verify-upstream` 324 文件保持通过。
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

- 已落地：`retrieval-contract.json` + host/client generated contract + `--check` 脚本；host `resolveRetrievalCredentials`；engine `screen(credentials)` wrapper-only env 桥（vendor 324 文件字节校验通过，engine 2 个桥测试）；`evolution-ui` 设置页 `RetrievalCard`（两把可选 Key、来源、保存/清除、不可用/失败状态）；`retrieval-credentials` 单测、`retrieval-card` 5 个组件测试、UI 8 locale key。
- 已落地：合并建议页高级区静态提示“检索增强在设置 → 自进化配置”（当前面板 props 无 openSettings，不硬编码路由；状态入口待平台公开 seam）；
- 待落地：合并页可点击状态入口、真实 fresh 验收、全量门禁/发布链。
- 已知偏差/修正：初始“运行状态透传”改为 wrapper-only env 桥（vendor 冻结）；UI 字段使用家族自己的 password 输入而非直接 import 平台 `SettingsSecretField`（编译 face 约束）；凭据写入仍是平台 `remote.credentials`，语义不变。

## 13. 与审计台账的关系

- 完成 80-p2-ledger 中可随本组收口的 P2；其余按 owner/reason/expiry/判据保留或 DEFERRED。
- 若实现中发现本文未覆盖的架构变化，先更新本文/10/11 或写 DCR，再改代码。
