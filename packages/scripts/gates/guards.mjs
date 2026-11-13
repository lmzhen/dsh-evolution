/**
 * Static and local guards: the tree-reading checks, toolchains, machine-local rows and the named specials. No build, no pack.
 *
 * Data only: ids are FROZEN (see W10 §16.3) — never renumber, never derive from position.
 * `title` is the human Command column text; `argv` is the executable form (null = registered cannot-decide).
 */
import { gate } from './model.mjs'

export const guards = [
  gate("gate-01", {
    kind: "script",
    tree: "overlay",
    title: "`node packages/evolution/scripts/verify-family-types.mjs`",
    argv: ["node","packages/evolution/scripts/verify-family-types.mjs"],
    lanes: ["local"],
    registration: {"reason":"the bed platform tree fails its own tsc -b (cordis 4.0.5 vs the checked-in platform sources), so this row cannot judge the family here","owner":"scripts/gates","expiry":"0.47.0","plan":"run on the build line whose platform tree typechecks; the family half is covered by tsc -p per package","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row judges the build line/CI tree (platform typecheck, full suite, built entries, coverage records, health corpora) and the local overlay cannot supply those inputs; the CI action executes the same check. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-02", {
    kind: "toolchain",
    tree: "overlay",
    title: "`node node_modules/oxlint/bin/oxlint -c packages/evolution/oxlint.release.json packages/evolution --ignore-pattern '**/tests/**' --ignore-pattern '**/vendor/**' --ignore-pattern '**/scripts/**' -A style`",
    argv: ["node","node_modules/oxlint/bin/oxlint","-c","packages/evolution/oxlint.release.json","packages/evolution","--ignore-pattern","**/tests/**","--ignore-pattern","**/vendor/**","--ignore-pattern","**/scripts/**","-A","style"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-05", {
    kind: "script",
    tree: "overlay",
    title: "`node packages/evolution/scripts/smoke-built-entries.mjs packages/evolution`",
    argv: ["node","packages/evolution/scripts/smoke-built-entries.mjs","packages/evolution"],
    lanes: ["local"],
    registration: {"reason":"smoke-built-entries needs built lib artifacts that a source checkout does not carry","owner":"scripts/gates","expiry":"0.47.0","plan":"run after build-lib on the build line","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row judges the build line/CI tree (platform typecheck, full suite, built entries, coverage records, health corpora) and the local overlay cannot supply those inputs; the CI action executes the same check. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-06", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-dependency-closure.mjs packages --strict`",
    argv: ["node","packages/scripts/verify-dependency-closure.mjs","packages","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-07", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-arch-guards.mjs packages --strict`",
    argv: ["node","packages/scripts/verify-arch-guards.mjs","packages","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-08", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-event-pairing.mjs packages --strict`",
    argv: ["node","packages/scripts/verify-event-pairing.mjs","packages","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-09", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-declared-config.mjs packages --strict`",
    argv: ["node","packages/scripts/verify-declared-config.mjs","packages","--strict"],
    // CI runs in the FAMILY checkout with the platform checked out at ./upstream
    ci: { argv: ["node","packages/scripts/verify-declared-config.mjs","packages","--strict","--upstream","upstream"] },
    lanes: ["local","ci-static"],
  }),

  gate("gate-10", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-param-registry.mjs packages --strict`",
    argv: ["node","packages/scripts/verify-param-registry.mjs","packages","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-11", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-bundle-rows.mjs packages --strict`",
    argv: ["node","packages/scripts/verify-bundle-rows.mjs","packages","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-12", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-param-channel-parity.mjs packages --strict`",
    argv: ["node","packages/scripts/verify-param-channel-parity.mjs","packages","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-13", {
    kind: "external",
    tree: "machine-local",
    title: "`node D:/dsh/audit-v37/check-tsconfigs.cjs`",
    argv: ["node","D:/dsh/audit-v37/check-tsconfigs.cjs"],
    lanes: ["machine-local"],
    reason: "tsconfig registration for the overlay layout",
    owner: "toolchain",
  }),

  gate("gate-14", {
    kind: "external",
    tree: "machine-local",
    title: "`node D:/dsh/audit-v37/check-manifests.cjs`",
    argv: ["node","D:/dsh/audit-v37/check-manifests.cjs"],
    lanes: ["machine-local"],
    reason: "manifest version uniformity across the two trees",
    owner: "toolchain",
  }),

  gate("gate-15", {
    kind: "external",
    tree: "machine-local",
    title: "`node D:/dsh/audit-v37/mirror-sync.mjs check`",
    argv: ["node","D:/dsh/audit-v37/mirror-sync.mjs","check"],
    lanes: ["machine-local"],
    reason: "mirror <-> overlay parity check",
    owner: "toolchain",
  }),

  gate("gate-17", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-doc-facts.mjs packages --strict --require-repo-docs`",
    argv: ["node","packages/scripts/verify-doc-facts.mjs","packages","--strict","--require-repo-docs"],
    // The overlay carries the family docs but the platform repo docs are not ours: CI omits the flag.
    ci: { argv: ["node","packages/scripts/verify-doc-facts.mjs","packages","--strict"] },
    lanes: ["local","ci-static"],
  }),

  gate("gate-18", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-platform-contract.mjs packages --upstream D:/dsh/_upstream/dsh-upstream-0.2.2-rc.1 --accept-recorded`",
    argv: ["node","packages/scripts/verify-platform-contract.mjs","packages","--upstream","D:/dsh/_upstream/dsh-upstream-0.2.2-rc.1","--accept-recorded"],
    // CI runs the action's overlay form: the platform citations are overlay-relative, so the guard
    // must see the overlay tree (strict mode, no --accept-recorded).
    ci: { cwd: "upstream", argv: ["node","packages/evolution/scripts/verify-platform-contract.mjs","packages/evolution","--upstream","."] },
    lanes: ["local","ci-static"],
  }),

  gate("gate-19", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-package-discovery.mjs packages --strict`",
    argv: ["node","packages/scripts/verify-package-discovery.mjs","packages","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-20", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-family-tool-names.mjs packages --strict`",
    argv: ["node","packages/scripts/verify-family-tool-names.mjs","packages","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-21", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-skill-roots.mjs packages --strict`",
    argv: ["node","packages/scripts/verify-skill-roots.mjs","packages","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-22", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-gate-manifest.mjs packages`",
    argv: ["node","packages/scripts/verify-gate-manifest.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-23", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-line-identity.mjs --policy-only --strict`（CI 形态；**带 `--manifest <path>` 的形态在拥有测试床的机器上跑**，换错线时第一条错误为 `platform line mismatch`）",
    argv: ["node","packages/scripts/verify-line-identity.mjs","--policy-only","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-24", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-arming.mjs --packages packages --strict`（第二个元门禁：每条规则的扫描族在真实树必须 >0；接线类由 doc-facts 拥有）",
    argv: ["node","packages/scripts/verify-arming.mjs","--packages","packages","--strict"],
    lanes: ["local","ci-static"],
    drillCmd: "node packages/scripts/verify-arming.mjs --drill",
  }),

  gate("gate-25", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-client-seats.mjs packages --strict`（客户端半的座位读取与平台席位一致性）",
    argv: ["node","packages/scripts/verify-client-seats.mjs","packages","--strict"],
    // CI checks the seats against the platform checkout at ./upstream.
    ci: { argv: ["node","packages/scripts/verify-client-seats.mjs","packages","--strict","--upstream","upstream"] },
    lanes: ["local","ci-static"],
  }),

  gate("gate-26", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-client-tokens.mjs packages --strict`（客户端 token 使用）",
    argv: ["node","packages/scripts/verify-client-tokens.mjs","packages","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-28", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-release-artifacts.mjs .github --strict`（发布面产物：CI 工作流与发布脚本的一致性）",
    argv: ["node","packages/scripts/verify-release-artifacts.mjs",".github","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-29", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-write-inventory.mjs packages --strict --home <plane home>`（写清单落地：**CI 形态**用 `$RUNNER_TEMP/plane-home`）",
    argv: ["node","packages/scripts/verify-write-inventory.mjs","packages","--strict","--home","<plane","home>"],
    // CI uses a synthetic plane home (the action's --home "$RUNNER_TEMP/plane-home").
    ci: { argv: ["node","packages/scripts/verify-write-inventory.mjs","packages","--strict","--home","${RUNNER_TEMP}/plane-home"] },
    lanes: ["local","ci-static"],
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row judges the build line/CI tree (platform typecheck, full suite, built entries, coverage records, health corpora) and the local overlay cannot supply those inputs; the CI action executes the same check. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-30", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-client-ui-i18n.mjs packages`（U-8/G5.9：客户端半的可见文案必须走字典——① 不许把裸字符串当子节点（任何实参位）；② 不许在字符串里写跨面指令 `dsh web`／`/evolution …`；注释先行剥离且**保留行号**。drill：注入一个第 4 实参裸串＋一个跨面串 ⇒ 必红，撤回即绿 ✓）",
    argv: ["node","packages/scripts/verify-client-ui-i18n.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-31", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-error-codes.mjs packages`（G4.3/C5：错误码表与文档必须**同集**——源码新增码未入档、或文档留着一个已删除的码，都必红；并校验文档里的**区间**与表实际一致。drill：给源码塞一个 E-322 ⇒ 必红；删掉一行文档码 ⇒ 必红；撤回即绿 ✓）",
    argv: ["node","packages/scripts/verify-error-codes.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-32", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/gen-install-counts.mjs . --check`（G4.1/C5：README 的\"装了几个包／发布了几个\"必须由 `lib-family-packages.mjs` 派生——**本批纠出的真实漂移：原文写 29/30，树里是 31/32** ✓。drill：手改标记区内任一数字 ⇒ 必红，重跑生成器即还原 ✓）",
    argv: ["node","packages/scripts/gen-install-counts.mjs",".","--check"],
    lanes: ["local"],
  }),

  gate("gate-33", {
    kind: "script",
    tree: "mirror",
    title: "生成物 `--check`（六件一起，CI 同款）：`node packages/scripts/gen-bundle-patches.mjs packages --check` ＋ `gen-client-tokens.mjs packages --check` ＋ `gen-param-client-view.mjs packages --check` ＋ `gen-param-docs.mjs packages --check` ＋ `gen-client-guards.mjs packages --check` ＋ `gen-about.mjs packages --check`（G5.10/U-10：版本与用途的生成物 ✓）（G4.1/C5：生成物与源不同步即红——四个生成器**都已支持 `--check`**，缺的只是\"有人跑\"。drill：给 PARAMETERS.md 动一个字符 ⇒ `gen-param-docs --check` 必红，撤回即绿 ✓）",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "composite-cell: 6 commands in one table row",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row judges the build line/CI tree (platform typecheck, full suite, built entries, coverage records, health corpora) and the local overlay cannot supply those inputs; the CI action executes the same check. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-34", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-package-map.mjs packages`（G4.1/C5 roster：`packages/README.md` 的 Package map 必须**恰好**列出树里全部可发布包——新增包没入图、或图里留着一个已不存在的包，都必红。drill：把状态行里的 `evolution-state-json` 去掉 ⇒ 必红并点名；撤回即绿 ✓）",
    argv: ["node","packages/scripts/verify-package-map.mjs","packages"],
    // CI runs it inside the overlay tree (the action's form): the family checkout's root also holds
    // `upstream/`, which is not a declared package root, and a root scan must not judge it.
    ci: { cwd: "upstream", argv: ["node","packages/evolution/scripts/verify-package-map.mjs","packages/evolution"] },
    lanes: ["local","ci-static"],
  }),

  gate("gate-35", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-composer-single-source.mjs packages`（G2-S2：preset 组合器**只有一个实现**——core `composition/composer.ts`；安装器 import 构建产物 `evolution-core/lib/composition/index.js`。安装器侧生成双胞胎、其生成器与本地注入逻辑均已退场；任何一件回来即红 ✓）",
    argv: ["node","packages/scripts/verify-composer-single-source.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-36", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-lock-usage.mjs packages`（G6-②：**写 profile patch 的源文件必须调用平台的 HMR 锁** `runExclusive`，且必须保留平台自己的降级形状 `hmr === undefined ? 直接调用 : 加锁`；独立 CLI 的安装器无 ctx 不在范围内 ✓。drill：① 把 `runExclusive` 改名 ⇒ 必红（\"without calling the platform HMR lock\"）；② 保留锁但删掉降级分支 ⇒ 必红；撤回即绿 ✓。**注**：初版探针只看\"字符串出现\"⇒ 注释里的 `hmr.runExclusive(apply)` 就让 drill 空过 ✗ ⇒ 已改为**剥注释后按调用形态匹配** ✓）",
    argv: ["node","packages/scripts/verify-lock-usage.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-37", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-source-text-single-source.mjs packages`（G7-3 份数=1：**全家族只许有一份注释剥离实现**（家＝`scripts/lib-source-text.mjs` ✓），任何探针再自带一份（按名字即红；另有一条只覆盖特定拼法的正则网，其覆盖边界见 G0-0.3 记录）即红 ✓；判据实测从 **7 文件 → 1** ✓。drill：往 `verify-package-map.mjs` 塞一个 `withoutComments` ⇒ 必红并点名；撤回即绿 ✓）",
    argv: ["node","packages/scripts/verify-source-text-single-source.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-38", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-atomic-write-single-source.mjs packages`（G7-3 份数=1：**全家族只有一个原子写实现**，家在 `evolution-core/src/io.ts`（接缝）✓；判据＝\"同时出现 `renameSync(` 与 `.tmp` 暂存名\"的文件只许是家 ✓，且**先剥注释**（注释里的名字不算 ✓）。drill：① 往 `evolution-state-json/src/index.ts` 塞一段真代码提交序列 ⇒ 必红并点名 ✓；② 同样名字只写在**注释**里 ⇒ **绿** ✓（＝\"剥注释\"这条的活体证明 ✓）；③ 撤回即绿 ✓）",
    argv: ["node","packages/scripts/verify-atomic-write-single-source.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-39", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-predicate-single-source.mjs packages`（G7.1/A8 份数=1：**对象谓词只有一个作者**（家在 `evolution-core/src/guards.ts` ✓）；宿主侧一律 import ✓，client 半（不能 import core ✓）用**生成副本**（文件头标 GENERATED ＋ 指名家 ✓）。判据＝剥注释后按\"含 typeof … === 'object' 且 !Array.isArray(\"的形态匹配 ✓；drill：① 任一宿主文件内联一份 ⇒ 必红并点名 ✓（本轮它当场抓出我漏掉的 `state-json` 一处 ✓）；② 手改生成副本 ⇒ `gen-client-guards --check` 必红 ✓；撤回即绿 ✓）",
    argv: ["node","packages/scripts/verify-predicate-single-source.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-40", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-readonly-single-criterion.mjs packages`（G7.2/F-2 单判据：**只读动作集合只有一个判据** `READ_ONLY_ACTIONS`／`isReadOnlyAction`（四处用途各自保留调用点 ✓，但判据只有一处 ✓）；判据脚本＝\"某处定义了它\" ＋ \"**没有任何文件再内联** `!== 'list' && … !== 'unpin'` 串\" ✓（剥注释 ✓＋豁免自身 ✓）。drill：把那四处之一改回内联 ⇒ 必红并点名；撤回即绿 ✓）",
    argv: ["node","packages/scripts/verify-readonly-single-criterion.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-41", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-command-table.mjs packages`（G7.4/C7：**命令表与派发必须一致**——A 每条表项带 C7 形状（usage＋summary＋readonly）；B usage 首词＝表名、flag 写法可读（usage 是**文档**不是命令行）；C 双向：派发答的每个名字都要有表项（缺表项不得上线），表里每个名字源码都要答；输出含仍在用自有正则派发的分支数＝迁移进度。drill：加一条名字未登记的派发 ⇒ 必红并点名；撤回即绿）",
    argv: ["node","packages/scripts/verify-command-table.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-42", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-bounds.mjs packages`（G2.4/C3：**一个锁、一个上界**——A 凡出现 instance-idiom（instanceHome／holdsInstance／claimInstance／single-flight）又自造模块级守卫且**不**消费 claimInstance ⇒ 必红；B 计时调用（setTimeout／setInterval／AbortSignal.timeout／sleep）里出现**裸毫秒字面量** ⇒ 必红，超时常量**跨包重值**只报告。drill：注入自造锁 ⇒ 点名；注入 `setTimeout(f, 5000)` ⇒ 点名；撤回即绿）",
    argv: ["node","packages/scripts/verify-bounds.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-43", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-io-discipline.mjs packages`（G2.2/C4：**写门面是通往磁盘的唯一一道门**——域内 src 不得裸调 rmSync／unlinkSync／renameSync／copyFileSync／writeFileSync／mkdirSync 或裸异步 rm(／unlink(／rename(／copyFile(；**方法调用**（io().rename(、this.io.remove(）放行；介质＝evolution-core/src/io.ts ＋ evolution-io-node 的 src。drill：往域内注入一个 rmSync ⇒ 点名必红；撤回即绿）",
    argv: ["node","packages/scripts/verify-io-discipline.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-44", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-declarations.mjs packages`（G4/C5+C6：**声明了就必被渲染，例外必须显式**——A 生成视图里每个字段的 control 必须在 ParamCard.ts 有渲染分支；B **双向**对账 C6 表 `scripts/client-exceptions.json`（`{fieldId, reason, owner}`）：无平台件的 switch/select 字段**必须**在表里（缺 ⇒ 必红），表里**不得有**生成视图已不带的陈旧条目（有 ⇒ 必红）；C reason／owner 非空、id 唯一。drill：删一条例外 ⇒ 点名必红；加一条陈旧条目 ⇒ 必红）",
    argv: ["node","packages/scripts/verify-declarations.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-45", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-graph-edges.mjs --self-test`（P0′ 读路径：技能\"参见边\"的解析与悬空检查门禁 —— 自证形进 CI；活根形 `--report` 只留 local/pre-tag，CI 无技能根会 exit 2。三态：0=边>0且悬空=0／1=悬空·自指·形态非法／2=CANNOT DECIDE；无降级读器，运行时读器不可用即 exit 2 且不给数字）",
    argv: ["node","packages/scripts/verify-graph-edges.mjs","--self-test"],
    lanes: ["local","ci-static"],
    drillCmd: "node packages/scripts/verify-graph-edges.mjs --self-test",
  }),

  gate("gate-46", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/gen-check-taxonomy.mjs packages --check`（G2/M1 视图：把「门禁 × 档位 × spec」的普查视图从**声明面生成**出来（`--report` 人读、`--json` 机读）；`--check` 判生成物与声明面一致。**空档位必须 exit 2**——一个跑不到任何 spec 的档不是\"干净\"，是真空）",
    argv: ["node","packages/scripts/gen-check-taxonomy.mjs","packages","--check"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-47", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-verdict-records.mjs packages`（G1/C7 判决记录：夹具四例＋健康对照——输入置空时每条 check 必须 `cannot-decide` 且 `missing≠∅` 且 **exit 2**；判决与理由必须同源，读数只计 `criterionEvaluated===true ∧ verdict==='fail'` 并按 `cause.kind` 分列）",
    argv: ["node","packages/scripts/verify-verdict-records.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-50", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/gen-health-baseline.mjs packages --check`（G4/① 生产者：健康基线语料的**唯一作者**；消费侧缺产物一律 cannot-decide，不许绿色兜底）",
    argv: ["node","packages/scripts/gen-health-baseline.mjs","packages","--check"],
    lanes: ["local"],
  }),

  gate("gate-51", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/gen-line-manifest.mjs --check`（G0/0.7 复核：床清单必须与树一致 —— 生成物陈旧即红。这条是「退役包不得残留在在册交付件里」的守卫：io-fs 于 2b.2 退役后曾长期残留在 line-manifest.json 里，而当时没有任何档位以 --check 调用生成器。CI 形态是**三段**：`gen-line-manifest`（无条件重生成）→ `test -z \"$(git status --porcelain -- packages/scripts/files/line-manifest.json)\"`（入库副本必须与树一致；用 porcelain 而非 diff，因为未跟踪文件对 diff 不可见，而「根本没入库」正是这条门禁要抓的形态之一）→ `--check`。**产物格式**：`{ pin, bed: { mono }, entries: [{ id, kind, relPath }] }` —— entries 由**仓内名册**派生（`relPath` 相对 overlay 根），不含任何宿主绝对路径；`pin` 取 `git -C <root> rev-parse --short HEAD`，**不参与**逐字比对（身份是 id+kind，pin 随提交前进），`--check` 只断言它非 `unknown`，缺 pin ⇒ exit 2）",
    argv: ["node","packages/scripts/gen-line-manifest.mjs","--check"],
    lanes: ["local"],
  }),

  gate("gate-52", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-subagent-single-source.mjs packages`（G3-S6 架构守卫：家族只有**一条**子代理执行路径——业务源码不得再出现 `subagents.start(spawn)`／`withSettleWatchdog`／`.localAgent`／`toolFilter:`／`persona:`／`MaintainSubagent*`，`startActivation` 只允许在 `evolution-core/src/subagent/channel.ts`；测试夹具的 legacy 适配器不在扫描范围）",
    argv: ["node","packages/scripts/verify-subagent-single-source.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-53", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-host-routes.mjs packages`（G4/W6 宿主数据面守卫：`HOST_ROUTES` 是 `/api/dsh-evolution/**` 路径的唯一家（4 surface/12 endpoint）；业务 `src` 不得出现 loopback fence／`webServer.register`／手抄路由 path；三包 must import `HOST_ROUTES`；G5 生成器落地后移除 client 豁免。**空扫描 exit 2**）",
    argv: ["node","packages/scripts/verify-host-routes.mjs","packages"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-54", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/gen-client-seam.mjs packages --check`（G5/W7 客户端生成物：`routes/route-client/contracts/fallbacks/states.generated.ts` 共 15 个生成物由 core `HOST_ROUTES`/`COMMAND_FALLBACKS`/`diagnostics.ts` 与 5 个模板渲染到 3 个 UI 包；`--check` 断言入库生成物=生成器输出（陈旧即红）；**生成器优先读构建后 core lib（R13），mirror 无 lib 时按约束静态读 HOST_ROUTES 字面量；找不到 HOST_ROUTES ⇒ exit 2**）",
    argv: ["node","packages/scripts/gen-client-seam.mjs","packages","--check"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-55", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-traceability.mjs packages --strict`（G7/W11 追账：52 项 universe（A-22/B-18/C-12）必须逐条覆盖；缺行/重复/未知 id/乱序/adopted 缺落点证据/deferred 无 trigger→**exit 1**，空矩阵→**exit 2**；`--planned` 只校验 schema/覆盖/顺序（探针注册归 W9，strict 模式另查 files/probes/gates 存在与预算实测））",
    argv: ["node","packages/scripts/verify-traceability.mjs","packages","--strict"],
    lanes: ["local","ci-static"],
  }),

  gate("gate-58", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/evolution-merge-engine/verify-upstream.mjs`（engine 发布 parity：UPSTREAM.json 的逐文件 bytes/sha256 与 testPatchSet 的 patchedBytes/patchedSha256 必须全等；缺文件/不匹配→exit 1。GAP-P0-05 的发布门禁）",
    argv: ["node","packages/evolution-merge-engine/verify-upstream.mjs"],
    lanes: ["local"],
  }),

  gate("gate-60", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-about.mjs packages/evolution --check",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-61", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-bundle-patches.mjs packages/evolution --check",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-62", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-client-guards.mjs packages/evolution --check",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-63", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-client-tokens.mjs packages/evolution --check",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-64", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-param-client-view.mjs packages/evolution --check",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-65", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-param-docs.mjs packages/evolution --check",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-66", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-requirements.mjs packages/evolution --check",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-72", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/requirements.selftest.mjs",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-75", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-layout-sync.mjs packages/evolution/scripts ../packages/scripts",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    localSafe: false,
    localSafeReason: "CI workspace-relative path — not resolvable on a dev machine",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-76", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-probes.mjs packages/evolution",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-77", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-requirements.mjs packages/evolution",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-78", {
    kind: "script",
    tree: "mirror",
    title: "node packages/scripts/verify-line-identity.mjs --policy-only --strict",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-79", {
    kind: "script",
    tree: "mirror",
    title: "node packages/scripts/verify-line-identity.mjs --manifest packages/scripts/files/line-manifest.json --strict",
    argv: null,
    lanes: ["local","ci-static"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-80", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-graph-edges.mjs --report",
    argv: null,
    lanes: ["local"],
    argvProblem: "no-command-in-cell",
    drillCmd: "node packages/scripts/verify-graph-edges.mjs --self-test",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-81", {
    kind: "script",
    tree: "mirror",
    title: "node packages/scripts/verify-health-admission.mjs",
    argv: null,
    lanes: ["local"],
    argvProblem: "no-command-in-cell",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-82", {
    kind: "script",
    tree: "mirror",
    title: "`node packages/scripts/verify-i18n.mjs`（B6：4 个 UI namespace、529 个 key、113 个参数文案、31 个 host error，8 语言 key/占位符/生成物一致；`gen-i18n`/`gen-param-i18n`/`gen-host-errors` 的 stale 输出必红。drill：删一个 UI key ⇒ 必红；改一个占位符 ⇒ 必红；重跑生成器即绿）",
    argv: ["node","packages/scripts/verify-i18n.mjs"],
    lanes: ["local","ci-static"],
  }),

  gate("ci-only-02", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-about.mjs packages/evolution --check",
    argv: ["node","packages/evolution/scripts/gen-about.mjs","packages/evolution","--check"],
    lanes: ["ci-static"],
    reason: "repo-root about manifest; the overlay carries no repository package.json above it (the action itself reports 'not armed')",
    owner: "ci",
  }),

  gate("ci-only-03", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-bundle-patches.mjs packages/evolution --check",
    argv: ["node","packages/evolution/scripts/gen-bundle-patches.mjs","packages/evolution","--check"],
    lanes: ["ci-static"],
    reason: "generated bundle-patch freshness --check (generator writes in the mirror; CI verifies the committed copy)",
    owner: "ci",
  }),

  gate("ci-only-04", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-client-guards.mjs packages/evolution --check",
    argv: ["node","packages/evolution/scripts/gen-client-guards.mjs","packages/evolution","--check"],
    lanes: ["ci-static"],
    reason: "generated client-guard copy freshness --check (generator writes in the mirror; CI verifies the committed copy)",
    owner: "ci",
  }),

  gate("ci-only-05", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-client-tokens.mjs packages/evolution --check",
    argv: ["node","packages/evolution/scripts/gen-client-tokens.mjs","packages/evolution","--check"],
    lanes: ["ci-static"],
    reason: "generated client-token copy freshness --check (generator writes in the mirror; CI verifies the committed copy)",
    owner: "ci",
  }),

  gate("ci-only-06", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-param-client-view.mjs packages/evolution --check",
    argv: ["node","packages/evolution/scripts/gen-param-client-view.mjs","packages/evolution","--check"],
    lanes: ["ci-static"],
    reason: "generated param client-view freshness --check (generator writes in the mirror; CI verifies the committed copy)",
    owner: "ci",
  }),

  gate("ci-only-07", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-param-docs.mjs packages/evolution --check",
    argv: ["node","packages/evolution/scripts/gen-param-docs.mjs","packages/evolution","--check"],
    lanes: ["ci-static"],
    reason: "generated param docs freshness --check (generator writes in the mirror; CI verifies the committed copy)",
    owner: "ci",
  }),

  gate("ci-only-08", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-protection-view.mjs --check",
    argv: ["node","packages/evolution/scripts/gen-protection-view.mjs","--check"],
    lanes: ["ci-static"],
    reason: "CI-only gate with no table row yet — local slot pending (G0-1)",
    expiry: "0.47.0",

    renewal: "Renewed at 0.46.0 (expiry 0.47.0). Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the local-slot/table split that closes these rows is tracked in W9-gates §4, before 0.47.",
  }),

  gate("ci-only-09", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/gen-requirements.mjs packages/evolution --check",
    argv: ["node","packages/evolution/scripts/gen-requirements.mjs","packages/evolution","--check"],
    lanes: ["ci-static"],
    reason: "generated requirements view freshness --check (the CI job owns the non-strict gate view)",
    owner: "ci",
  }),

  gate("ci-only-19", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-contract-anchors.selftest.mjs",
    argv: ["node","packages/evolution/scripts/verify-contract-anchors.selftest.mjs"],
    lanes: ["ci-static"],
    reason: "CI-only gate with no table row yet — local slot pending (G0-1)",
    expiry: "0.47.0",

    renewal: "Renewed at 0.46.0 (expiry 0.47.0). Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the local-slot/table split that closes these rows is tracked in W9-gates §4, before 0.47.",
  }),

  gate("ci-only-20", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-core-surface.mjs packages/evolution",
    argv: ["node","packages/evolution/scripts/verify-core-surface.mjs","packages/evolution"],
    lanes: ["ci-static"],
    reason: "CI-only gate with no table row yet — local slot pending (G0-1)",
    expiry: "0.47.0",

    renewal: "Renewed at 0.46.0 (expiry 0.47.0). Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the local-slot/table split that closes these rows is tracked in W9-gates §4, before 0.47.",
  }),

  gate("ci-only-21", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-exemptions.mjs packages/evolution",
    argv: ["node","packages/evolution/scripts/verify-exemptions.mjs","packages/evolution"],
    lanes: ["ci-static"],
    reason: "CI-only gate with no table row yet — local slot pending (G0-1)",
    expiry: "0.47.0",

    renewal: "Renewed at 0.46.0 (expiry 0.47.0). Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the local-slot/table split that closes these rows is tracked in W9-gates §4, before 0.47.",
  }),

  gate("ci-only-22", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-layout-sync.mjs packages/evolution/scripts ../packages/scripts",
    argv: ["node","packages/evolution/scripts/verify-layout-sync.mjs","packages/evolution/scripts","../packages/scripts"],
    lanes: ["ci-static"],
    reason: "mirror↔overlay script/version parity; needs the mirror checkout beside the overlay",
    owner: "ci",
    localSafe: false,
    localSafeReason: "CI workspace-relative path — not resolvable on a dev machine",
  }),

  gate("ci-only-23", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-param-consumers.mjs packages/evolution",
    argv: ["node","packages/evolution/scripts/verify-param-consumers.mjs","packages/evolution"],
    lanes: ["ci-static"],
    reason: "CI-only gate with no table row yet — local slot pending (G0-1)",
    expiry: "0.47.0",

    renewal: "Renewed at 0.46.0 (expiry 0.47.0). Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the local-slot/table split that closes these rows is tracked in W9-gates §4, before 0.47.",
  }),

  gate("ci-only-24", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-probes.mjs packages/evolution",
    argv: ["node","packages/evolution/scripts/verify-probes.mjs","packages/evolution"],
    lanes: ["ci-static"],
    reason: "probe registry schema lint; the CI job executes it, the mirror local lane has no platform overlay",
    owner: "ci",
  }),

  gate("ci-only-25", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-requirements.mjs packages/evolution",
    argv: ["node","packages/evolution/scripts/verify-requirements.mjs","packages/evolution"],
    lanes: ["ci-static"],
    reason: "requirements matrix coverage; the CI job executes it after gen-requirements",
    owner: "ci",
  }),

  gate("ci-only-26", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-test-lines.mjs packages/evolution --strict",
    argv: ["node","packages/evolution/scripts/verify-test-lines.mjs","packages/evolution","--strict"],
    lanes: ["ci-static"],
    reason: "CI-only gate with no table row yet — local slot pending (G0-1)",
    expiry: "0.47.0",

    renewal: "Renewed at 0.46.0 (expiry 0.47.0). Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the local-slot/table split that closes these rows is tracked in W9-gates §4, before 0.47.",
  }),

  gate("line-identity-ci", {
    kind: "script",
    tree: "mirror",
    title: "node packages/scripts/verify-line-identity.mjs --policy-only --strict",
    argv: ["node","packages/scripts/verify-line-identity.mjs","--policy-only","--strict"],
    lanes: ["ci-static"],
    reason: "CI has no machine bed — policy half only (contract §5e)",
  }),

  gate("line-identity-bed", {
    kind: "script",
    tree: "mirror",
    title: "node packages/scripts/verify-line-identity.mjs --manifest packages/scripts/files/line-manifest.json --strict",
    argv: ["node","packages/scripts/verify-line-identity.mjs","--manifest","packages/scripts/files/line-manifest.json","--strict"],
    lanes: ["local","pre-tag"],
    reason: "toothed form: compares the bed manifest produced by gen-line-manifest.mjs",
  }),

  gate("graph-edges-live", {
    kind: "script",
    tree: "overlay",
    title: "node packages/evolution/scripts/verify-graph-edges.mjs --report",
    argv: ["node","packages/evolution/scripts/verify-graph-edges.mjs","--report"],
    lanes: ["local","pre-tag"],
    reason: "live-root form: needs a resolvable dependency tree and skill roots; the bare mirror is expected to exit 2 with reason=reader-unavailable (R99/R145)",
    owner: "toolchain",
    noDrillReason: "live-root form: it reads the user skill roots; a drill needs a repo-internal fixture root (--roots), which does not exist yet — the self-test form (gate-46) is the falsifiable half",
  }),

  gate("health-admission", {
    kind: "script",
    tree: "mirror",
    title: "node packages/scripts/verify-health-admission.mjs",
    argv: ["node","packages/scripts/verify-health-admission.mjs"],
    lanes: ["local","pre-tag"],
    reason: "needs both local corpora; on a machine without them it must report CANNOT DECIDE rather than pass",
    registration: {"reason":"no user or platform corpora on this machine, so admission cannot be judged","owner":"scripts/gates","expiry":"0.47.0","plan":"run where the corpora exist (CI or a real profile)","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row judges the build line/CI tree (platform typecheck, full suite, built entries, coverage records, health corpora) and the local overlay cannot supply those inputs; the CI action executes the same check. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),
]
