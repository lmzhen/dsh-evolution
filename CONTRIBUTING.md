# Contributing to dsh-evolution

This repository is the publication carrier. `packages/*` are the packages that ship; the root documents and `docs/` are the user-facing surface. The validation overlay is a separate copy of the same sources under the platform checkout; edit the mirror, then copy into the overlay only to run platform-coupled checks.

## Start here

1. Edit `packages/<pkg>/…` in this mirror. Do not edit generated YAML, generated client tables, or `lib/` by hand.
2. Run the focused spec in the overlay when the change touches platform services; pure library changes can run in the mirror.
3. Run the family gate runner (the command and flags are in [docs/developer/development.md](docs/developer/development.md)). It writes one log per step and a summary.
4. Put each conclusion in its one home. §Where a fact lives is the rule; a second copy fails the doc-facts gate.

## Where a fact lives

| Layer | What it holds | Where it lives |
|---|---|---|
| Conclusion | what a user must know | one document: a README, or `INSTALL.md` for install-form facts |
| Mechanism | how it works | package README or architecture doc |
| Declaration | what runs / what is registered | the generator, manifest or registry that produces it |
| History | what changed and why | `CHANGELOG.md` and git |

The canonical fact table is `packages/scripts/family-facts.json`. If you move a fact, update the home named there; do not restate it elsewhere. The user docs are not a second source.

## Tests

- Use the family Vitest config; pass `--testTimeout=30000`.
- Tiers: `fast` (no spawn/real wait/wall-clock assertions), `pre-tag` (no wall-clock assertions), `ci-only` (needs the platform line). Do not move a check to a faster tier to make it green.
- Run a single spec by file; an entire directory can exceed the default timeout for reasons unrelated to the change.
- A green process is not a pass by itself: the declared criterion must be evaluated. An unevaluated criterion is not a pass.

## The gate: all 82 steps

The local profile runs the family gate runner (see [docs/developer/development.md](docs/developer/development.md)); `pre-tag` and `ci` add the release checks. The table below is generated from the gate registry (`packages/scripts/gates/registry.mjs`); do not hand-edit it. If a row moves tier or command, change the registry and regenerate the views.

The same registry decides each row's lane (`local`/`pre-tag`/`ci-static`/`ci-unit`/`ci-release`/`ci-windows`/`ci-setup`); the CI action runs lanes through `run-gates.mjs` instead of a hand-written command list, and each row's CI-specific argv/environment lives in its `ci:` override. Registry ids are frozen: never renumber a row.

| # | Command | Working tree |
|---|---|---|
| 1 | `node packages/evolution/scripts/verify-family-types.mjs` | overlay |
| 2 | `node node_modules/oxlint/bin/oxlint -c packages/evolution/oxlint.release.json packages/evolution --ignore-pattern '**/tests/**' --ignore-pattern '**/vendor/**' --ignore-pattern '**/scripts/**' -A style` | overlay |
| 3 | `node node_modules/vitest/vitest.mjs run packages/evolution --maxWorkers=2 --testTimeout=30000` | overlay |
| 4 | `node packages/evolution/scripts/build-lib.mjs` | overlay |
| 5 | `node packages/evolution/scripts/smoke-built-entries.mjs packages/evolution` | overlay |
| 6 | `node packages/scripts/verify-dependency-closure.mjs packages --strict` | mirror |
| 7 | `node packages/scripts/verify-arch-guards.mjs packages --strict` | mirror |
| 8 | `node packages/scripts/verify-event-pairing.mjs packages --strict` | mirror |
| 9 | `node packages/scripts/verify-declared-config.mjs packages --strict` | mirror |
| 10 | `node packages/scripts/verify-param-registry.mjs packages --strict` | mirror |
| 11 | `node packages/scripts/verify-bundle-rows.mjs packages --strict` | mirror |
| 12 | `node packages/scripts/verify-param-channel-parity.mjs packages --strict` | mirror |
| 13 | `node D:/dsh/audit-v37/check-tsconfigs.cjs` | machine-local |
| 14 | `node D:/dsh/audit-v37/check-manifests.cjs` | machine-local |
| 15 | `node D:/dsh/audit-v37/mirror-sync.mjs check` | machine-local |
| 16 | `node packages/scripts/verify-profile-bundles.mjs --self-test` | mirror |
| 17 | `node packages/scripts/verify-doc-facts.mjs packages --strict --require-repo-docs` | mirror |
| 18 | `node packages/scripts/verify-platform-contract.mjs packages --upstream D:/dsh/_upstream/dsh-upstream-0.2.2-rc.1 --accept-recorded` | mirror |
| 19 | `node packages/scripts/verify-package-discovery.mjs packages --strict` | mirror |
| 20 | `node packages/scripts/verify-family-tool-names.mjs packages --strict` | mirror |
| 21 | `node packages/scripts/verify-skill-roots.mjs packages --strict` | mirror |
| 22 | `node packages/scripts/verify-gate-manifest.mjs packages` | mirror |
| 23 | `node packages/scripts/verify-line-identity.mjs --policy-only --strict`（CI 形态；**带 `--manifest <path>` 的形态在拥有测试床的机器上跑**，换错线时第一条错误为 `platform line mismatch`） | mirror |
| 24 | `node packages/scripts/verify-arming.mjs --packages packages --strict`（第二个元门禁：每条规则的扫描族在真实树必须 >0；接线类由 doc-facts 拥有） | mirror |
| 25 | `node packages/scripts/verify-client-seats.mjs packages --strict`（客户端半的座位读取与平台席位一致性） | mirror |
| 26 | `node packages/scripts/verify-client-tokens.mjs packages --strict`（客户端 token 使用） | mirror |
| 27 | `node packages/scripts/verify-platform-ranges.mjs --manifest-dir packages/evolution/.release-staging`（**发布期**：每个 staged manifest 的 `@deepseek-ai/dsh-*` 必须逐字等于 platform-line.json 派生的 peers 范围、`engines.dsh` 必须等于 engines 窗口；vendored 范围由 `lib-vendored-ranges.mjs` 单源钉住；同时打印双谓词窗口网格两表读数 ✓） | mirror |
| 28 | `node packages/scripts/verify-release-artifacts.mjs .github --strict --self-test`（发布面产物：CI 工作流与发布脚本的一致性 + 检查器自检） | mirror |
| 29 | `node packages/scripts/verify-write-inventory.mjs packages --strict --home <plane home>`（写清单落地：**CI 形态**用 `$RUNNER_TEMP/plane-home`） | mirror |
| 30 | `node packages/scripts/verify-client-ui-i18n.mjs packages`（U-8/G5.9：客户端半的可见文案必须走字典——① 不许把裸字符串当子节点（任何实参位）；② 不许在字符串里写跨面指令 `dsh web`／`/evolution …`；注释先行剥离且**保留行号**。drill：注入一个第 4 实参裸串＋一个跨面串 ⇒ 必红，撤回即绿 ✓） | mirror |
| 31 | `node packages/scripts/verify-error-codes.mjs packages`（G4.3/C5：错误码表与文档必须**同集**——源码新增码未入档、或文档留着一个已删除的码，都必红；并校验文档里的**区间**与表实际一致。drill：给源码塞一个 E-322 ⇒ 必红；删掉一行文档码 ⇒ 必红；撤回即绿 ✓） | mirror |
| 32 | `node packages/scripts/gen-install-counts.mjs . --check`（G4.1/C5：README 的"装了几个包／发布了几个"必须由 `lib-family-packages.mjs` 派生——**本批纠出的真实漂移：原文写 29/30，树里是 31/32** ✓。drill：手改标记区内任一数字 ⇒ 必红，重跑生成器即还原 ✓） | mirror |
| 33 | 生成物 `--check`（六件一起，CI 同款）：`node packages/scripts/gen-bundle-patches.mjs packages --check` ＋ `gen-client-tokens.mjs packages --check` ＋ `gen-param-client-view.mjs packages --check` ＋ `gen-param-docs.mjs packages --check` ＋ `gen-client-guards.mjs packages --check` ＋ `gen-about.mjs packages --check`（G5.10/U-10：版本与用途的生成物 ✓）（G4.1/C5：生成物与源不同步即红——四个生成器**都已支持 `--check`**，缺的只是"有人跑"。drill：给 PARAMETERS.md 动一个字符 ⇒ `gen-param-docs --check` 必红，撤回即绿 ✓） | mirror |
| 34 | `node packages/scripts/verify-package-map.mjs packages`（G4.1/C5 roster：`packages/README.md` 的 Package map 必须**恰好**列出树里全部可发布包——新增包没入图、或图里留着一个已不存在的包，都必红。drill：把状态行里的 `evolution-state-json` 去掉 ⇒ 必红并点名；撤回即绿 ✓） | mirror |
| 35 | `node packages/scripts/verify-composer-single-source.mjs packages`（G2-S2：preset 组合器**只有一个实现**——core `composition/composer.ts`；安装器 import 构建产物 `evolution-core/lib/composition/index.js`。安装器侧生成双胞胎、其生成器与本地注入逻辑均已退场；任何一件回来即红 ✓） | mirror |
| 36 | `node packages/scripts/verify-lock-usage.mjs packages`（G6-②：**写 profile patch 的源文件必须调用平台的 HMR 锁** `runExclusive`，且必须保留平台自己的降级形状 `hmr === undefined ? 直接调用 : 加锁`；独立 CLI 的安装器无 ctx 不在范围内 ✓。drill：① 把 `runExclusive` 改名 ⇒ 必红（"without calling the platform HMR lock"）；② 保留锁但删掉降级分支 ⇒ 必红；撤回即绿 ✓。**注**：初版探针只看"字符串出现"⇒ 注释里的 `hmr.runExclusive(apply)` 就让 drill 空过 ✗ ⇒ 已改为**剥注释后按调用形态匹配** ✓） | mirror |
| 37 | `node packages/scripts/verify-source-text-single-source.mjs packages`（G7-3 份数=1：**全家族只许有一份注释剥离实现**（家＝`scripts/lib-source-text.mjs` ✓），任何探针再自带一份（按名字即红；另有一条只覆盖特定拼法的正则网，其覆盖边界见 G0-0.3 记录）即红 ✓；判据实测从 **7 文件 → 1** ✓。drill：往 `verify-package-map.mjs` 塞一个 `withoutComments` ⇒ 必红并点名；撤回即绿 ✓） | mirror |
| 38 | `node packages/scripts/verify-atomic-write-single-source.mjs packages`（G7-3 份数=1：**全家族只有一个原子写实现**，家在 `evolution-core/src/io.ts`（接缝）✓；判据＝"同时出现 `renameSync(` 与 `.tmp` 暂存名"的文件只许是家 ✓，且**先剥注释**（注释里的名字不算 ✓）。drill：① 往 `evolution-state-json/src/index.ts` 塞一段真代码提交序列 ⇒ 必红并点名 ✓；② 同样名字只写在**注释**里 ⇒ **绿** ✓（＝"剥注释"这条的活体证明 ✓）；③ 撤回即绿 ✓） | mirror |
| 39 | `node packages/scripts/verify-predicate-single-source.mjs packages`（G7.1/A8 份数=1：**对象谓词只有一个作者**（家在 `evolution-core/src/guards.ts` ✓）；宿主侧一律 import ✓，client 半（不能 import core ✓）用**生成副本**（文件头标 GENERATED ＋ 指名家 ✓）。判据＝剥注释后按"含 typeof … === 'object' 且 !Array.isArray("的形态匹配 ✓；drill：① 任一宿主文件内联一份 ⇒ 必红并点名 ✓（本轮它当场抓出我漏掉的 `state-json` 一处 ✓）；② 手改生成副本 ⇒ `gen-client-guards --check` 必红 ✓；撤回即绿 ✓） | mirror |
| 40 | `node packages/scripts/verify-readonly-single-criterion.mjs packages`（G7.2/F-2 单判据：**只读动作集合只有一个判据** `READ_ONLY_ACTIONS`／`isReadOnlyAction`（四处用途各自保留调用点 ✓，但判据只有一处 ✓）；判据脚本＝"某处定义了它" ＋ "**没有任何文件再内联** `!== 'list' && … !== 'unpin'` 串" ✓（剥注释 ✓＋豁免自身 ✓）。drill：把那四处之一改回内联 ⇒ 必红并点名；撤回即绿 ✓） | mirror |
| 41 | `node packages/scripts/verify-command-table.mjs packages`（G7.4/C7：**命令表与派发必须一致**——A 每条表项带 C7 形状（usage＋summary＋readonly）；B usage 首词＝表名、flag 写法可读（usage 是**文档**不是命令行）；C 双向：派发答的每个名字都要有表项（缺表项不得上线），表里每个名字源码都要答；输出含仍在用自有正则派发的分支数＝迁移进度。drill：加一条名字未登记的派发 ⇒ 必红并点名；撤回即绿） | mirror |
| 42 | `node packages/scripts/verify-bounds.mjs packages`（G2.4/C3：**一个锁、一个上界**——A 凡出现 instance-idiom（instanceHome／holdsInstance／claimInstance／single-flight）又自造模块级守卫且**不**消费 claimInstance ⇒ 必红；B 计时调用（setTimeout／setInterval／AbortSignal.timeout／sleep）里出现**裸毫秒字面量** ⇒ 必红，超时常量**跨包重值**只报告。drill：注入自造锁 ⇒ 点名；注入 `setTimeout(f, 5000)` ⇒ 点名；撤回即绿） | mirror |
| 43 | `node packages/scripts/verify-io-discipline.mjs packages`（G2.2/C4：**写门面是通往磁盘的唯一一道门**——域内 src 不得裸调 rmSync／unlinkSync／renameSync／copyFileSync／writeFileSync／mkdirSync 或裸异步 rm(／unlink(／rename(／copyFile(；**方法调用**（io().rename(、this.io.remove(）放行；介质＝evolution-core/src/io.ts ＋ evolution-io-node 的 src。drill：往域内注入一个 rmSync ⇒ 点名必红；撤回即绿） | mirror |
| 44 | `node packages/scripts/verify-declarations.mjs packages`（G4/C5+C6：**声明了就必被渲染，例外必须显式**——A 生成视图里每个字段的 control 必须在 ParamCard.ts 有渲染分支；B **双向**对账 C6 表 `scripts/client-exceptions.json`（`{fieldId, reason, owner}`）：无平台件的 switch/select 字段**必须**在表里（缺 ⇒ 必红），表里**不得有**生成视图已不带的陈旧条目（有 ⇒ 必红）；C reason／owner 非空、id 唯一。drill：删一条例外 ⇒ 点名必红；加一条陈旧条目 ⇒ 必红） | mirror |
| 45 | `node packages/scripts/verify-graph-edges.mjs --self-test`（P0′ 读路径：技能"参见边"的解析与悬空检查门禁 —— 自证形进 CI；活根形 `--report` 只留 local/pre-tag，CI 无技能根会 exit 2。三态：0=边>0且悬空=0／1=悬空·自指·形态非法／2=CANNOT DECIDE；无降级读器，运行时读器不可用即 exit 2 且不给数字） | mirror |
| 46 | `node packages/scripts/gen-check-taxonomy.mjs packages --check`（G2/M1 视图：把「门禁 × 档位 × spec」的普查视图从**声明面生成**出来（`--report` 人读、`--json` 机读）；`--check` 判生成物与声明面一致。**空档位必须 exit 2**——一个跑不到任何 spec 的档不是"干净"，是真空） | mirror |
| 47 | `node packages/scripts/verify-verdict-records.mjs packages`（G1/C7 判决记录：夹具四例＋健康对照——输入置空时每条 check 必须 `cannot-decide` 且 `missing≠∅` 且 **exit 2**；判决与理由必须同源，读数只计 `criterionEvaluated===true ∧ verdict==='fail'` 并按 `cause.kind` 分列） | mirror |
| 48 | `node packages/scripts/verify-check-registry.mjs packages --strict`（七轴总账：闭包／可执行性／到期／**mutation 覆盖（读 reports/mutation-coverage.json 的签名台账，6 探针逐条）**／**生产者接线（每条 check.requires 的 producer 必须有 manifest 行或 CI action 执行）**／真空证伪／占位符——在册的轴计数与实测不符即红，闭包破了即红） | mirror |
| 49 | `node packages/scripts/verify-mutations.mjs --coverage`（G5/1 变异库：每条 check 需 `checkMutations` 记录，缺／残 ⇒ cannot-decide；`--only <id>` 现场打补丁→跑→断言语义→还原并校验哈希；`--self-test` 必须抓出等值 mutation 与矛盾期望，抓出即 **exit 0**；`--probes [--only <probe>] [--list] [--ledger <path>] [--no-stamp]` 逐条执行 `probes.json` 的 mutation fixture：快照→应用→探针必红→还原校验→写 `reports/mutation-coverage.json` 签名台账） | mirror |
| 50 | `node packages/scripts/gen-health-baseline.mjs packages --check`（G4/① 生产者：健康基线语料的**唯一作者**；消费侧缺产物一律 cannot-decide，不许绿色兜底） | mirror |
| 51 | `node packages/scripts/gen-line-manifest.mjs --check`（G0/0.7 复核：床清单必须与树一致 —— 生成物陈旧即红。这条是「退役包不得残留在在册交付件里」的守卫：io-fs 于 2b.2 退役后曾长期残留在 line-manifest.json 里，而当时没有任何档位以 --check 调用生成器。CI 形态是**三段**：`gen-line-manifest`（无条件重生成）→ `test -z "$(git status --porcelain -- packages/scripts/files/line-manifest.json)"`（入库副本必须与树一致；用 porcelain 而非 diff，因为未跟踪文件对 diff 不可见，而「根本没入库」正是这条门禁要抓的形态之一）→ `--check`。**产物格式**：`{ pin, bed: { mono }, entries: [{ id, kind, relPath }] }` —— entries 由**仓内名册**派生（`relPath` 相对 overlay 根），不含任何宿主绝对路径；`pin` 取 `git -C <root> rev-parse --short HEAD`，**不参与**逐字比对（身份是 id+kind，pin 随提交前进），`--check` 只断言它非 `unknown`，缺 pin ⇒ exit 2） | mirror |
| 52 | `node packages/scripts/verify-subagent-single-source.mjs packages`（G3-S6 架构守卫：家族只有**一条**子代理执行路径——业务源码不得再出现 `subagents.start(spawn)`／`withSettleWatchdog`／`.localAgent`／`toolFilter:`／`persona:`／`MaintainSubagent*`，`startActivation` 只允许在 `evolution-core/src/subagent/channel.ts`；测试夹具的 legacy 适配器不在扫描范围） | mirror |
| 53 | `node packages/scripts/verify-host-routes.mjs packages`（G4/W6 宿主数据面守卫：`HOST_ROUTES` 是 `/api/dsh-evolution/**` 路径的唯一家（4 surface/12 endpoint）；业务 `src` 不得出现 loopback fence／`webServer.register`／手抄路由 path；三包 must import `HOST_ROUTES`；G5 生成器落地后移除 client 豁免。**空扫描 exit 2**） | mirror |
| 54 | `node packages/scripts/gen-client-seam.mjs packages --check`（G5/W7 客户端生成物：`routes/route-client/contracts/fallbacks/states.generated.ts` 共 15 个生成物由 core `HOST_ROUTES`/`COMMAND_FALLBACKS`/`diagnostics.ts` 与 5 个模板渲染到 3 个 UI 包；`--check` 断言入库生成物=生成器输出（陈旧即红）；**生成器优先读构建后 core lib（R13），mirror 无 lib 时按约束静态读 HOST_ROUTES 字面量；找不到 HOST_ROUTES ⇒ exit 2**） | mirror |
| 55 | `node packages/scripts/verify-traceability.mjs packages --strict`（G7/W11 追账：52 项 universe（A-22/B-18/C-12）必须逐条覆盖；缺行/重复/未知 id/乱序/adopted 缺落点证据/deferred 无 trigger→**exit 1**，空矩阵→**exit 2**；`--planned` 只校验 schema/覆盖/顺序（探针注册归 W9，strict 模式另查 files/probes/gates 存在与预算实测）） | mirror |
| 56 | `node packages/scripts/verify-release-evidence.mjs packages/evolution/dist/release-evidence.json`（W2/W3/W10/W11 发布证据：schemaVersion=2、platformLine 与 platform-line.json 逐字、manifests 范围一致；`--release` 时另要求 ciFace/gates/S1–S4 全 pass/52 项 traceability 全覆——blocked 不算 pass。缺文件/不可解析→**exit 2**） | mirror |
| 57 | `node packages/scripts/assemble-release-evidence.mjs packages/evolution/dist/release-evidence.json --rehearsal packages/evolution/scripts/release-evidence-rehearsal.json --gates-from-manifest ci --ci-face ci --os ci`（W3/W10 发布证据装配：把 pack 写出的 schema-2 骨架与本仓演练快照（S1–S4 spike 证据 + W11 52 项 traceability）合并，并写入 CI face 与本次 compat-check 已执行的 gate 台账；`--release` 在 publish 前复验；缺输入/不合格→exit 1/2） | mirror |
| 58 | `node packages/evolution-merge-engine/verify-upstream.mjs`（engine 发布 parity：UPSTREAM.json 的逐文件 bytes/sha256 与 testPatchSet 的 patchedBytes/patchedSha256 必须全等；缺文件/不匹配→exit 1。GAP-P0-05 的发布门禁） | mirror |
| 59 | node packages/evolution/scripts/audit-release-tarballs.mjs packages/evolution/dist --version "${RELEASE_VERSION#v}" --platform-range "^$RANGE" | overlay |
| 60 | node packages/evolution/scripts/gen-about.mjs packages/evolution --check | overlay |
| 61 | node packages/evolution/scripts/gen-bundle-patches.mjs packages/evolution --check | overlay |
| 62 | node packages/evolution/scripts/gen-client-guards.mjs packages/evolution --check | overlay |
| 63 | node packages/evolution/scripts/gen-client-tokens.mjs packages/evolution --check | overlay |
| 64 | node packages/evolution/scripts/gen-param-client-view.mjs packages/evolution --check | overlay |
| 65 | node packages/evolution/scripts/gen-param-docs.mjs packages/evolution --check | overlay |
| 66 | node packages/evolution/scripts/gen-requirements.mjs packages/evolution --check | overlay |
| 67 | node packages/scripts/inject-evolution-paths.mjs upstream/tsconfig.base.json tsconfig.base.json | mirror |
| 68 | node packages/evolution/scripts/install-layered.mjs --home "$HOME_DIR" --profile web --mode layered | overlay |
| 69 | node packages/evolution/scripts/lib-line-header.mjs --ci --policy packages/evolution/scripts/line-policy.json | overlay |
| 70 | node packages/evolution/scripts/prepare-release.mjs "${ARGS[@]}" | overlay |
| 71 | node packages/evolution/scripts/publish-scoped.mjs --no-provenance --dry-run | overlay |
| 72 | node packages/evolution/scripts/requirements.selftest.mjs | overlay |
| 73 | node packages/evolution/scripts/run-load-sensitive.mjs . | overlay |
| 74 | node packages/evolution/scripts/smoke-packed-install.mjs packages/evolution/dist --assets-only | overlay |
| 75 | node packages/evolution/scripts/verify-layout-sync.mjs packages/evolution/scripts ../packages/scripts | overlay |
| 76 | node packages/evolution/scripts/verify-probes.mjs packages/evolution | overlay |
| 77 | node packages/evolution/scripts/verify-requirements.mjs packages/evolution | overlay |
| 78 | node packages/scripts/verify-line-identity.mjs --policy-only --strict | mirror |
| 79 | node packages/scripts/verify-line-identity.mjs --manifest packages/scripts/files/line-manifest.json --strict | mirror |
| 80 | node packages/evolution/scripts/verify-graph-edges.mjs --report | overlay |
| 81 | node packages/scripts/verify-health-admission.mjs | mirror |
| 82 | `node packages/scripts/verify-i18n.mjs`（B6：4 个 UI namespace、529 个 key、113 个参数文案、31 个 host error，8 语言 key/占位符/生成物一致；`gen-i18n`/`gen-param-i18n`/`gen-host-errors` 的 stale 输出必红。drill：删一个 UI key ⇒ 必红；改一个占位符 ⇒ 必红；重跑生成器即绿） | mirror |

## Pull request checklist

- [ ] The change is in the right package, not a new micro-package for one file.
- [ ] Generated surfaces were regenerated, not hand-edited.
- [ ] Focused specs and the relevant tier pass.
- [ ] `verify-doc-facts` and strict traceability pass when their inputs changed; `verify-probes` runs in the CI lane or with the probe fixtures.
- [ ] User-facing docs are updated; stale paragraphs are deleted, not archived in place.
- [ ] No secrets, local home paths, or one-off reports are committed.
