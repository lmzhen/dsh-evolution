# 文本预算与门控

文本门控只回答一个问题：这段文字在哪个轴上超了多少。轴和单位先定，阈值后定；不要按语言或 UI locale 各设一套阈值。跨语言公平由同一把尺子实现，locale 只影响文案。

| 轴 | 单位 | 用途 |
|---|---|---|
| storage | UTF-8 bytes / Unicode codePoints | 落盘、文件大小、名称等存储上限 |
| display | grapheme clusters | 界面显示、截断、description、摘要 |
| context | 估算 tokens | 模型上下文预算 |
| quality | codePoints / 次数 / 文件数 | 文档卫生、churn、support sprawl 等信号 |

token 是写入前的保守估算：`max(ceil(codePoints / 4), ceil(UTF-8 bytes / 3))`。它是门控上界，不是 provider 返回的精确用量；界面和报告必须标“估算”。

## 当前门控

| 门控 | 轴 | 单位 | 默认值 | 严重度 |
|---|---|---|---:|---|
| 技能正文硬上限 | storage | codePoints | 100,000 | hard |
| 技能文件大小 | storage | UTF-8 bytes | 1,048,576 | hard |
| 技能名 | storage | codePoints | 64 | hard |
| description 硬上限 | display | graphemes | 1,024 | hard |
| description 作者线 | display | graphemes | 60 | soft；strict 时 hard |
| 版本摘要 | display | graphemes | 50 | hard |
| 反馈 note | display | graphemes | 20 | hard |
| 行过长 | display | graphemes | 1,500 | soft |
| 正文软线 | context | tokens | 7,273 | soft；2x 为 needs-restructure |
| memory / user | context | tokens | 800 / 500 | hard；80% 软提示 |
| substantive user/agent | display | graphemes | 200 / 500 | soft |
| retention feedback | display | graphemes | 200 | soft |
| stamp 密度 | quality | codePoints / KB | 2 | soft；正文 ≥ 2,000 codePoints 才测量 |
| churn | quality | count | 20 patches | soft |
| hard-cap hits | quality | count | 3 | soft |
| support sprawl | quality | count | 60 files | report |
| merge rationale | display | graphemes | 150 | prompt 约束，不硬拒 |
| diff / preview | display | graphemes | 4,000 / 2,000 / 200 | 展示截断 |
| fuzzy pattern | storage | codePoints | 4,096 | 内部保护 |
| 安全扫描窗口 | storage | codePoints | 65,536 | 安全参数；重叠窗口覆盖全文 |

## 迁移

- 旧 `maxSkillContentChars` / `maxDescriptionLength` / `summaryChars` 继续作为迁移输入，显式设置时按旧语义工作。
- 旧 `softBodyChars` 设置后只转换一次：`tokens = round(chars / 2.75)`；未设置时使用 `7,273`。
- 旧 `memoryChars` / `userChars` 在 row 上显式设置时保持字符模式；只出现在 policy 时按 2.75 字符/token 换算。新旧字段冲突由 doctor 报出。
- 旧报告、版本记录和统计历史保留原始字符事实，不会补写成 token，也不会伪造 provider usage。

## 不做

- 不按中文/英文/日文等语言分别调整阈值；不因 UI locale 改变门控。
- 不把平台 `token-meter` 的固定 4 chars/token 估算当作插件门控，也不把插件估算冒充平台实际占用。
- 不用 tokenizer 依赖去“精确”卡所有文本；需要时通过 `TokenEstimator` 注入，默认保持零依赖。
