# P2：平台接缝类型与真实形状对齐（sendMessage / configEditor）

范围：05-platform-seam P2-1、P2-5。
- `SubagentsPort.sendMessage` 的 `options` 是可选，平台必填且会 `options.signal.throwIfAborted()`；
- `ConfigEditorPort.configuration` 声明为 `Promise<unknown>`，平台实际同步返回数组。

## 设计

- `SubagentsPort.sendMessage?` / adapter 服务形状：`options: SubagentSendOptions` 必填；
  - 唯一调用方已总带 options，本次是类型真相，不改变行为。
- `ConfigEditorPort.configuration` / adapter 服务形状：`(): unknown`；
  - 消费者 `arrayOf` 已经 `await`，同步数组仍正常工作；
  - 不再假装平台返回 Promise。

## 验证

- build 0；
- evolution-adapter + evolution-commands 测试：19 files / 176 tests passed；
- arch/doc 0。

## 回退

恢复可选/Promise 声明即可；无运行时分支。
