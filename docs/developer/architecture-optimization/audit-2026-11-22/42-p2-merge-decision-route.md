# P2：merge decision 路由进入 HOST_ROUTES 单源

范围：07-ui-client P2-1。
- client `HOST_ROUTES.body.replace(/body$/, 'decision')` 字符串手术；
- host `MERGE_BASE + 'decision'` 自行拼；
- core `HOST_ROUTES.merge` 没有 decision，导致改 body 路径时客户端 POST 404，且 `verify-host-routes` 看不到 `.replace` 派生。

## 设计

- `HOST_ROUTES.merge` 增加 `decision: '/api/dsh-evolution/merge/decision'`；
- `merge-routes.ts` 直接读 `HOST_ROUTES.merge` 的 view/rows/body/history/decision，删除 `MERGE_BASE` 和 fallback 派生；
- client `api.ts` 直接使用生成的 `ROUTES.merge.decision`；
- `gen-client-seam` 重新生成 routes 表；
- `verify-host-routes` 端点计数 20 → 21；
- RG7 UI contract 从“字符串 replace”改为“使用 HOST_ROUTES.decision”。

## 验证

- `gen-client-seam --check` 0；
- `verify-host-routes --strict`: 471 business source(s), 21 endpoints；
- RG7 UI + merge library-adapter + rg3-crash: 3 files / 13 tests passed；
- build 0。

## 回退

删除 `decision` 路由并恢复字符串派生；无 schema/数据变更。
