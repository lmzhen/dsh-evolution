# P2：registerEvolutionTool 不再静默 no-op

范围：05-platform-seam P2-4。
- `adapter/src/tools.ts` 的 `registerEvolutionTool` 在 `tools` 服务缺失时返回空 disposer，工具不注册、无日志、无重试；
- 组合里 family row 早于平台 `tools` row 时会静默少工具。

## 设计

- 缺失 `tools`：
  - `ctx.logger.warn` 明确写出未注册的工具名；
  - 仍返回 no-op disposer（保持调用方可组合）。
- 存在 `tools`：行为不变，`toolsPort.register`。
- 不改变平台依赖顺序；只是把静默失败变成可见。

## 验证

- build 0；
- 新增 adapter 测试：
  - 缺失 tools 时调用 warn；
  - 存在 tools 时 register 被调用；
- adapter 3 files / 10 tests passed；
- doc/arch 0。

## 回退

恢复 `?? (() => {})` 静默分支；无 API/行为其他变化。
