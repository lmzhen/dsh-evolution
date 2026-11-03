# @lmzhen/dsh-evolution-memory-files

文件形式的记忆存储。项目记忆和用户画像分别写在 `$DSH_HOME/memories/MEMORY.md` 和 `USER.md`，写入前检查字符预算，写满后新增会被拒绝。

## 维护者参考：参数别名（G0/S0.3）

`memoryCharLimit` 映射为 `memoryChars`；`userCharLimit` 映射为 `userChars`。旧名仍可读，写入会拒绝。
