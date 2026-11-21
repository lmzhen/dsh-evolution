# E5 设计：平台耦合账本从“登记”变成可判据

范围：08-tests-debt P1-3：
- 178 条 `platform/testkit` 耦合全为 `status:"pending"`、`expectLine:"unknown"`；
- `--strict` 只查集合漂移，不判 unknown/过期/树陈旧；
- 账本 `tree` 落后 HEAD 也不红。

## 1. 已读依据

- `audit-2026-11-22/08-tests-debt.md:31-36`：位置、机制、修法。
- `packages/scripts/gen-test-lines.mjs`：所有候选固定写 `pending`/`unknown`。
- `packages/scripts/verify-test-lines.mjs`：
  - `pending`/`unknown` 是合法闭集；
  - strict 只在 actualOnly/declaredOnly/fieldViolations 时 exit 1；
  - 不读 `expiry`、不比较 tree。
- `family-facts.testing-policy.adapter.expectedLine = 0.2.2-rc.5`。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| 登记全是 pending/unknown | I7 | 覆盖率读数没有判据；过期/漂移永不红 | 仅测试证据；不影响运行 |
| tree 陈旧不检测 | I7 | 账本可指向旧树 | 同上 |

## 3. 设计

生成器：

- 每个候选写 `status:"expected"`；
- `expectLine` 由耦合种类派生：platform/testkit → `both`，其余 → `local`；
- `expiry` 写明确版本 `0.60.0`（可被 verifier 比较）。

verifier（strict）：

- `expectLine:"unknown"` / `status:"pending"` → fieldViolation；
- `expiry` 与仓库版本比较，版本 ≥ expiry → `expired`，strict 红；
- registry `tree` ≠ HEAD 时，用 `git diff --name-only <tree>..HEAD -- packages` 只看 `.spec.ts`：
  - 无 spec 变化 → 账本仍有效（脚本/文档提交不强制重生成）；
  - 有 spec 变化 → `staleTree`，strict 红；
  - git 比较失败 → 红（不能把未知当新鲜）。
- 输出新增 `expired` / `staleTree` 读数。

## 4. 验证

- 重新生成 178 条，全部 `expected/both`；pending/unknown = 0。
- `verify-test-lines --strict`：actualOnly/declaredOnly/fieldViolations/expired/staleTree 均为 0。
- 负例：手工把一条改回 `pending` 或 `unknown` 会 exit 1；把一条 expiry 改成 `0.59.0` 会 expired；把 tree 改成旧且 spec 有变更会 stale。

## 5. 回退

- 恢复生成器固定 pending/unknown 与 verifier 旧 strict 条件；无产品代码影响。

## 6. 实现结果（2026-11-22，未发布）

- 生成器改 expected/both + expiry 0.60.0；
- verifier strict 拒绝 pending/unknown、过期 expiry、spec 变更后的 stale tree；
- 实测 178 entries、pending/unknown=0、expired=0、staleTree=0；strict 0。
