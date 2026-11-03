# @lmzhen/dsh-evolution-learning-graph

> 技能 + 记忆学习图，/graph 命令。

## 它做什么

/graph 目录、detail、edit、delete；技能写走 approval + write gate，记忆写走 memory.applyBatch；节点/边各 200 行上限。

## 入口

/graph …。

## 依赖与默认

需要 commands/skillUsage/memory/evolutionIo；写需要会话。

## 边界

不是 /evolution 子命令；编辑/删除需要审批落点；memory 节点受 E-21 快照校验；跨源保护由写门禁决定。

## 代码位置

`src/index.ts`
