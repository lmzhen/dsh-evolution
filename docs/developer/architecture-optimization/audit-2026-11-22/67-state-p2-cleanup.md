# evolution-state 吸收后的 P2 死引用清理

独立复核包吸收后列出 7 个 P2 残留，本轮全部关闭：

| 残留 | 修复 |
|---|---|
| `tsconfig.base.json` 仍指 `packages/evolution-state/src`、`evolution-preset` | 删除旧 alias，新增 `core/state`、`core/state/storage`、`core/state/domain` |
| `packages/README.md` 写 22 packages、仍用旧包名描述 state | 改为 21 packages；描述改为 `core/state` / `core/state/domain` |
| `plugin-meta.json` 仍有 `evolution-state*` 元数据 | 删除三组死行，重生成 i18n |
| `lib-param-owners.mjs` 指向已删除目录 | owner 与 source 改 `evolution-core` / `core/src/state` |
| `verify-arch-guards` N10 baseline 旧路径 | 改 `core/src/state/domain/index.ts` |
| `family-facts` gate-34 drill 仍删 `evolution-state` README 行 | 改删 `memory` 行 |
| `bundle-rows` 仍留 preset/standalone 的 state body/leads | 删除这些 dead data |
| `state-store.ts` 注释说 state stack | 改 core/state |

## 验证

- `gen-param-docs` / `gen-i18n` / `gen-gate-manifest` / `gen-checks-fact` / `gen-test-lines` / `gen-check-taxonomy` / `gen-line-manifest` 全部重生成；
- `run-gates local`: 61 pass / 0 fail / 3 cannot-decide；
- 全量 family 套件：442 files / 2426 tests passed（1076.71s）。

## 回退

恢复旧 alias/注释/行；无行为变更。
