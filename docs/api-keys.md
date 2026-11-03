# 模型与 API key

## 基本原则

dsh-evolution 不建立自己的 API key 存储。需要模型的功能使用 DeepSeek Harness 的 `llm` 服务和当前模型配置；DeepSeek 官方默认可通过 `DEEPSEEK_API_KEY` 或模型设置页配置。

本地 potion 合并模型是另一类依赖，不是 API key，见 [技能合并](#技能合并使用本地模型)。

## 各功能的模型要求

| 功能 | 默认状态 | 模型要求 | 没有可用模型/key 时 |
|---|---|---|---|
| 自动复盘 | 开，`reviewMode=inject` | 当前会话模型 | 复盘请求无法完成或跳过，并记录警告 |
| 子会话复盘（`reviewMode=branch`） | 非默认 | 当前模型和子会话支持 | 不可用；还受通知边界限制 |
| 整理器 LLM 提名（`llmReview=true`） | 关 | `curatorProvider` + `curatorModel`，默认 `deepseek-official` / `deepseek-v4-pro` | 只跑确定性整理，报告写明 LLM 通道未运行 |
| 技能发现域生成（discovery `mode=on`） | 关 | `generationProvider` + `generationModel`，默认 `deepseek-official` / `deepseek-flash` | 以 `llm-unavailable` 明确失败，不静默降级 |
| 维护扫描的模型部分 | 手动触发 | `evolutionPolicy.curatorModel`（默认 `deepseek-v4-pro`），provider 由子代理/平台解析 | 只能得到确定性扫描结果 |
| merge scan 的引擎判断 | 有模型才使用 | 当前默认模型 | 回退 stub；本地 potion 筛选模型仍是必需条件 |
| 普通 merge pair 的 round1/authoring | 显式 pair 时 | 子会话模型与子会话通道 | 不使用本地 potion 筛选，也没有 scan 的 stub 降级路径 |

不需要 API key 的功能包括记忆和技能读写、历史与撤销、技能健康、`/graph`、审批、`skill_search` 本地检索、整理器确定性部分，以及合并的本地筛选模型。

## Web / 桌面配置

1. 打开 DSH 的「设置 → 模型（Models）」。
2. 选择或新增 provider。
3. 在 API key 输入框填入 key 并保存。
4. 回到会话，选择使用该 provider 的模型。

密钥由 DSH 凭据层保存在 `$DSH_HOME/.credentials.yaml`，配置中只保留引用；它不是家族设置 `$DSH_HOME/settings.yaml` 的内容。轮换 key 不需要重装插件。

## CLI / headless 配置

启动 DSH 前设置：

```bash
export DEEPSEEK_API_KEY=sk-...
# 可选；默认就是官方端点
export DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Windows PowerShell：

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
$env:DEEPSEEK_BASE_URL = "https://api.deepseek.com"  # 可选
```

**优先级只针对 API key**：继承的进程环境变量优先于 `.credentials.yaml`，因此环境里的旧 key 会遮住模型页保存的新 key。不要把它理解为所有配置的通用规则；例如显式 `baseURL` 配置优先于 `DEEPSEEK_BASE_URL`。

不要把真实 key 提交到仓库，也不要写进 `settings.yaml` 或 `cordis.patch.yml`。

## 使用其它 provider

在 DSH 模型设置中配置 provider、模型和 key 后，复盘及 merge scan 的引擎判断会使用当前会话或默认模型，普通 pair 的 round1/authoring 使用子会话模型。另有三项部署级身份配置：

- 整理器 LLM 提名：`evolution-curator` 行的 `curatorProvider` / `curatorModel`，只在 `llmReview=true` 时使用。
- 维护扫描的模型部分：使用 `evolutionPolicy.curatorModel`（默认 `deepseek-v4-pro`）；provider 由子代理/平台解析，不是当前会话模型的选择链。
- 技能发现域生成：`evolution-skill-discovery` 行的 `generationProvider` / `generationModel`，只在 `mode=on` 时使用。

这些是部署配置，不是每次会话的 key 输入框。

## 技能合并使用本地模型

scan 的候选筛选使用本地 potion 模型文件，根目录由 `mergeModelsRoot` 指定，不会自动下载：

```text
potion-multilingual-128M-int8/
potion-multilingual-128M-pca64-int8/
```

缺少这些文件时 `/evolution merge doctor` 会提示，`merge scan` 会失败。scan 的引擎判断可以额外使用当前模型；未配置时回退 stub。普通 pair 不经过这套本地筛选，round1/authoring 需要子会话模型。整理器的 `curatorProvider` / `curatorModel` 与这里的本地筛选模型也不是同一配置。

## 本地数据与模型数据边界

记忆、技能、报告和运行记录会落盘到 `$DSH_HOME`，准确路径见 [operations.md](operations.md#数据路径)。**本地落盘不等于数据不离开本机**：启用复盘、LLM 整理、发现域生成、维护扫描模型部分、scan 引擎判断或 pair 子会话时，完成该功能所需的会话或技能内容会发送给相应模型 provider。scan 的候选筛选使用本地模型，不代表后续引擎判断也一定离线。

家族按设计不主动保存 API key，平台和输出路径会做敏感信息规避，但脱敏是 **best-effort**，不能识别所有密钥格式，也不能替代数据分级和人工审查。不要把 key、令牌或其它秘密贴进对话、技能正文、记忆或 Cordis 配置；已经误贴时应轮换对应凭据，而不只是删除文本。

## 验证

1. 先在 DSH 会话中正常发一条消息，确认当前模型能回复。
2. 再验证目标功能：
   - 复盘：完成满足实质信号的任务，或调小相应复盘间隔；
   - 整理器 LLM：开启 `llmReview` 后运行 `/evolution curator run`；
   - 发现域：开启 `mode` 后运行 `/skill-domain status` 或 `generate`；
   - 合并：先运行 `/evolution merge doctor`，再启动小规模 scan/pair。
3. 失败时查看 `/evolution doctor`、宿主日志、整理报告中的 `llm channel absent` 或 timeout 文案。
