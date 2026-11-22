# D1c 过渡记录：domain provider 不能在本版删除

## 事实

D1b 后 `evolution-state` 使用 `provider: auto`：

- 没有迁移 marker ⇒ `domain`；
- 执行 `/evolution migrate state` 写 marker ⇒ 重启后 `store`；
- 旧 domain 数据从未删除，回退是删 marker + 重启。

## 为什么本版不能删 domain

- 用户升级后第一次启动时，store 尚未迁移；若移除 domain provider/row，pending/review/curator 会在迁移前读成空；
- `/evolution migrate state` 需要旧数据仍可读；
- 所以 domain 必须保留一个迁移窗口，作为 `auto` 的默认分支，而不是第二写权威（选中 store 后 `EvolutionState` 只读写 store）。

## 目标偏离与触发条件

- 11-target 要求删除 domain-cache authority；本版只做到“迁移完成后不再是 authority”，**代码/row 仍在**；
- 触发删除：迁移命令有实际使用证据（marker/运行记录）后；
- 删除动作：移除 `evolution-state-domain` row、domain provider 模块、storage-domain family 依赖，并把 `auto` 简化为 `store`（或保留 auto 兼容已迁移用户）；
- 回退：删除前一个版本仍可切回 domain，数据未被修改。

## 对最终发布门的影响

这是 DCR-4 草案：最终发布若包含本过渡版，发布说明必须写明：

1. 先升级；
2. 运行 `/evolution migrate state`；
3. 重启后自动使用 store；
4. 删除 domain provider 留到下一版（或用户确认的最终版之后）。

在用户确认这个 DCR 前，不能声称“Phase D 的 domain authority 删除完成”。
