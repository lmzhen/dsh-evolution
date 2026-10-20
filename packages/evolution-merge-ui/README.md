# @lmzhen/dsh-evolution-merge-ui

技能合并的只读浏览器面板：三队列计数、行列表与刷新；动作只展示为命令文本，不在浏览器写技能。

## 数据面

读取 `/api/dsh-evolution/merge/view` 与 `/api/dsh-evolution/merge/rows`，走生成的路由表和 route-client。失败按四态显示，不伪造空成功。

## 已知限制

- 只读；approve/reject 等动作需复制命令执行。
- 面板仅在 `evolution-merge` host 行与其 bundle 同时挂载时可用。
