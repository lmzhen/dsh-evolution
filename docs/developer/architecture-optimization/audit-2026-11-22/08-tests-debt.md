# 08 测试 / 门禁 / 发布证据 横切只读审计

对象：`D:\dsh\dsh-evolution-mirror` HEAD `564431ac`（干净树）；范围：`packages/evolution-*/tests`、`packages/tool-skill-manage/tests`、`packages/memory/tests`、`packages/test-support`、`packages/scripts/verify-*` 与 `gates/*`、`run-gates.mjs`、`.github/actions|workflows`、发布证据资产与 `docs/developer/architecture-optimization` 的声明。
方法：机械扫描 508 个 spec（tests 目录 527 个文件）+ 逐字读门禁/夹具/证据相关约 45 个文件 + 只读运行门禁自身（`verify-mutations --coverage`、`verify-test-lines --strict`、`verify-gate-manifest --report`、`verify-check-registry --strict`、`verify-traceability --strict`）；未跑测试套件、未改代码（只写本文件）。另一次误启动的 `run-gates local` 已终止，`git status` 保持干净。

## 结论

门禁骨架比同族多数仓库成熟：registry 单一源、verdict 四态、mutation 扫描器有等值/矛盾自检、`verify-arch-guards` 有 42 条带 incident/canonicalForm/vacuity 的规则、`verify-traceability` 实测 52/52。**没有可复现的 P0**：套件失败会导致 CI 红，证据缺失/损坏走 exit 2 而非静默绿。
真正的风险集中在「读数与执行不是同一条线」：①发布证据可以携带上一个版本/另一个 commit 的旧读数并通过 release 门；②CI 实际跑的套件不加载 family vitest 配置，档位/别名/超时策略只写在 facts 里；③平台耦合账本 175 条全部 `pending/unknown`，过期是散文，`--strict` 只查集合漂移；④存在整文件 `it.skip`、绝对路径 + `skipIf` 的永久跳过测试，且仍被计入 lane 成员；⑤元门禁的「可证伪」与 argv 一致性是 report-only，当前就有 2 条命令行漂移无人消费。

## P0

无。

## P1

### P1-1 release evidence 可被旧数据填充：spike 哈希从不复算，traceability 只比数字

- 位置：`packages/scripts/release-evidence-rehearsal.json:2` 明说 S1–S4「carried from the 0.59.5 measured artifact」，但四条 `familyVersion` 被改写成 0.59.6（`:8,:30,:52,:69`），而 S3 的 readings 里还留着 `"familyVersion": "0.59.0"`（`:63`）；`traceability.source` 是 `verify-traceability --strict on 567020ea (pending tag)`（`:92`），与 spikes 的 `commit: 67eb0c3a` 不是同一棵树。
- 机制：`lib-release-evidence.mjs:46` 对 `artifactSha256` 只做 `/^[a-f0-9]{64}$/` 形状校验，全仓再无第二处消费该字段（grep 仅命中 lib 自身与 `evolution-host/tests/release-evidence.spec.ts`），所以「hash the measured artifact」是声明不是验证；`verify-release-evidence.mjs` 只比 `spike.commit === measuredCommit`（`lib-release-evidence.mjs:174`），从不比对 `traceability.source`；`:143-154,:177` 只校验 A/B/C 计数与 covered=52。
- 触发：一次「后端-only」或任何作者认为可复用的发布，按现有做法把上一版 spike 抄进 rehearsal、只改 `familyVersion`；`--release` 门校验 `evidenceStatus==='measured'`（`:114`，由 `assemble-release-evidence.mjs:101` 自己写入）、`generatedAt` 7 天内（`:119,:140`）、四条 spike verdict=pass 与版本标签 → 全过。实测证据：`node packages/scripts/verify-test-lines.mjs` 一类读取无需构建，说明该门只读文件。
- 后果：`release-evidence.json` 可以在「两棵旧 commit + 新版本号」的数据上宣告 measured；发布门从「证明产物被验证过」退化为「证明有人填过这张表」。
- 修法：把 `artifactSha256` 与实际 dist 产物（`dist/*.tgz` 的 sha256 集合）比对并纳入 `--release`；rehearsal 每条 spike 与 traceability 必须记录同一个 `measuredCommit` 并由 assemble 覆盖写入，禁止手改；`evidenceStatus` 不得由装配脚本自证。

### P1-2 两条测试线：CI 套件不加载 `vitest.family.config.mjs`，档位策略全部悬空

- 位置：`packages/scripts/gates/unit.mjs:14`（`argv`）与 `:16`（CI override）都是裸 `vitest run packages/evolution --maxWorkers=2 --testTimeout=30000`，没有 `-c packages/evolution/scripts/vitest.family.config.mjs`；`CONTRIBUTING.md:25` 却要求「Use the family Vitest config」，`:40` 的生成表行也没有 `-c`；`.github/actions/evolution-validate/action.yml:174` 只是 `run-gates ci --lane ci-unit`。
- 机制：family 配置负责 alias（`lib-line.mjs` 解析）、adapter pin（`adapterSha=absent` 即 exit 2）、`testTimeout` 取 facts（`family-facts.json` 的 testing-policy）、lane 成员过滤（`reports/check-taxonomy.json` 的 `full(ci=on)=508` / `full(ci=off)=436` / `ci-only=72`）。CI 走默认配置后这些都不生效：策略 fact 只被 `lib-doc-facts.mjs:522-556` 校验 schema 形状，`tiers.fast.forbid=["spawn","realWait","wallClockAssert"]` 与 `maxWallMs=60000` 没有任何扫描器执行（`family-facts.json:485-486` 甚至写着 `enforced:false`）。
- 触发：任一 spec 在 fast 档里 `spawn`/真实等待/墙钟断言，或 tier 标记迁移错误；本地按 family 配置跑、CI 按默认配置跑，两边读数本就不是同一件事。
- 后果：`probe-baseline.json`（`action.yml:248` 消费）来自未受策略约束的路线；本机全量 436 vs CI 508，档位账本与实际执行集合无法对账。
- 修法：`unit.mjs` 的 argv/CI override 加 `-c packages/evolution/scripts/vitest.family.config.mjs` 并去掉硬编码 `--testTimeout`（由 facts 供给）；让 taxonomy 的 lane 成员成为唯一执行集合；给 forbid 列表配一个最小扫描门（或把 `enforced:false` 的字段从 facts 移除，避免假声明）。

### P1-3 平台耦合账本 175 条全 `pending/unknown`，过期不可评估，`--strict` 也永不红

- 位置：`packages/scripts/family-test-lines.json:2-4`（`generatedBy`、`measuredAt 2026-11-20`、`tree 465e420a` ≠ HEAD 564431ac）；全文件 175 条 `status:"pending"`（`:11` 起）、175 条 `expectLine:"unknown"`，`expiry` 全部是同一条自由文本「assign each spec its expected platform line … before the registry turns enforcing」。`verify-test-lines.mjs:51-52` 把 `pending` 与 `unknown` 列为合法闭集值，`:58-59` 只校验取值合法，`:84` 只在 `actualOnly/declaredOnly/fieldViolations` 非空时 exit 1。
- 机制：该账本的设计目的（G3 oracle：每条 spec 的平台耦合必须声明期望线）没有任何评估器：不读 `expiry`、不比较 `expectLine` 与 `testing-policy.adapter.expectedLine`、不检查 registry 的 `tree/measuredAt` 是否过期。对照 `lib-exemptions.mjs` 专门实现了版本化过期评估器，却没有接到这里。
- 触发：新增/迁移任何 spec（当前 508 个 spec、260 个平台 import 事件），只要集合不漂移，账本原地不动即绿。
- 后果：这是「登记 ≠ 判据」的典型：175 行登记制造了覆盖率读数，但期望线一栏永远 unknown；同时生成的 `tree` 已落后 10 个提交仍无红。
- 修法：账本改用 `lib-exemptions` 的版本账（expectLine 只允许 local/ci/both，pending 必须有版本 expiry）；`--strict` 应把 `unknown` 与 `tree≠HEAD` 判红；gen-test-lines 纳入 gate 刷新链（`--check` 形式）。

### P1-4 两个永久跳过的「门禁仿真」测试仍计入 lane 成员

- 位置：`packages/evolution-merge/tests/gates/rg4-two-process.spec.ts:8` —— 整个文件唯一用例是 `it.skip('would need a cross-process provider…')`，文件名叫 two-process，实际一天也没跑过；`packages/evolution-merge/tests/gates/rg7-install.spec.ts:9,13` 用绝对路径 `D:/dsh/skill-merge/merge-pipeline/artifacts/gates/RG7/...` 与写死的 `0.30.18`，并以 `it.skipIf(!present)` 包住，只要本机没有那四个 tarball（CI/镜像永远没有）就整条跳过。
- 机制：两个文件都是 `@tier pre-tag`，`reports/check-taxonomy.json` 的 `pre-tag` lane 成员把它们计入 436；`gen-check-taxonomy` 只按标记计数，不检查用例是否被无条件跳过。`rg7-install` 的断言对象是「上一次在另一台机器上装好的目录」，不是本次产物。
- 后果：门禁读数里存在永不执行的「绿」成员；真正需要跨进程/打包安装验证的 RG4/RG7 主张，实际由 CI 的 `smoke-packed-install` 等另一条线承担，名字与证据错位。
- 修法：删掉 `rg4-two-process.spec.ts`（其主张改由 CI action 的 smoke 承载并登记），`rg7-install` 改为参数化 `RG7_INSTALL_DIR` 的 machine-local 行（registry 的 `machine-local` tree），或直接把断言移到 `verify-packaged-install` 门禁。

### P1-5 元门禁的核心判据是 report-only，现存 2 条命令行漂移无人消费

- 位置：`packages/scripts/verify-gate-manifest.mjs:432-476` —— `argv-ci-parity`、`executability`、`no-placeholders`、`falsifiability-carrier` 四轴只写 observations，`problems` 仅来自注册表/表/containment 等硬检查；实测 `--report`：`argv-ci-parity: 2`（`gate-16` 表里 `--self-test` vs action 的真实 home 校验；`gate-49` 表里 `--coverage` vs action 的 `--probes --baseline=json:…`）+ `falsifiability-carrier: 4`（`ci-only-20/21/23/26` 既无 `drillCmd` 也无 `noDrillReason`），最终仍 `EXIT=0`。
- 机制：`verify-check-registry.mjs:101` 的六轴清单不含 `argv-ci-parity`，因此这 2 条漂移没有任何消费者；`falsifiability-carrier` 读的是 `drill-declarations.json`：85 条里只有 36 条有真正可执行的 `drillCmd`、49 条只有「为何不能」文本、7 行（`gate-80`、四个 `ci-only-2x`、`gate-83/84`）完全没有声明，而该轴的登记到期日是 0.60.0（`family-facts.json:989-994`，renewal 已从 0.56.0 续到 0.60.0）。
- 触发：改 action 的调用形态但忘改 manifest（反向亦然）；或新加一条脚本门禁而不给它任何可证伪路径 —— 两种当前都只产生 observation。
- 后果：CONTRIBUTING 的「表行 = 实际执行」在 2 条上都已不成立；「绿能不能被变红」的载体 40% 没有 drill，且该轴不会红。
- 修法：`verify-check-registry` 增加 `argv-ci-parity` 轴并把 mismatches 当 fail（substitution 表只保留已登记的 3 条）；`falsifiability-carrier` 的 expiry 到期即 fail（现有评估器可直接复用），新表行无 drill 直接拒绝生成。

## P2 / 技术债 / 屎山

1. **25% 的 mutation 豁免与「到期悬崖」**：`verify-mutations --coverage` 实测 92 行中 33 行 `exempt`、59 行 recorded、58 条有 redProven；33 条豁免全部 `expiry 0.60.0`（`family-facts.json:1770-1789`，renewal 写着「Renewed at 0.57.0」），家族版本 0.59.6 → 下一版不续期即整条 release 门转红；其中 `gate-03`（套件本身）也在豁免名单里，套件的「可变红」没有 mutation 证据。
2. **证据里的 gates 行是 job 退出码的再标签**：`release-job-ledger.mjs:32` 直接写 `criterionEvaluated: true`，`lib-release-evidence.mjs:162` 的「pass 必须 criterionEvaluated=true」于是只校验了一个常量；`assemble-release-evidence.mjs:71-77` 的 `--gates-from-manifest` 更直接写 `ok:true, synthetic:true`（staging 用，publish 才换 job 台账）——evidence 的「gates 台账」不是 `run-gates` 的逐行 verdict 工件，而 action 明明上传了 `gates-*.json`（`action.yml:362-367`）却没人消费。
3. **measured commit 绑定不含门禁脚本**：`release.yml:287` 的 pathspec 是 `packages/evolution-* packages/memory packages/tool-skill-manage package.json platform-line.json`，不含 `packages/scripts`（发布时被拷成 overlay 的 `scripts/`，即证据的生产者）与 `packages/test-support`；测量后改 verify 脚本不触发 bind，旧 evidence 仍然「适用」。
4. **假 io 与真 io 分支不同**：`test-support/fake-io.ts:41` 的 `rename` 恒抛 `rename unsupported`，于是 `skill-store.ts:2524-2560` 的 `moveDir` 在 18 个 fake-io spec 里永远走 copy+remove 兜底分支，主分支（rename 成功）只由 real-io 的 `archive-retention.spec.ts` 间接覆盖；fake io 也无法表示空目录（`exists` 由文件推导）与 `writeText` 自动建父目录，`temp-home`/empty-dir 守卫类分支在假环境里不可达。建议把「provider 不能 rename」做成显式选项，主/备两分支各一条断言。
5. **临时目录泄漏与夹具重复**：`temp-home.ts` 已提供回收器（153 个 spec 使用），但仍有 52 个 spec 自己 `mkdtemp`，其中 11 个完全不清（如 `evolution-core/tests/authority.spec.ts:14`、`evolution-merge/tests/undo-fence.spec.ts:15`、`tool-skill-manage/tests/create-tree-reads.spec.ts:30,48`），Windows 上没有 10 次重试删除，长期堆积并被 AV 占用时表现为随机 EBUSY flake。
6. **巨型测试文件**：`evolution-curator/tests/curator.spec.ts` 2399 行、`evolution-commands/tests/commands.spec.ts` 1590、`tool-skill-manage.spec.ts` 1532、`evolution-core/tests/skill-store.spec.ts` 1313、`doctor.spec.ts` 1005、`evolution-activity/tests/feedback/feedback.spec.ts` 1089 —— 一个文件内自建 fixture、真 io、fake io、并发场景混放，无法按行为定位失败，也阻止 `--only` 粒度收窄。
7. **时间预算只有声明**：`testing-policy.tiers.fast.maxWallMs=60000` + `enforced:false`（`family-facts.json:485-486`），baseline 自己记录「49.1s 空闲 / 61.9s 有负载」并解释为「measurement condition」；套件在 CI 是 `--maxWorkers=2`、lane `--concurrency 1`（`action.yml:174`），本地文档又要求 `--maxWorkers=1`（`docs/developer/development.md:15`），并发度三处不一致，墙钟读数不可比。
8. **Windows 上的静默空测试**：`evolution-core/tests/io.spec.ts:406-407` 的用例标题写 `(POSIX)` 却在 win32 直接 `return`（不是 skip），Windows lane 记一条 0 断言的 pass；`skill-store.spec.ts:1289` 反向只有 win32 才跑，Linux lane 永远不覆盖。两处都没有 `it.skipIf` 标注，读数上无法区分「跳过」与「验证过」。
9. **生成物与登记混放**：`packages/scripts/reports/mutation-coverage.json` 是提交进仓库的生成物：24 条记录，其中 `beh-installer-layered` 已不在 `probes.json` 里却永久留在台账，而 `verify-mutations --coverage` 实测只报 `23/23 probe(s)` 匹配、从不拒绝台账孤儿记录；记录只有 `provenAt`（最早 2026-11-10）没有 commit 字段，`family-test-lines.json` 的 `tree` 同样已过期（见 P1-3）。建议把「生成物 freshness/孤儿记录」统一成 `--check` 门禁，而不是散落在各 verifier。
10. **表只覆盖 84/92 行**：`CONTRIBUTING.md:30` 写 `all 84 steps`，`gate-manifest.json` 实有 92 行；差集是 8 条 `ci-only-*`，其 registry 行自述「CI-only gate with no table row yet — local slot pending (G0-1)」（如 `ci-only-26`）。「all」的措辞与登记面不一致。
11. **read-failure 当空**：`packages/scripts/acceptance/fixtures.mjs:55,83,122` 对 usage/state 读取 `catch {}` 后按 `{}`/空串继续，正是家族 N36 规则在 src 里禁止的形态；`verify-arch-guards` 的扫描面不含 `scripts/acceptance`，于是真实主机验收证据的读取失败会变成「没有数据」而不是红。
12. **死开关/机器路径**：`verify-gate-manifest.mjs:62` 的 `SKIP_MANIFEST_FRESHNESS=1` 全仓无人设置，是潜在旁路；同时 `freshnessArmed`（`:61`）只在 mirror 布局成立，CI overlay 不跑 manifest 新鲜度检查。`run-gates.mjs:98` 硬编码 `D:/dsh/_tools/lib-line.mjs` 作为 `adapterSha` 来源，CI 上恒为 `absent`，identity 里的 adapter 读数失去意义。
13. **文档声明落后于代码**：`docs/developer/architecture-optimization/README.md:11` 仍写「剩余发布门禁全量执行…」，`:45` 写「4 lane gate 的读数来自 0.49.0 发布证据，进入发布门时重跑」；`characterization.md:4,41` 的全量 merge 基线停在「>13 分钟未跑完」。而 HEAD 已是 0.59.6、CI 四 lane 已接线 —— 文档把当前门禁能力说小了，读者会误以为没有 lane 证据。

## 门禁评估表（只读实测）

| 门禁/资产 | 能失败吗 | 依据 | 备注 |
|---|---|---|---|
| `run-gates` 执行器 | 是 | `gates/report.mjs:77-83` exit 1/2/3；timeout 记 cannot-decide | 空 profile 会补 cannot-decide（`:328-344`） |
| `gate-07` arch-guards | 是（强） | 42 条规则 + `--strict`；N14/N36 有冻结基线 | 扫描面不含 `scripts/acceptance`、`test-support` |
| `gate-22` verify-gate-manifest | 部分 | 注册表/表/containment 硬红；四轴 report-only | 现 2 条 argv 漂移 + 4 条无 carrier 仍 exit 0 |
| `gate-48` verify-check-registry | 部分 | 实测 `axes pass=6 registered=1`（falsifiability 登记到 0.60.0） | 无 `argv-ci-parity` 轴 |
| `gate-49` verify-mutations --coverage | 是（会 exit 2） | 实测 `recorded=59 cannotDecide=0 redProven=58` + 33 exempt | 豁免到期 0.60.0，悬崖式转红 |
| `gate-03` vitest 套件 | 是（exit 1） | `gates/unit.mjs:14,16`；`localSafe:false` 本地永跳过 | 不加载 family config（P1-2） |
| `gate-55` verify-traceability | 是 | 实测 `52/52 accounted (strict)` | evidence 里的 traceability 块不绑定它 |
| `ci-only-26` verify-test-lines | 名义是，实质否 | `verify-test-lines.mjs:84` 仅集合漂移；175 条全 pending | 见 P1-3 |
| release evidence `--release` | 是（缺文件/过期/synthetic 拒） | `verify-release-evidence.mjs`；`lib-release-evidence.mjs:114-177` | 旧数据可填充（P1-1） |
| `run-load-sensitive` | 是（改名即计数失败） | 实测 3 条 case、`--retry=0`、workers pin | 只覆盖 `io.spec.ts` 3 例 |
| `rg4-two-process` / `rg7-install` | 否 | 整文件 skip / skipIf(!present) | 仍计入 pre-tag lane（P1-4） |
| `SKIP_MANIFEST_FRESHNESS` 旁路 | 未被使用 | `verify-gate-manifest.mjs:62` | 死开关，建议删除 |

## 更优验证策略

1. 证据链改「产物绑定」：`--release` 复算 dist tarball 的 sha256 集合，与每条 spike 的 `artifactSha256` 比对；`traceability.source` 必须等于 `measuredCommit` 且 assemble 覆盖写；`evidenceStatus` 只由校验器写。
2. 一条测试线：`unit.mjs` 固定 `-c vitest.family.config.mjs`，`--testTimeout` 由 facts 供给；把 `reports/check-taxonomy.json` 的 lane 成员作为唯一执行集合，并加「每个 spec 恰好属一个 lane」的 `--check`。
3. 让平台耦合账本有判据：`expectLine` 只能是 local/ci/both，pending 必须带版本 expiry（复用 `lib-exemptions`），`tree≠HEAD` 判红。
4. 门禁表与执行对齐：`verify-check-registry` 增加 `argv-ci-parity` 轴，把 action 上传的 `gates-*.json` 作为 evidence 的 gates 台账而不是 job 退出码。
5. 把 skip 变成读数：taxonomy 生成时统计 `it.skip/skipIf/runIf` 与 `process.platform` 早退，lane 成员里出现永久 skip 即红或降级为 DEFERRED（登记 + 到期）。
6. 临时目录与假 io 收口：禁止测试直接 `mkdtemp`（arch guard 一条正则即可），`fakeIo` 显式暴露 `canRename` 开关，主/备分支各一条断言。
7. 可证伪性进 CI：把 `script/drill-declarations.json` 里 36 条 `drillCmd` 纳入一个低频 lane 逐个执行，`noDrillReason` 到期即 fail。
8. 元门禁去观测期：`pendingAxes` 只在到期前生效，续期必须改 version 并在 renewal 里给出减少量，否则到期即红（现有评估器已具备）。

## 覆盖清单

- 逐字读：`run-gates.mjs`、`gates/{registry,model,report,unit,release,steps,runner}.mjs`、`verify-gate-manifest.mjs`、`verify-test-lines.mjs`、`verify-release-evidence.mjs`、`lib-release-evidence.mjs`、`assemble-release-evidence.mjs`、`release-job-ledger.mjs`、`verify-mutations.mjs`、`verify-check-registry.mjs`、`lib-exemptions.mjs`、`vitest.family.config.mjs`、`run-load-sensitive.mjs`、`release-evidence-rehearsal.json`、`family-test-lines.json`、`gate-manifest.json`、`drill-declarations.json`、`test-support/*`、`.github/actions/evolution-validate/action.yml`、`.github/workflows/release.yml`、CONTRIBUTING/development/architecture-optimization 相关段。
- 机械扫描（全 508 个 spec / 527 个 tests 文件 + 640 个生产文件）：`it.skip/only/runIf/skipIf`、`timeout/timeoutMs`、`setTimeout/sleep`、`retry`、`realFs/fakeIo`、`TODO/FIXME/HACK`、空 `catch {}`、`@ts-ignore/eslint-disable`、`: any`、`mkdtemp`、巨型文件行数。
- 只读执行：`verify-mutations --coverage`（exit 0）、`verify-test-lines --strict`（exit 0）、`verify-gate-manifest --report`（6 observations，exit 0）、`verify-check-registry --strict`（exit 0）、`verify-traceability --strict`（exit 0）。
- 未做：未运行 vitest 套件与 `run-gates` 全量（需 overlay / 会产生写入与长耗时）；未验证 upstream 平台仓库自身的 vitest 配置对 family spec 的 include 规则（CI 读数的确切集合仍为推断，判定法：在 CI overlay 上打印 `vitest list --reporter=json` 的用例数并与 taxonomy 508 对账）；`packages/docs/`（gitignore 的本地过程文档）未纳入。
- 结论计数：P0 = 0，P1 = 5，P2/技术债 = 13。仅本文件被写入；`git status` 在审计前后均为干净（除本文件）。
