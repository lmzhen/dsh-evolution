# P2：补齐客户端 token，去掉 StatsPage/表格的写死 fallback

范围：07-ui-client P2-8。
- `--evo-accent`、`--evo-accent-weak`、`--evo-warn`、`--evo-radius-card` 在 `client-tokens.json` 中未定义；
- StatsPage/data-table 用写死 fallback 颜色（`#2f6b58`、`#b26a3c`、`#e7f0eb` 等），实际生效的是字面量，不随平台 dark/skin 变。

## 设计

- `client-tokens.json` 新增：
  - `accent.base = var(--dsw-alias-brand-primary)`；
  - `accent.weak = color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)`；
  - `warn.base = var(--dsw-alias-state-warn-primary)`；
  - `radius.card = var(--evo-radius-surface)`。
- `verify-client-tokens` 的 GROUPS 允许 `accent` / `warn`。
- `gen-client-tokens` 重生成 `client-kit/src/tokens.ts`。
- StatsPage/data-table：
  - `var(--evo-accent,#...)` → `var(--evo-accent-base)`；
  - `var(--evo-warn,#...)` → `var(--evo-warn-base)`；
  - `var(--evo-accent-weak,#...)` → `var(--evo-accent-weak)`；
  - table card 的 `border-radius:12px` → `var(--evo-radius-card)`。
- 删除这些 token 的字面 fallback：token 未定义时应当用平台主题，而不是本地颜色。

## 验证

- `gen-client-tokens packages` 0；
- `verify-client-tokens --strict`: 11 groups / 33 properties / 33 referenced；
- stats-page-layout + client-kit tests: 5 files / 17 tests passed；
- arch/doc 0。

## 回退

删除四个 token 并恢复 fallback 字面量；无 schema/数据变更。
