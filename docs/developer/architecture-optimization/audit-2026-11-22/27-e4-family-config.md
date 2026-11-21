# E4 设计：CI 单元套件加载 family config

范围：08-tests-debt P1-2：`gates/unit.mjs` 的 argv/CI override 裸跑 `vitest run packages/evolution --maxWorkers=2 --testTimeout=30000`，不加载 `packages/evolution/scripts/vitest.family.config.mjs`，导致 alias、adapter pin、tier/lane 成员、测试超时策略全部悬空。

## 1. 已读依据

- `audit-2026-11-22/08-tests-debt.md:27-31`：位置/机制/后果/修法。
- `packages/scripts/gates/unit.mjs`：title/argv/ci argv 都无 `-c`，硬编码 `--testTimeout=30000`。
- `packages/scripts/vitest.family.config.mjs`：
  - root 由文件位置推导；
  - alias 来自 `line-adapter`；
  - tier/lane 来自 `family-facts.testing-policy` + taxonomy；
  - `testTimeout` 来自 facts；
  - 缺少 adapter/view 会 `CANNOT DECIDE`（exit 2）。
- `CONTRIBUTING.md:25,40`：文档命令也不带 `-c`。
- 平台/CI 验证：`run-gates ci --lane ci-unit` 只读 gate argv；action 不另写命令。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| CI 不加载 family config | I7 验证绑定事实 | CI 执行集合、alias、超时与本地/facts 不是同一件事；probe baseline 来自另一条路线 | 只影响测试执行/证据，不影响运行代码；但会让验证失真 |

修法：让 gate 的唯一命令形态带 `-c`，超时由 facts 供给；文档/生成表同步。

## 3. 设计

- `gates/unit.mjs`：
  - title/argv/ci argv 增加 `-c packages/evolution/scripts/vitest.family.config.mjs`；
  - 删除硬编码 `--testTimeout=30000`（config 从 `testing-policy.timeouts.spec.ms` 读取，当前 30000）。
- `family-facts.testing-policy.must`：由 `--testTimeout=30000` 改为 `-c packages/evolution/scripts/vitest.family.config.mjs`。
- `gen-gate-manifest.mjs` 重新生成：
  - `gate-manifest.json`
  - CONTRIBUTING gate table（table row 3 的命令）。
- CONTRIBUTING 的人读说明同步：config 负责 spec timeout。

## 4. 测试/验收

- 直接跑 gate 的 argv 形态（单 spec 以缩短时间）：
  `node node_modules/vitest/vitest.mjs run packages/evolution/evolution-core/tests/unit-kernel.spec.ts -c packages/evolution/scripts/vitest.family.config.mjs --maxWorkers=2`
  - 输出 `lane=full(ci=off) members=436 excluded=72 marked=508/508`，证明 config 生效；
  - 1 file / 4 tests passed。
- `gen-gate-manifest --check` 0；
- `verify-gate-manifest --report` 0；`verify-check-registry --strict` 0。

## 5. 边界/回退

- gate 的 tree 仍是 overlay；config 在 overlay 路径 `packages/evolution/scripts/...`，mirror 文档同步说明。
- 不改变 lane 成员/测试内容；只改变“怎么执行”。
- 回退：删 `-c` 并恢复硬编码 timeout（不建议；回到旧缺陷）。

## 6. 实现结果（2026-11-22，未发布）

- gate-03 argv/ci argv 已加 `-c packages/evolution/scripts/vitest.family.config.mjs`，去掉硬编码 timeout。
- family-facts.testing-policy.must 同步；gate-manifest/CONTRIBUTING 重新生成。
- 实测 config 生效：lane=full(ci=off) members=436 excluded=72 marked=508/508；单 spec 4 tests passed。
- gen-gate-manifest --check 0；verify-gate-manifest 0；verify-check-registry 0。
