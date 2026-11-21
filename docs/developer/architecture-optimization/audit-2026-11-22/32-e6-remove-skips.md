# E6 设计：删除两个永久跳过的门禁仿真测试

范围：08-tests-debt P1-4：
- `rg4-two-process.spec.ts` 整个文件只有一个 `it.skip`；
- `rg7-install.spec.ts` 用绝对路径 + `it.skipIf(!present)`，CI/镜像永远跳过；
- 两者都标 `@tier pre-tag`，仍被 taxonomy 计入 lane 成员。

## 1. 已读依据

- `audit-2026-11-22/08-tests-debt.md:41-47`：
  - `rg4-two-process.spec.ts:8` 唯一用例 skip；
  - `rg7-install.spec.ts:9,13` 绝对路径 `D:/dsh/skill-merge/...` + 写死 `0.30.18`；
  - taxonomy 只按 `@tier` 计数，不检查 skip；
  - 真正覆盖由 CI `smoke-packed-install` 承担。
- `.github/actions/evolution-validate/action.yml:296`：packed-install smoke 在 CI 执行真实 dist。
- `packages/scripts/gen-check-taxonomy.mjs`：lane 成员仅由 tier 标记生成。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| 永久 skip 计入 lane | I7 验证绑定事实 | 读数包含永不执行的“绿成员”；名字与证据错位 | 仅测试账本；不影响运行 |
| rg7 断言另一台机器的安装 | I7 | 断言对象不是本次产物 | 同上 |

修法：删除两个文件，主张由 CI 真实 smoke 承担；taxonomy/测试账本重新生成。

## 3. 设计

- 删除 `packages/evolution-merge/tests/gates/rg4-two-process.spec.ts`；
- 删除 `packages/evolution-merge/tests/gates/rg7-install.spec.ts`；
- 重新生成 `reports/check-taxonomy.json`、`family-test-lines.json`；
- 不新增 gate 行：packed-install 的 CI 步骤已在 `steps/release` 注册，不另造第二个执行体；
- 文档记录：RG4 跨进程主张改由真实进程 lock 测试/CI 证据承载，RG7 由 `smoke-packed-install` 承载。

## 4. 验证

- `gen-check-taxonomy` 成功；
- `gen-test-lines` + `verify-test-lines --strict` 0；
- `verify-arch-guards --strict` / `verify-doc-facts` 0；
- 全仓 `it.skip/skipIf/describe.skip` 扫描为空。

## 5. 回退

- 恢复两个 spec 与生成物即可；无生产代码/schema 变更。

## 6. 实现结果（2026-11-22，未发布）

- 删除 rg4-two-process.spec.ts、rg7-install.spec.ts；
- taxonomy/test-lines 重新生成；全仓 skip 扫描为空；
- verify-test-lines --strict / arch / doc 均 0。
