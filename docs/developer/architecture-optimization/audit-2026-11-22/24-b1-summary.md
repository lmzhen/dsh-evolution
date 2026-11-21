# B1-4 设计：模型 summary 进入 history/audit

范围：审计 02-tool-skill-manage P1-4：5 个内容写动作要求模型提供 `summary`，但只校验不落库；history 永远显示 host 文案。

## 1. 已读依据

- `audit-2026-11-22/02-tool-skill-manage.md:69-77`：summary 只在 staging plan 有，`apply` 单 op 只传 origin；mutator auditSummary 写死。
- `skill-write-service.ts`：planCreate/Update/Patch/WriteSupport/RemoveSupport 不接收 summary。
- `skill-store.ts`：
  - `audit()` 接收 `summary`，`hostChangeSummary` 生成 host 文案；
  - `apply(plan)` 单 op 直接 `applyOne(op, origin)`；多 op 用 `plan.summary` 给 unit；
  - `applyOne` 只是映射 mutators；
  - `PLAN_SINK` 已有 AsyncLocalStorage，用于多 op 收集。
- 测试：`skill-write-plan.spec.ts`、`skill-history.spec.ts`。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| summary 只校验不落库 | I4 因果顺序/I7 | 模型描述了为什么改，历史却显示 host 自动文案；用户无法从历史判断意图 | 只影响 history/audit 文案，不影响写入字节 |

## 3. 设计

### 3.1 一个 plan summary 上下文

新增模块级：

```ts
const PLAN_SUMMARY = new AsyncLocalStorage<string>()
```

- `apply(plan)` 按 `plan.summary` 包住 `applyOne` / `applyMulti`；
- 单 op 与多 op 共用同一个上下文，不另写分支；
- `audit()` 优先读取 `PLAN_SUMMARY.getStore()`：
  - `normalizeChangeSummary` 通过 → `{ text, source:'model' }`；
  - 不通过 → 回落 `hostChangeSummary`（保持旧行为/长度约束）。

### 3.2 tool 把 summary 带进 plan

`withPlanSummary(planned, summary)`：

- 只在 plan ok 且 summary 非空时，`{...plan, summary}`；
- 所有内容写路径调用：
  - create
  - update（owner / explicit）
  - patch / patchSection（owner / explicit）
  - write_file / remove_file（owner / explicit）
- 不在 service 层改签名，避免扩大 API 面；plan 仍是唯一载体。

### 3.3 history

`audit()` 把 `finalSummary.source='model'` 传给 `recordVersions`，history 显示模型原文；`summarySource` 可区分 host/model。

## 4. 测试

- `skill-write-plan.spec.ts` 新用例：`lib.apply({summary:'model says why', ...})` 后 `loadVersions` 最新条目
  `{ summary:'model says why', summarySource:'model' }`。
- 现有 patch-summary 工具测试继续覆盖必填校验；tool summary 路径由同一 `apply` 设计覆盖。
- 旧 history 测试（host 文案）不变，确保无 summary 时行为不变。

## 5. 回退

- 删除 `PLAN_SUMMARY` 包装与 `withPlanSummary` 即恢复；无 schema/存储变更。
- 只影响当前 plan 的 audit 文案，不改变任何写入。

## 6. 实现结果（2026-11-22，未发布）

- `skill-store` 新增 `PLAN_SUMMARY`；`apply` 单/多 op 都按 `plan.summary` 包裹；`audit` 优先使用它，
  source 记为 model，非法/超长回落 host。
- tool 的 create/update/patch/patchSection/write_file/remove_file（含 explicit 路径）都通过
  `withPlanSummary` 把模型 summary 带进 plan。
- 新增 skill-write-plan 用例：history 最新条目 summary/source = model。
- 回归：skill-write-plan + tool-skill-manage = 2 files / 58 tests passed；build 0。
