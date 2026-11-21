# R0 设计：UI 确认默认值与设置座订阅

范围：F1（“批准前先确认”显示值与实际行为相反）、F2（settings 座在 apply 时捕获一次，显式设置不生效）。
目标架构关系：两者属于目标架构 Projection 平面；本批只修当前 client seam，最终 `ProjectionSchema` + `configForms` 单源仍按 11-target-architecture 推进。

## 1. 已读依据

- `audit-2026-11-22/07-ui-client.md`：F1/F2 原始证据与平台 `ConfigFormSnapshot` 对照。
- `audit-2026-11-22/10-system-framework.md`：I1/I7、M1 投影分叉。
- `audit-2026-11-22/11-target-architecture.md`：ProjectionSchema 与 configForms 单源。
- 平台实现：
  - `harness-rc3/packages/client/ui-settings/src/client/config-form-types.ts:8-74`：`value` 是 schema-resolved section，`user` 是原始用户层；`subscribe`。
  - `harness-rc3/packages/client/ui-settings/src/client/config-form.ts`：`getSnapshot/subscribe`。
  - `harness-rc3/packages/client/ui-settings-general/src/client/index.ts:77`：`configForms` 是可选/注入服务，不应让整个 settings half 因缺失而 pending。
- 当前实现：
  - `packages/evolution-ui/src/panels/settings/PendingCard.ts:32-52,98`：`confirmModeFrom(user)` + `?? 'ask'`。
  - `packages/evolution-ui/src/panels/history/client/index.ts:23,33-42,63`：apply 时捕获 form，回调只改裸变量。
  - `packages/evolution-ui/src/panels/history/client/Workbench.ts:205`：`PendingCard` 展开 face。
  - 测试：`settings-u6-approval-confirm.client.spec.ts`、`history-client-apply.client.spec.ts`。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| F1 显示 auto 行为 ask | I1/I7 | 默认设置的有效值与 UI 读取的层不一致；用户信任下降，非数据破坏 | 默认部署每次批准多一次点击；同一屏显示与行为相反 |
| F2 座只捕获一次/裸变量 | I7 | 设置变更不触发渲染；若座晚到则永久回退 ask | 显式“直接执行”不生效，需刷新；无数据破坏 |

二者共享根因：**把 user 层/一次捕获当成有效投影**。目标修复是单一有效投影 + 订阅；本批不做 ProjectionSchema 重构。

## 3. F1 设计

- `confirmModeFrom` 语义改为“读取 schema-resolved section”而不是 user 层：
  ```ts
  export function confirmModeFrom(section: unknown): 'auto' | 'ask' {
    const value = ... section.approvalConfirm
    return value === 'auto' ? 'auto' : 'ask'
  }
  ```
- history 调用改成 `approvalForm.getSnapshot().value`；
- `value` 缺失/loading/unavailable → 安全回退 `ask`，绝不把未知当 auto；
- `timeout`  legacy → ask（已有测试）；
- settings 卡显示的是 `value`，行为读取同一 `value`，显示与行为同源；
- 不改变 `approvalConfirm` 的 registry 默认 `auto`。

## 4. F2 设计

- history 不再在 `apply` 时冻结 `approvalForm`；
- 通过 cordis `ctx.inject(['configForms'], ...)` 惰性绑定：座晚到也能绑定；没有 settings 的部署保持 ask 回退，不阻塞整个 workbench；
- 维护一个 **subscribe 源**：
  ```ts
  const listeners = new Set<() => void>()
  let form: ConfigFormLike | undefined
  let stop: (()=>void)|undefined
  const notify = () => { for (const l of listeners) l() }
  const bind = (seat) => { form = seat?.get('evolution-approval'); stop?.(); stop = form?.subscribe(notify); notify() }
  const confirmMode = () => confirmModeFrom(form?.getSnapshot().value)
  const subscribeConfirmMode = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
  ```
- `PendingCardFace` 增 `subscribeConfirmMode`（可选）；`PendingCard` 用 `useState + useEffect` 在 mount/设置变化时同步，而不是读一次常量；
- `pendingFace()` 传入 `confirmMode` + `subscribeConfirmMode`；
- 不把 `configForms` 加进静态 `inject`（避免 settings 未组合时整个 workbench pending），用 `ctx.inject` 动态等待。

## 5. 测试

- `confirmModeFrom`：
  - schema value `{approvalConfirm:'auto'}` → auto；`ask`→ask；`timeout`/unknown→ask；
  - 说明调用方传 `value` 而不是 `user`，由 history 集成测试/代码审查保证。
- `PendingCard`：
  - 新增“订阅后从 auto 切到 ask，卡片下一次点击开始二次确认”测试；
  - 原有 auto/ask/back-out/named 测试不变。
- history：
  - 在 fake ctx 上提供 `configForms.get('evolution-approval')`，其 snapshot `value` 为 auto、`user` 为空；apply 后 `pendingFace.confirmMode()` 必须是 auto（证明读的是 value）；
  - 触发 form subscribe listener 改 ask，face 读值变 ask；
  - 无 configForms 时返回 ask（安全回退）。

## 6. 回退与边界

- 只改 UI client 与 `confirmModeFrom`；无 host/存储/协议变更。
- 回退：删除订阅面恢复旧行为；不会损坏数据。
- 目标架构后记：最终 `ProjectionSchema` 生成 face；本批的 `subscribeConfirmMode` 应被生成的 settings projection 替换，不保留第二套手写契约。

## 7. 实现结果（2026-11-22，未发布）

- F1：`confirmModeFrom` 读取 schema-resolved `value`；history 用 `approvalForm.getSnapshot().value`；
  loading/unknown 仍回退 ask。
- F2：history 不再在 apply 冻结 form；通过 `ctx.inject(['configForms'], ...)` 惰性绑定，保留无 settings
  部署的 ask 回退；`PendingCardFace` 增可选 `subscribeConfirmMode`，卡片用 state+effect 重读。
- 测试：history apply 的 effective value+subscription 用例；PendingCard auto→ask 订阅用例；
  evolution-ui 全量 37 files / 201 tests passed。
- 未发布。
