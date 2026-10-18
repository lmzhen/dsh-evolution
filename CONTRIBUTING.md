# Contributing to the dsh-evolution family

This repository (the **flat mirror**) is the publication carrier: `packages/*`
are the packages that ship, and the root documents — `README.md`,
`README.zh.md`, `INSTALL.md`, `CHANGELOG.md`, this file — are the user-facing
surface. The CI validation tree is the platform checkout's
`packages/evolution/`, kept byte-identical to `packages/*` before a release.
Edit HERE (the mirror is the authoring tree since 0.3.83) and copy the result
into that validation tree, then run the gate: the `sync-dev-to-mirror` /
`sync-mirror-to-dev` helpers belong to the retired dual-line workflow and the
stale side must never be copied back over this one.

## Start here

1. **Edit in this mirror** (`packages/<pkg>/…`) — since 0.3.83 it is both the
   authoring and the publication tree, so nothing is copied over it.
2. **Copy the change into the validation checkout**. Type-checking and the
   suites run where the same sources live at `packages/evolution/<pkg>/…` (the
   CI overlay built from the platform tag). The machine-local
   `D:/dsh/deepseek-harness` checkout is the stale former dev tree and is never
   a source to copy from.
3. **Run the gate**. `node D:/dsh/audit-v42/run-baseline.mjs <prefix>` executes
   all 53 steps and writes one log per step plus a summary (§The gate has
   the table and says which step runs in which tree).
4. **Decide where your words live**. §Where a fact is allowed to live is the
   rule that fails a conclusion stated in two documents (N19).

## Where a fact is allowed to live (G5, 0.3.78)

The same conclusion used to be written in the root README, the package README,
the install documents and the CHANGELOG, so it drifted where no build could see
it — 0.3.77 left the root README still promising other presets the shared
automation after the variant form made that false, and the agent README kept
denying that a cordis base exists after `bases.json` grew one. (This file has to
describe those claims without quoting them: the strings themselves are the
forbidden copies.) Three layers, one owner each:

| Layer | What it holds | Where it lives |
|---|---|---|
| **Conclusion** | what a user must know | ONE document — a README, or `INSTALL.md` for install-form facts |
| **Reason** | why it changed | `CHANGELOG.md` version sections (released sections are history, never rewritten) |
| **Mechanism** | how it works | the code docblock next to the code |

A fact that wants a second home gets a **citation** instead. The registry is
`packages/scripts/family-facts.json`; each entry names the fact's ONE home, the
sentences that must be there (`must`, with `unique: true` meaning "the home
only"), the claims forbidden everywhere else (`forbid`), the documents that must
cite the home (`cites`), and the machine owner that re-derives the value
(`machine`). Checked values today: the `--base` table
(`evolution-agent/bases.json`), the catalog-cap reach
(`evolution-core/row-overrides.json`), the doctor's reported deployment forms
(`evolution-commands/src/doctor.ts`) and the rendered command table.

- Run it: `node packages/scripts/verify-doc-facts.mjs packages --strict`
- It is also architecture rule **N19** inside `verify-arch-guards.mjs`, so the
  53-step gate runs it on every batch; a second copy fails and names both files.
- `packages/docs/**` is gitignored: it is a source of material, never a home.
  Move the conclusion into a tracked document before citing it.

### Adding a fact to the registry

1. Pick the home document that a reader would already open for that subject.
2. Add the entry: `id`, `title`, `home` (tree-relative), `must` (the exact
   sentence, copied from the home), `forbid` (the drifted claim, with its reason),
   `cites` (the documents that must now point at the home), and `machine` when a
   file owns the value.
3. Make the home say it, make the other documents cite it — do not copy.
4. `node packages/scripts/verify-doc-facts.mjs packages --strict` must be 0, and
   the gate's step 5 must stay green.

## Adding a new surface (G6)

Package, preset base, subcommand, event, session consumer, architecture rule:
each has a copyable skeleton and a checklist whose steps name the guard that
fails when the step is skipped — see
[`packages/scripts/checklists/index.md`](./packages/scripts/checklists/index.md).
A step without a guard is not a step: if nothing fails, say it in prose instead
of pretending it is checked.

## The gate

Run from the two trees (never reorder or rename these steps):

| # | Command | Working tree |
|---|---|---|
| 1 | `node node_modules/typescript/lib/tsc.js -b tsconfig.host.json` | overlay |
| 2 | `node node_modules/oxlint/bin/oxlint packages/evolution` | overlay |
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
| 13 | `node D:/dsh/audit-v37/check-tsconfigs.cjs` | machine-local (outside this repo) |
| 14 | `node D:/dsh/audit-v37/check-manifests.cjs` | machine-local (outside this repo) |
| 15 | `node D:/dsh/audit-v37/mirror-sync.mjs check` | `D:/dsh` (machine-local) |
| 16 | `node packages/scripts/verify-profile-bundles.mjs --self-test` | mirror |
| 17 | `node packages/scripts/verify-doc-facts.mjs packages --strict --require-repo-docs` | mirror |
| 18 | `node packages/scripts/verify-platform-contract.mjs packages --upstream D:/dsh/dsh-upstream-0.2.1-rc.2` | mirror |
| 19 | `node packages/scripts/verify-package-discovery.mjs packages --strict` | mirror |
| 20 | `node packages/scripts/verify-family-tool-names.mjs packages --strict` | mirror |
| 21 | `node packages/scripts/verify-skill-roots.mjs packages --strict` | mirror |
| 22 | `node packages/scripts/verify-gate-manifest.mjs packages` | mirror |
| 23 | `node packages/scripts/verify-line-identity.mjs --policy-only --strict`（CI 形态；**带 `--manifest <path>` 的形态在拥有测试床的机器上跑**，换错线时第一条错误为 `platform line mismatch`） | mirror |
| 24 | `node packages/scripts/verify-arming.mjs --packages packages --strict`（第二个元门禁：每条规则的扫描族在真实树必须 >0；接线类由 doc-facts 拥有） | mirror |
| 25 | `node packages/scripts/verify-client-seats.mjs packages --strict`（客户端半的座位读取与平台席位一致性） | mirror |
| 26 | `node packages/scripts/verify-client-tokens.mjs packages --strict`（客户端 token 使用） | mirror |
| 27 | `node packages/scripts/verify-platform-ranges.mjs --manifest-dir packages/evolution/.release-staging`（**发布期**：每个 staged manifest 的 `@deepseek-ai/dsh-*` 必须逐字等于 platform-line.json 派生的 peers 范围、`engines.dsh` 必须等于 engines 窗口；vendored 范围由 `lib-vendored-ranges.mjs` 单源钉住；同时打印双谓词窗口网格两表读数 ✓） | mirror |
| 28 | `node packages/scripts/verify-release-artifacts.mjs .github --strict`（发布面产物：CI 工作流与发布脚本的一致性） | mirror |
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
| 45 | `node packages/scripts/verify-graph-edges.mjs --self-test`（P0′ 读路径：技能"参见边"的解析与悬空检查门禁 —— 自证形进 CI；活根形 `--report` 只留 local/pre-tag，CI 无技能根会 exit 2。三态：0=边>0且悬空=0／1=悬空·自指·形态非法／2=CANNOT DECIDE；无降级读器，运行时读器不可用即 exit 2 且不给数字）| mirror |
| 46 | `node packages/scripts/gen-check-taxonomy.mjs packages --check`（G2/M1 视图：把「门禁 × 档位 × spec」的普查视图从**声明面生成**出来（`--report` 人读、`--json` 机读）；`--check` 判生成物与声明面一致。**空档位必须 exit 2**——一个跑不到任何 spec 的档不是"干净"，是真空） | mirror |
| 47 | `node packages/scripts/verify-verdict-records.mjs packages`（G1/C7 判决记录：夹具四例＋健康对照——输入置空时每条 check 必须 `cannot-decide` 且 `missing≠∅` 且 **exit 2**；判决与理由必须同源，读数只计 `criterionEvaluated===true ∧ verdict==='fail'` 并按 `cause.kind` 分列） | mirror |
| 48 | `node packages/scripts/verify-check-registry.mjs packages --strict`（七轴总账：闭包／可执行性／到期／mutation 覆盖／生产者接线／真空证伪／占位符——**在册的轴计数与实测不符即红**，到期项未施加亦红） | mirror |
| 49 | `node packages/scripts/verify-mutations.mjs --coverage`（G5/1 变异库：每条 check 需 `checkMutations` 记录，缺／残 ⇒ **cannot-decide ＋ exit 2**；`--only <id>` 现场打补丁→跑→断言语义→**还原并校验哈希**，`--self-test` 必须抓出等值 mutation 与矛盾期望） | mirror |
| 50 | `node packages/scripts/gen-health-baseline.mjs packages`（G4/① 生产者：健康基线语料的**唯一作者**；消费侧缺产物一律 cannot-decide，不许绿色兜底） | mirror |
| 51 | `node packages/scripts/gen-line-manifest.mjs --check`（G0/0.7 复核：床清单必须与树一致 —— 生成物陈旧即红。这条是「退役包不得残留在在册交付件里」的守卫：io-fs 于 2b.2 退役后曾长期残留在 line-manifest.json 里，而当时没有任何档位以 --check 调用生成器。CI 形态是**三段**：`gen-line-manifest`（无条件重生成）→ `test -z "$(git status --porcelain -- packages/scripts/files/line-manifest.json)"`（入库副本必须与树一致；用 porcelain 而非 diff，因为未跟踪文件对 diff 不可见，而「根本没入库」正是这条门禁要抓的形态之一）→ `--check`。**产物格式**：`{ pin, bed: { mono }, entries: [{ id, kind, relPath }] }` —— entries 由**仓内名册**派生（`relPath` 相对 overlay 根），不含任何宿主绝对路径；`pin` 取 `git -C <root> rev-parse --short HEAD`，**不参与**逐字比对（身份是 id+kind，pin 随提交前进），`--check` 只断言它非 `unknown`，缺 pin ⇒ exit 2） | mirror |
| 52 | `node packages/scripts/verify-subagent-single-source.mjs packages`（G3-S6 架构守卫：家族只有**一条**子代理执行路径——业务源码不得再出现 `subagents.start(spawn)`／`withSettleWatchdog`／`.localAgent`／`toolFilter:`／`persona:`／`MaintainSubagent*`，`startActivation` 只允许在 `evolution-core/src/subagent/channel.ts`；测试夹具的 legacy 适配器不在扫描范围） | mirror |
| 53 | `node packages/scripts/verify-host-routes.mjs packages`（G4/W6 宿主数据面守卫：`HOST_ROUTES` 是 `/api/dsh-evolution/**` 路径的唯一家（4 surface/12 endpoint）；业务 `src` 不得出现 loopback fence／`webServer.register`／手抄路由 path；三包 must import `HOST_ROUTES`；G5 生成器落地后移除 client 豁免。**空扫描 exit 2**） | mirror |

The canonical runner is `node D:/dsh/audit-v42/run-baseline.mjs <prefix>` (it
writes one log per step plus a summary, and prints the step names it ran, so a
drift between this table and the executed set is visible in every gate log).

The three machine-local rows below (13-15) are registered in
`verify-gate-manifest.mjs`'s `MACHINE_LOCAL` table with the step that ports them —
the table may not cite an absolute path that no register covers:
steps 13-15 check tsconfig registration, manifest version uniformity and mirror↔overlay parity. Each row
names its absolute path precisely because these three are NOT shipped guards
(citing a bare script name here would claim a guard the repository does not
have). They are part of the executed gate because no in-repo script covers those
three checks today; a portable replacement belongs in `packages/scripts` if the
workspace is ever used from another machine.

`verify-layout-sync.mjs` is **retired from this table** but NOT from the
release path: the publish chain still executes it as its step 2 version guard,
comparing `packages/scripts/**` against the stale checkout's copy — a drifted
script pair ABORTS the release before any commit or tag (0.3.83 hit exactly
that: 58 drifted files, fixed by copying the mirror's scripts over the stale
side). Its other half, the dev→mirror robocopy, is gone with the dual-line
workflow (running it would overwrite this tree).

The stale tree is `D:/dsh/deepseek-harness` (a platform checkout at `548aa30`
whose `packages/evolution/*` predates this mirror). It carries an
`AUTHORING-MOVED.md` marker at its root pointing here, and the drift between the
two trees is measurable at any time with a **machine-local, warn-only** probe:
`node D:/dsh/audit-v44/two-tree-drift.mjs` (per-package file hashes; it never
exits non-zero). It is deliberately NOT a shipped guard — an in-repo script
cannot assume a second tree exists — which is the same reason rows 8-10 above
name absolute paths.

`verify-doc-facts.mjs` runs standalone for the same check rule N19 makes, and
`verify-platform-contract.mjs --upstream <tree>` audits the platform anchors
(its failures are recorded platform drift, not family drift).

### House rules

- Rule ids are **append-only**: docs and registers cite them, so a landed id is
  never reused or renumbered.
- Scripts under `packages/scripts/` are outside oxlint: their correctness is
  proven by fixtures in `packages/evolution-host/tests/guard-scripts.spec.ts`.
- A new gate lands in warn mode for one release before `--strict` is wired.
- No corpse, no rule: every guard names the incident it exists for.

### 客户端半：hooks 区约定（G4/4.0 · S5-01）

- 客户端组件（evolution-settings-ui／evolution-skill-history 等 src/client 下的组件函数）必须把**全部 hook 无条件写在函数顶部**，条件分支只决定**输出**；hook 调用不得出现在任何 `return`（含提前 return）之后。
- 理由：两个调用方都以普通函数形式调用同一组件时共享同一条 hook 序列，hook 数量随渲染状态变化会直接触发 React invariant（实测三条迁移路径全崩）。
- 待补：静态门禁（hook 不得出现在 return 之后）拟随 G0 的判据线一起落地；在此之前本约定由评审把关。

### 门禁 profile 的两个口径（G0/0.5）

- 家族里 **pre-tag** 有两个口径，过去由两个脚本各自实现（同一个词、两个集合、两个数字都对）：**声明口径**＝行上 `profiles` 里字面声明 pre-tag（`gen-check-taxonomy` 用它）；**并集口径**＝`local ∪ ci`（`run-gates pre-tag` 用它）。
- 两个口径现在都取自同一个**投影模块**（导出 `declaredPreTag` 与 `supersetPreTag`）—— 任何脚本都不得再自行推导这两个集合；模块路径见 policy fact。
- 两个口径的**当前条数**不在本文件复述：取真实值请跑检查分类器与门禁运行器各自的报告/清单开关（两个脚本都在 packages/scripts 下，勿在此处复述它们的文件名或数字）（陈述有一个家，抄一遍就多一份会漂的副本）。
- 行上的 profile 字面量必须在词表内（`local`／`pre-tag`／`ci`）；写错的字面量**不是被忽略**，而是由 `unknownProfiles` 点名（静默丢行会让一条门禁悄悄脱离运行集）。

### 发布之后的字节一致核对（G0/0.4b）

- **发布之后**由发布流程自己的一步承担：抓取 registry 上刚发布的字节，与本地 dist 里那份**逐字节比对**（sha256），不一致即红并点名包；抓不到即"无法判定"（离线／尚未上架），**不得计入通过**。步骤见 `.github/workflows/release.yml` 的 post-publish 步骤（本文不复述脚本文件名与用法，避免出现"点了名却没有执行点"的陈述）。
- 为什么不在 pre-tag：那一刻"registry 上是什么"**原则上不可判定**，塞进去只会再产生一次"无法判定被写成通过"。
