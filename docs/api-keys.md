# 需要模型 / API key 的功能

## 先给结论

dsh-evolution **不自己保存 API key**。需要模型的功能都走 DeepSeek Harness 的 `llm` 服务；你只要在 DSH 里配好一个可用的模型提供方，家族功能就用它。

最常用的是 DeepSeek 官方：配一个 `DEEPSEEK_API_KEY`（或通过模型设置页保存），下面这些功能就能用。

## 哪些功能需要模型

| 功能 | 默认 | 需要什么 | 没有模型/key 时 |
|---|---|---|---|
| 自动复盘 | 开，会话内 | 当前会话的模型 | 静默跳过；宿主日志 warn |
| 子会话复盘（`reviewMode: branch`） | 关 | 当前模型 + 子会话支持 | 不可用；不建议普通用户开 |
| 整理器的 LLM 提名（`llmReview: true`） | 关 | `curatorProvider` + `curatorModel`，默认 `deepseek-official` / `deepseek-v4-pro` | 只跑确定性整理；报告写“LLM 通道未运行” |
| 技能发现域生成（discovery `mode:on`） | 关 | `generationProvider` + `generationModel`，默认 `deepseek-official` / `deepseek-flash` | 启动失败（`llm-unavailable`），不是降级 |
| 维护扫描的模型部分 | 手动触发 | 当前模型/子代理 | 只能拿到确定性扫描结果 |
| 合并的深度判断 | 配了模型才用 | 当前模型（`llm` + 默认模型） | 回退到 stub 判断；仍需要本地 potion 模型文件 |

不需要 API key 的功能：记忆读写、技能读写/历史/撤销、技能健康、`/graph`、审批、`skill_search` 的本地检索、整理器的确定性部分、合并的本地筛选模型。

## 怎么配：Web / 桌面

1. 打开 DSH 的 **设置 → 模型（Models）**。
2. 选择 DeepSeek（或你已有的 provider）；没有就新增一个。
3. 在 API key 输入框填入 key，保存。
4. 回到会话，选一个使用该 provider 的模型。

密钥不会写进 `settings.yaml`；它由 DSH 的凭据层保存（`$DSH_HOME/.credentials.yaml`），配置里只保留引用。换 key 后一般不需要重装插件。

## 怎么配：CLI / headless

启动 DSH 前设置环境变量：

```bash
export DEEPSEEK_API_KEY=sk-...
# 可选，默认官方端点
export DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Windows PowerShell：

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
```

环境变量优先级高于配置文件；不要把真实 key 提交到仓库，也不要写进 `cordis.patch.yml`。

## 用其它 provider

在 DSH 的模型设置里配好 provider、模型和 key，家族功能会跟随当前会话/默认模型。

两个功能有自己的 provider/model 配置，默认是 DeepSeek 官方：

- **整理器 LLM 提名**：在 `evolution-curator` 行配置 `curatorProvider` / `curatorModel`；只在 `llmReview: true` 时用。
- **技能发现域生成**：在 `evolution-skill-discovery` 行配置 `generationProvider` / `generationModel`；只在 `mode:on` 时用。

这两个是部署级配置，普通用户不用改；用默认 DeepSeek 时保持默认即可。

## 合并：本地模型，不是 API key

合并的候选筛选用本地 potion 模型文件，路径由 `mergeModelsRoot` 指定；它**不会自动下载**，也不是 API key。

目录下需要：

```text
potion-multilingual-128M-int8/
potion-multilingual-128M-pca64-int8/
```

没有这些文件时 `/evolution merge doctor` 会提示，`merge scan` 会失败。合并的深度判断会额外使用当前模型（如果配了）；没配则回退 stub。

## 验证

1. 在 DSH 里正常发一条消息，确认模型能回复——这说明当前模型/key 可用。
2. 触发一次需要模型的功能：
   - 复盘：正常干活到收尾，或调小 `reviewMemoryInterval`；
   - 整理 LLM：`llmReview: true` 后跑 `/evolution curator run`；
   - 发现域：`mode:on` 后 `/skill-domain status` / `generate`。
3. 失败时看：`/evolution doctor`、宿主日志、整理报告里的 `llm channel absent` / timeout 文案。

## 安全

- 家族不会把 key 写进技能、记忆、报告或事件日志；
- 不要把 key 贴进对话、技能正文或 `cordis.patch.yml`；
- 换 key/轮换后，下一次请求就会用新值，不需要重装；
- 没有 key 时功能应当明确失败或降级，不会假装成功。
