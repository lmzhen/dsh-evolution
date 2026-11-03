# @lmzhen/dsh-evolution-review

复盘是在任务收尾时回头看一眼：刚才发生了什么，下次哪里可以改。

默认累计约 10 次工具调用后触发，会叫醒模型多跑一轮，所以你会看到一条额外的自我复查消息。它不是每句话都跑，也不是每次都会写出一个 skill；真正写入还是走 skill 的写入路径。

`inject` 是默认模式，在会话内做。`branch` 另起子会话，需要额外支持，当前还有通知边界。

## 维护者参考：参数别名（G0/S0.3）

`memoryInterval` 映射为 `reviewMemoryInterval`；`skillInterval` 映射为 `reviewSkillInterval`。旧名仍可读，写入会拒绝。
