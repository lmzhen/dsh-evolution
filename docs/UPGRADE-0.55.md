# 升级到 0.55.0：文本预算与 UI 文案

0.55.0 不改变用户数据格式：记忆、技能、版本历史、审批记录、合并报告都保持原文件布局。变化只在**写入前的预算口径**、**健康判定**和**界面文案**。

## 升级前

1. 备份 `$DSH_HOME/settings.yaml`、`profiles/<profile>/cordis.patch.yml`、`memories/`、`skills/`、`evolution/`；需要保留运行记录时一并备份 `units/` 和 `runs.json`。
2. 记录当前 profile 只直依 `@lmzhen/dsh-evolution-all`；不要在本版把子包写回 profile。
3. 运行 `/evolution doctor` 保存升级前读数，尤其是 memory 预算、健康检查与安装形态。

## 行为变化

### memory / user

- 默认从 **2,200 / 1,375 字符** 改为 **800 / 500 估算 token**。
- 估算是写入前的上界：`max(ceil(codePoints / 4), ceil(UTF-8 bytes / 3))`，不是 provider 精确用量；中文约 800 字符、英文约 2,400 字符触及默认线。
- 已有文件**不会被重写**；下一次写入才按新预算判断。已有中文记忆可能暂时处于超限状态：删除或缩短条目后继续写入，不允许伪造 token 记录。

### 正文软线

- 默认软线从“20,000 字符”改为固定 **7,273 估算 token**；2 倍判 `needs-restructure`。
- `healthSoftBodyTokens` 是主字段；`healthSoftBodyChars` 只作为旧字符输入，按 2.75 字符/token 转换一次。
- 数据总览仍保留正文字符事实，另显示“估算 tokens”列和总计；两者不可互相替代。

### 界面

- 技能整理、待我确认、合并建议、健康状态、附带文件等术语在 8 语言统一。
- 版本预览截断改为 grapheme-safe，emoji / 组合字符不会被切成半个。
- 参数标签不再重复单位 chip；token 一律以估算标注。

## 配置迁移

优先级：

```text
row memoryTokens / userTokens
> row memoryChars / userChars（显式旧字符模式）
> policy memoryTokens / userTokens
> policy memoryChars / userChars 按 2.75 换算
> 默认 800 / 500
```

`healthSoftBodyTokens` 同理优先于 `healthSoftBodyChars`。新旧字段冲突由 doctor 报告；不要同时保留两套且不处理。

## 回滚

1. 停宿主，恢复升级前的 profile manifest / lock / cordis patch 与 `settings.yaml`。
2. 安装上一版 `@lmzhen/dsh-evolution-all@0.54.0`，重启。
3. 数据不需要转换；0.55.0 没有改写旧记忆、技能版本或报告。旧报告里的字符读数继续按字符解释，不会被补写成 token。
4. 若只想保持旧容量而不回滚：显式设置 row 的 `memoryChars` / `userChars`，或把 `memoryTokens` / `userTokens` 调到旧容量对应值；正文软线可设置 `healthSoftBodyTokens`（或旧 `healthSoftBodyChars`）。

## 验收

- `/evolution doctor` 无 memory 预算冲突；
- 新建一条记忆、一次技能写入、一次健康检查都成功；
- 数据总览同时显示正文字符与估算 tokens；
- 版本预览在含 emoji 的技能上不出现乱码；
- Web UI 1440 / 1024 / 390 三档无截断或重叠。
