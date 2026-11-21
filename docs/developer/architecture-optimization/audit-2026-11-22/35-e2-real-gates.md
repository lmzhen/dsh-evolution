# E2 设计：四条 architecture 门禁从“死行”改为真实执行

范围：06-architecture P1-2：
- `gate-13/14/15` 指向 `D:/dsh/audit-v37/*`，文件不存在；`kind:"external"` 永不执行；
- `gate-75` `localSafe:false`，本地永远 skip，CI 只比较复制后的两份 scripts（同义反复）。

## 1. 已读依据

- `audit-2026-11-22/06-architecture.md` P1-2（`gates/guards.mjs:94-118`、gate-75）。
- `gate-model`：`external` 不参与 spawn；`step` 由 lane/action 执行。
- 当前 live 包：23 个带 `src` 的包均有 `tsconfig.json`，且 `extends: ../tsconfig.pkg.json`；28 个 manifest 版本均为根版本 0.59.6。
- `action.yml:103-115` 已手工执行 layout-sync；gate-75 可声明为 `step + runBy:"action"`，由 action 真实执行。

## 2. 定性

| 行 | 旧问题 | 新判据 |
|---|---|---|
| gate-13 | 外部 tsconfig 检查不存在 | 仓内 23 个 source 包的 tsconfig 存在、解析、extends 正确、family-internal references 可解析 |
| gate-14 | 外部 manifest 检查不存在 | 所有 family package.json 版本等于根 family version |
| gate-15 | 外部 mirror-sync 不存在 | 当前构建线 scripts 与 mirror scripts 逐文件字节比较 |
| gate-75 | 本地 skip/CI 同义反复 | 声明为 step，由 action 执行真实 layout-sync |

## 3. 设计

新脚本：

- `verify-family-tsconfigs.mjs packages`；
- `verify-manifest-uniformity.mjs packages`；
- `verify-layout-sync-local.mjs`（resolveOverlay + 现有 verify-layout-sync 比较实现）。

registry：

- gate-13/14/15：`kind:"script"`、`tree:"mirror"`、`lanes:["local","ci-static"]`；
- gate-75：`kind:"step"`、`command` 等于 action 的 layout-sync 命令、`lanes:["ci-static"]`、`runBy:"action"`；
- 删除 machine-local 注册/豁免/drill 中对旧 audit-v37 名称的引用；
- 新脚本补 `drill-declarations.noDrillReason`（真实检查但暂无 mutation fixture，0.60.0 前登记）。

## 4. 验证

- 三个脚本直接运行：tsconfig 23 包 clean；manifest 28 个 @0.59.6；layout 231 scripts identical；
- `gen-gate-manifest --check` 0；
- `verify-gate-manifest --report` 0；
- `verify-check-registry --strict`: 7 pass / 1 registered / 0 fail（mutation 23/23，falsifiability 4/4 registered）；
- doc/arch/test-lines 0。

## 5. 回退

- 恢复四条旧 external/localSafe 行与旧注册；删除三个脚本；无产品代码影响。

## 6. 实现结果（2026-11-22，未发布）

- 新增三个真实检查脚本；gate-13/14/15 改为 script，gate-75 改为 action step。
- 三个脚本实测：23 包 tsconfig clean / 28 manifest 同版本 / 231 scripts identical。
- gate-manifest、checks fact、drill、mutation coverage 同步；registry strict 7 pass / 1 registered / 0 fail。
