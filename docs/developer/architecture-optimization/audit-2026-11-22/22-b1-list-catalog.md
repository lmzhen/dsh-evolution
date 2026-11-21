# B1 子组设计：list 名字可见与 strictCrossSource 空视图

范围：P1-3（`list` 名字只在 canonical value，模型 content 看不到）与 P1-5（strictCrossSource 把空 catalog 视图判 unknown，首个 create 永久失败）。

## 1. 已读依据

- `audit-2026-11-22/02-tool-skill-manage.md:56-77`：list/render、catalogWinner empty、crossSourceRefusal。
- 平台 `core/tools/pipeline.ts:545-575`：模型只看到 `render` 的 content，canonical `value` 不直接可见。
- 当前实现：
  - `index.ts:986-993`：list 返回 `skills` 名字数组，但 `message` 只有数量；
  - `index.ts:1456-1468`：`render` 只拼接 `OK/Error: message` + proposal，不读 `skills`；
  - `index.ts:877-893`：`catalogWinner` 对 `summaries.length===0` 返回 `probeUnknown`；
  - `index.ts:837-857`：strict 对 unknown 直接拒绝；
  - `context.ts`/`callingScope`：调用 scope 已修正，空视图可能是健康的“确实没有技能”。
- 测试：`tool-skill-manage.spec.ts` list 用例；`create-tree-reads.spec.ts` catalog 用例；`skill-settings.spec.ts` strict 默认。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| list 名字不可见 | I6 契约生成 | 工具描述承诺“list returns names only”，模型实际只看到数量；无法决策 | 只影响 list 读面，不写树 |
| strict 空视图拒绝首个 create | I1/I3 | 新库/空视图下 strictCrossSource 使所有 create 永久失败；无测试 | 只影响 strict 用户的首个写；空视图与 unknown 必须区分 |

二者都是“读面/判据与事实不一致”，不是写内核 bug；修复不改变 plan/approval。

## 3. 设计

### 3.1 list

- `list` 保持 canonical `skills` 数组；
- `message` 增加名字（模型 content 直接可见）：
  - 空：`没有找到技能。`
  - 非空：`已列出 N 个技能：name1、name2…`
- 不新增 render 分支，避免 canonical/content 两套格式漂移；
- 超长列表由现有模型文本预算处理（list 是读面，没有写 payload）。

### 3.2 catalogWinner 空视图

```ts
if (summaries.length === 0) return probePresent({ winner: undefined, view: [] })
```

- `callingScope` 已决定看哪一层；空数组是“该层可读且没有技能”，不是“读不到”；
- 真正的不可读仍走 catch → unknown；
- strict 下空视图不再拒绝 `create`；已有技能但不在视图（preset 可见性）仍由 `callingScope` 处理；
- 保留 `probeUnknown` 给 `catalog === undefined`（服务未挂载）和 catch（查询失败）。

### 3.3 测试

- `tool-skill-manage.spec.ts` 的 list 用例断言 `message` 包含已创建技能名。
- `create-tree-reads.spec.ts` 新增：空 root + `strictCrossSource: true`，首个 create 成功；否则旧代码报 cross-source unknown。
- 现有 strict 默认/空 default 测试不变。

## 4. 回退

- 两处小改；回退即恢复旧 message/empty unknown。
- 无 schema/API 变化。

## 5. 实现结果（2026-11-22，未发布）

- list message 现在直接带技能名；模型 content 可读，canonical skills 仍保留。
- catalogWinner 对“可读空视图”返回 present(no winner)，只有服务未挂载/查询抛错才是 unknown；
  strictCrossSource 下首个 create 不再被空视图挡住。
- 测试：tool-skill-manage.spec list 名字断言；create-tree-reads strict 空视图创建成功。
  2 files / 48 tests passed（含既有 46）。
- P1-4（summary 不落库）与 B1-2（delete/restructure/extract 无 plan）仍未处理。
