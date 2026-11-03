# @lmzhen/dsh-evolution-review

> 后台复盘：在任务收尾时回顾对话并给改进建议。

## 你会看到

偶尔出现在会话里的复盘提示；不是每句话都跑。

## 什么时候会用到

累计约 10 次工具调用、任务收尾时。

## 默认 / 前提

默认在会话内，按约 10 次工具调用触发；会叫醒模型多跑一轮。

## 边界

子会话模式需要 agents；当前有已知通知边界。

## 维护者参考：参数别名（G0/S0.3）

`memoryInterval` 映射为 `reviewMemoryInterval`；`skillInterval` 映射为 `reviewSkillInterval`。旧名仍可读，写入会拒绝。
