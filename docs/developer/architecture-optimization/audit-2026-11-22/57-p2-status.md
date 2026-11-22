# P2 处置状态（07-ui-client）

| 项 | 状态 | 证据 |
|---|---|---|
| P2-1 merge decision 路由字符串手术 | 已修复 | [42](42-p2-merge-decision-route.md)：`HOST_ROUTES.merge.decision` 单源，host/client 都读它 |
| P2-2 座位几何门禁零命中 | 已修复 | [48](48-p2-client-seats.md)：跟随 `registerSurface` + 简写 `size`；5 座 / 1 occupant |
| P2-3 configForms 手抄字段 | 已修复 | [49](49-p2-configforms-shape.md)：删 `save/refresh/dispose/reason/stale/readback` |
| P2-4 workspace 形状不存在 | 已修复 | [50](50-p2-workspace-id.md)：sessions+workspaces 取主 session 所属 workspace |
| P2-5 隐藏视图照常读 host | 已修复 | [51](51-p2-hidden-merge.md)：非活动 tab 不挂 MergePanel |
| P2-6 load-more 失败清空行 | 已修复 | [52](52-p2-loadmore.md)：保留 rows + cursor + failure |
| P2-7 merge tab 非响应式 + 手写解析 | 已修复 | [56](56-p2-merge-view-ledger.md)：`subscribeViews` + `fetchMergePendingCount` |
| P2-8 品牌/警告色绕过 token | 已修复 | [47](47-p2-client-tokens.md)：accent/warn/radius token，删 fallback 字面量 |
| P2-9 撤销后重读失败文案 | 已核对 | `undo.reloaded` 文案本身即“已回退，但版本列表没读出来”；无需改 |
| P2-10 单 ticket 管三类读 | 已修复 | [53](53-p2-read-tickets.md)：versions/preview/diff 分开 |
| P2-11 死契约/死常量/巨型文件 | 部分修复，余 DEFERRED | [54](54-p2-dead-ui-contract.md)：死契约已删；`useSkillHistory` 拆分与生成目录统一登记 DEFERRED |
| P2-12 `SKIP_MANIFEST_FRESHNESS` 死开关 | 已修复 | [34](34-p2-dead-switch.md) |
| P2-13 文档漂移 | 已修复 | [45](45-p2-docs-truth.md)；本条状态表补齐 07 的当前事实 |

平台接口对照表中三条旧结论（configForms、workspace、HOST_ROUTES.merge）现已过时：
- configForms 已只保留平台 5 方法/6 快照字段；
- workspace 已按平台 sessions/workspaces 解析；
- decision 已进入 `HOST_ROUTES.merge`。
