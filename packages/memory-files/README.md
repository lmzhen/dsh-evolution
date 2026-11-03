# @lmzhen/dsh-memory-files

> 本地 MEMORY.md / USER.md provider + 预算服务。

## 它做什么

注册 files provider；MemoryStore 文件语义（去重/日期前缀/预算/漂移/威胁/退避）；预算解析/clamp/floor；evolutionMemoryBudget；写串行。

## 入口

Cordis 行 memory-files；evolutionMemoryBudget。

## 依赖与默认

需要 memory + evolutionIo；可选 policy/settings。

## 边界

硬依赖 io；相对 root 解析；read 不进写队列；单进程；旧预算名仍保留但写入被拒。

## 代码位置

`src/index.ts`
