# Aux 后台 review：完成语义与 PTC 适配决策

> 状态：用户决策记录（2026-11-20）
> 范围：`evolution-review` 的 aux 后台 review；不改变当前已发布的 `0.58.0` 行为，作为下一次实现的设计输入。
> 背景：桌面端 aux 仍在运行，但现有成功/失败记录只能证明工具层结果，无法证明 review 在语义上完成了全部技能修改。

## 1. 已确认要做的三件事

### 1.1 达到轮数或时间上限时标记 `partial` / `truncated`

- 当前默认 `reviewMaxRounds = 12`、`reviewTimeoutMs = 120_000`。
- 当前达到轮数上限后循环正常返回，随后只要 `toolAllow` 非空就标 `completed`；从记录上无法区分“真正完成”和“被上限截断”。
- 目标：达到任一上限且最后一轮仍有工具调用时，必须记录为 `partial`（或 `truncated`），不得标 `completed`。
- review 记录至少持久化：`requests`、`toolCalls`、`hitRoundLimit`、`timeout`、`partialReason`。
- UI/活动记录要能看出“未完成/被截断”，而不是只显示成功。

### 1.2 模型最后调用 `review_done` 工具作为完成契约

- 当前完成条件只是“模型某一轮没有发工具调用”或“循环自然结束”，没有显式完成声明。
- 目标：新增一个仅供 aux review 使用的 `review_done` 工具；模型在确认本次 memory/skill 修改完成后显式调用它。
- 只有收到 `review_done` 且没有未完成的工具调用，才能标 `completed`。
- 未收到 `review_done` 就结束：按 `partial`/`failed` 处理，并在记录中说明原因。
- `review_done` 的返回应要求模型给出简短完成说明（例如 memory 是否有写入、技能是否修改、是否有无法完成的项），供活动记录和用户可见摘要使用。

### 1.3 PTC 适配

- 当前 PTC 会话父 header 只暴露 `run_code`；aux 的 `toolAllow` 为空，直接失败：
  `aux review has no allowed tools for this parent (PTC-only header); refusing to report completed`
- 目标：为 aux review 提供 PTC 传输适配，使 PTC 会话也能执行 memory/skill review，而不是空结果或失败。
- 适配实现方式待设计；需要保持父会话 no-append 约束，不能把 review 工具结果写进父会话日志。

## 2. AUX 拆分与并行（必须做）

用户决定（2026-11-20）：

- **AUX 不再禁止 memory 与 skill 两个 review 并行。** 当前“每个 session 只允许一个 aux review，第二个只设 rerun，且 skill 触发时使用 combined prompt”的形态不是长期目标。
- 后台的 memory 与 skill **提示词分开**；两者同时触发时各自独立运行，不再拼成一条 combined prompt。
- 前台 inject 模式保持现状：它发生在同一个父会话/同一条上下文里，顺序或 combined 是合理的；本次不改前台提示词。
- 原因：多会话同时进行时，family 自身的单飞/合并会让一个会话里的 memory/skill 互相等待，放大延迟和截断风险，也让两个提示词互相污染。

实现边界：

- 分析/LLM 调用可以并行；**写入提交仍由 mutation authority / per-file lock 串行**，不能假设并行写是安全的。
- pending/running 状态按 `(session, kind)` 区分，使用独立的 runId / lease；activity 记录也按 kind 分开，便于判断 memory 和 skill 各自的成功/失败。
- 当前 `auxRunning` 是 per-session 的，不是全局锁；但 combined prompt 和 `rerun` 仍是 family 层的串行策略，需要一起移除。
- 并行后仍需保持父会话 no-append，并保留各自的 timeout、cancel、`partial` 和 `review_done` 完成语义。

## 3. 暂缓：多位置修改的完整性校验

用户判断：

- 多位置技能修改先信任大模型的 agent 能力，不在本轮为它增加逐位置校验或结构化检查。
- 等未来获得更丰富的运行信息后，再决定是否增加语义完整性验证。
- 当前不因“可能漏改多个位置”而阻塞上述三项；上述三项先解决“截断被误报成功”和“PTC 不可用”的问题。

## 4. 现状证据（只用于说明问题，不是实现验收）

- 桌面端 `activity.json` 当前保留 200 条：completed 86、failed 113、timeout 1。
- 113 条失败中 112 条是历史 `review requires an idle parent`，发生在 2026-11-17/18；之后未复发。
- 现有成功记录没有 `requests` / `hitRoundLimit` / `partial` 字段；`skill_manage:ok` 的次数也不等于真实文件 mutation 次数，因此“成功”不能作为“所有修改完整完成”的证据。
- 当前代码默认值：`DEFAULT_REVIEW_MAX_ROUNDS = 12`（review 包）、`DEFAULT_REVIEW_TIMEOUT_MS = 120_000`（core）；桌面 profile 只覆盖了两个 cadence interval，未覆盖上限。

## 5. 未来实现的验收口径

1. 构造“最后一轮仍在改技能”的测试：记录必须为 `partial`，不能是 `completed`。
2. 构造“模型没有调用 `review_done` 就结束”的测试：记录必须为 `partial`/`failed`。
3. 构造“调用 `review_done` 且工具调用全部成功”的测试：记录为 `completed`，并包含完成摘要。
4. PTC 会话下：能完成至少一次 memory/skill review；父会话事件序列不增加 review 工具消息。
5. 活动记录和 UI 能区分 `completed` / `partial` / `failed` / `timeout`，并显示 partial/timeout 原因。

## 6. 非目标

- 本轮不实现“多位置修改”的逐项校验或模型自检协议。
- 本轮不改变前台 inject 模式的提示词内容；只处理 aux 的完成语义与 PTC 通道。
- 不把 PTC 的 `run_code` 结果写进父会话日志。
