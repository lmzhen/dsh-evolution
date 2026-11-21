# R0 设计：元门禁去 report-only

范围：E7（`argv-ci-parity` 无消费者；2 条命令行漂移；`falsifiability-carrier` 4 条已登记但到期前不得静默）与 mutation-coverage 账本刷新。
目标架构关系：Assurance 平面的“门禁自身可失败”要求；不改变发布/运行时行为。

## 1. 已读依据

- `audit-2026-11-22/08-tests-debt.md:48-51,78-79`：四轴 report-only、2 条 argv 漂移、4 条无 carrier、expiry 到期规则。
- `audit-2026-11-22/10-system-framework.md`：I7 验证绑定事实、M5。
- `audit-2026-11-22/11-target-architecture.md`：Assurance 链。
- 实现：
  - `packages/scripts/verify-gate-manifest.mjs:431-459`：`argv-ci-parity` 只写 observations；`ARGV_CI_SUBSTITUTIONS` 3 条；`note()` 已对 registered axis 执行 expiry。
  - `packages/scripts/verify-check-registry.mjs:101`：只消费 executability/no-placeholders/expiry-due/falsifiability；无 argv 轴。
  - `packages/scripts/gate-manifest.json`：gate-16 `--self-test`，action 实际跑真实 home；gate-49 `--coverage`，action 跑 probe lane。
  - `packages/scripts/drill-declarations.json` / `family-facts.pendingAxes`：falsifiability 4 条注册到 0.60.0。
  - `packages/scripts/reports/mutation-coverage.json`：probe 签名因 R0 修改 `tool-dispatch.ts` 变 stale。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| argv 漂移只观测 | I7 | 清单“声明=执行”失效；2 条已漂移仍绿 | 门禁真实性，不直接损坏运行 |
| mutation probe 签名 stale | I7 | 读数不是当前树；23/23 变 22/23 | 证据链，不是产品 bug |
| falsifiability 4 条无 carrier | I7 | 已有注册/到期，不是本轮新增；0.60 到期必须红 | 到期前允许登记债 |

不新增 DCR：目标架构要求“门禁失败必须可执行”，本批把已有观察轴接入消费者并修实际漂移。

## 3. 设计

### 3.1 argv-ci-parity 进 ledger

- `verify-check-registry` 增加轴 `argv-ci-parity`，从 meta-gate observations 读取；
- live > 0 且未注册 → fail；不再“只观测”；
- 修实际漂移（不新增 pending debt）：
  - `gate-16`：CI 用真实 profile home 代替 `--self-test`；
  - `gate-49`：CI 用 `--probes --baseline=json:...` 代替 `--coverage`；
  - 两者加入 `ARGV_CI_SUBSTITUTIONS`，理由写清；substitution 仍走同一计数/输出，不再静默。
- 若未来新增未登记 substitution，live > 0，ledger 直接红。

### 3.2 mutation ledger

- 运行 `verify-mutations --probes --only beh-plugin-record-not-dispatch` 重新证明红；
- 把 overlay 生成的 `packages/scripts/reports/mutation-coverage.json` 回写到 mirror；
- 这是“当前树签名”，不是豁免。

### 3.3 falsifiability

- 保留 4 条 registered debt + 0.60 expiry（已有 `note()` 到期评估）；不在本轮用 `noDrillReason` 假清账。
- 当 familyVersion >= 0.60 时，现有 `exemptionProblems` 会把对应 note 转 problem，ledger 红；这是唯一正确路径。

## 4. 测试/验收

```bash
node packages/scripts/verify-gate-manifest.mjs packages --report
# argv-ci-parity: 0 observation; falsifiability: 4 (registered)
node packages/scripts/verify-check-registry.mjs --strict
# 8 axes: 7 pass, 1 registered, 0 fail
```

- 修改前 baseline：registry fail `mutation-coverage`；新增 argv 轴前无 argv 消费者。
- 修改后：registry exit 0；所有 axes 有 owner/register。
- 负例：将任一 substitution 移除或 action 改 argv，会新增 `argv-ci-parity` observation → registry fail；mutation 签名变化同理。

## 5. 回退

- 删除 argv 轴/两个 substitution 即恢复旧 report-only；mutation ledger 可回退到旧签名但会 stale。
- 无产品代码/数据变更。

## 6. 实现结果（2026-11-22，未发布）

- 新增 `argv-ci-parity` 轴；`gate-16`/`gate-49` 登记为 substitution（真实 home / probe lane 形态）。
- `verify-gate-manifest --report`：argv 0，falsifiability 4（registered）。
- `verify-check-registry --strict`：8 轴中 7 pass / 1 registered / 0 fail；mutation-coverage 23/23。
- probe `beh-plugin-record-not-dispatch` 已在 overlay 重新证明红并同步 ledger。
- 未发布。
