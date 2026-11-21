# 06 架构审计（只读；HEAD `564431ac`）

审计对象：`D:\dsh\dsh-evolution-mirror`。范围：全仓架构、包边界、依赖、生成物、门禁；不深挖单条并发实现（属 01/03/04 审计员）。
证据标签：**实测**＝本机跑过并有输出；**代码**＝`file:line` 的机制；**推断**＝附判定法。

## 0 结论

1. **P0=0，P1=2，P2/债=14。** 没有正常路径可复现的数据丢失/覆盖/崩溃；真正严重的是**验证结论与被判对象脱钩**（P1-1、P1-2），它让「本地绿」不能推出「镜像绿」。
2. 结构上只有三个真问题：①镜像仓的本地验证有一半落在别的树（P1-1）；②四类架构检查没有执行体或没有判别力（P1-2）；③`evolution-core`+`evolution-merge` 占 48% 源码，`SkillLibrary` 单类 4145 行（D1/D2）。
3. 干净的三处（实测，见 §5）：包级 import 图**无环**（0 cycle）；持久写只有一套 IO seam 与一份 34 条写点台账；`platform-contract` 确为纯类型层（adapter 外包 0 处平台 value import）。
4. 量化基线：23 个物理包；src TS 79,541 行 / tests 60,376 行 / `packages/scripts` 133 个 mjs 23,707 行；92 条 gate 行；42 条 arch 规则；`run-gates local` 62 条记录（pass 57 / cannotDecide 4 / skipped 1，exit 0，整轮约 4 分钟）。

## 1 口径

- **P0**：正常路径可复现的静默数据丢失/覆盖、与文档开关相反的行为、崩溃/边界击穿。
- **P1**：需前置条件但产生不一致/确定性功能失败/不可逆副作用；含**门禁判错对象**（比 P0 更隐蔽：它让上述问题不被发现）。
- **P2**：死代码、一责多主、未覆盖关键路径、持续渗漏、结构性技术债。
- **不报**：风格/命名、单测缺失本身、依赖环境问题；包内并发实现（其他审计员）。

## 2 P0（0 条）

无可复现的 P0。门禁错误都在「验证层」：镜像本身的行为正确性由 CI 从 overlay 副本判定，本地错判不直接改数据。**不为凑数把 P1 抬成 P0。**

## 3 P1（2 条）

### P1-1 `run-gates local` 的 14/62 条记录在另一棵树（`D:\dsh\harness-0.2.1`）判定，12 条 pass
- **机制（代码）**：`run-gates.mjs:53` 本地 `overlayRoot = softOverlay()`；`lib-env.mjs:36-44` 候选顺序 env → 同盘 `harness-0.2.1` → `deepseek-harness` → 包父目录，`isPlatformTree()` 只查 `packages/boot/app-boot` 与 `node_modules/vitest`，**不校验版本/身份**；`run-gates.mjs:174-188` 只对 `tree==='mirror'` 做布局 token 翻译，`tree==='overlay'` 行直接用 `cwd=overlayRoot` 拼路径。本机 `harness-0.2.1` 是 0.30 时代的旧树（其下 `packages/evolution` 最后修改 2026-11-19，含 `evolution-feedback`/`learning-graph` 等已并入镜像的旧包；镜像 0.59.6）。
- **实测**：`node packages/scripts/run-gates.mjs local --json-out …` → `counts pass=57 fail=0 cannotDecide=4 skipped=1`；按记录 `path` 字段分组 **mirror 46 / harness-0.2.1 14 / UNRESOLVED 2**；该树上 12 条 pass = `gate-02`（oxlint，用旧树的 `-c packages/evolution/oxlint.release.json`）、`gate-60..66`（7 个生成器 `--check`）、`gate-72/76/77/80`。`gate-01/05` 因旧树缺脚本才 cannot-decide。
- **影响**：本仓 TS **在本地从未被 lint**；本仓 `generated-about/params/cordis.patch/client-tokens/PARAMETERS.md/REQUIREMENTS.md` **在本地从未被 `--check`**；requirements/probes/graph-edges 结论属于旧树。`local` 绿的语义是「某个平台树绿」，不是「本仓绿」。
- **判定法**：看 gate 记录的 `path`；`node packages/scripts/verify-env.mjs --json` 看 overlay 解析。
- **修向**：解析后校验 overlay 内 `packages/evolution/package.json` 版本==镜像版本（或要求显式 `--overlay` 且记录其标识）；不匹配→整类行 `cannot-decide`，禁止换树判。

### P1-2 四类架构检查名义在册、没有执行体或没有判别力
- **(a) machine-local 三条（gate-13/14/15）**：`gates/guards.mjs:97-138` 的命令是 `node D:/dsh/audit-v37/{check-tsconfigs,check-manifests,mirror-sync}.cjs|mjs`；**实测三个文件都不存在**。它们 `kind=external`，`run-gates.mjs:57` 的 `RUNNABLE` 只含 `script|toolchain`，故**任何 profile 都不会执行**；`family-facts.json` 的 `gate-set.machineLocal` 三条 expiry 是自由文本（`S1.8 follow-up: port into packages/scripts`）；唯一会评估 expiry 的 `lib-exemptions.mjs:19-33` 只被喂 `registration` 字段（`run-gates.mjs:351-353`），machineLocal/localOnly 两个登记表没有评估器。`verify-gate-manifest.mjs:134-160` 只查字段非空与登记成员资格，不查脚本存在。
- **(b) 布局一致性（gate-75 / `verify-layout-sync.mjs`）**：manifest `localSafe=false`（理由 `CI workspace-relative path`）⇒ 本地 skipped（实测记录 `gate-75:skipped`）；CI 里比较的是 action **刚复制出来的两份**脚本（`action.yml:65-116`），其自身 71-78 行注明「此绿不证明 dev↔mirror 同步，权威判定要从真 dev 树跑」——但 `git grep` 只有两个 `action.yml` 调用它，`prepare-release.mjs` 不调用，**不存在所谓权威判定**。该文件 80-109 行同时承载 V9-01 的版本一致性检查，同为免费尾注。
- **影响**：四类事实——tsconfig 注册、双树 manifest 版本一致、镜像↔overlay 一致性、dev↔mirror 布局同步——仓库内没有任何一次真实判定；而 manifest/CHANGELOG 版本漂移正是 V9-01（30 个 manifest 被改错、4 个版本无人发现）的同型事故。
- **修向**：(a) 三条脚本搬回 `packages/scripts` 并升为 `kind=script` 的本地行（或删行+删登记）；(b) 布局同步改为比较**提交内容**（CI 里对 overlay 副本做 `git show HEAD:packages/scripts/…` 哈希比对），本地用镜像自身 + 可选 `--dev-tree`。

## 4 P2 / 技术债 / 屎山

**D1 `evolution-core` 是事实上的上帝包。** 28,044 行 src（全仓 src 35%）、**112 个文件平铺在 `src/`**、21 条 `exports` 条目（16 个代码子路径）、root barrel 70/75 star（`verify-core-surface.mjs` 的预算，实测 `root star exports 70 (<=75)`）、13 个包 import 它。机制：所有跨包共享被吸进 core 的 barrel 与 `/skills` 子路径（core 内部 import 56 次、merge 33、ui 23、curator 20…），组间「契约」实际是 core 的 barrel。**代价**：75 条预算只剩 5 条，任何新增共享面都先塞 core。

**D2 两个巨型类 + 三个千行 `apply` 就是系统主体。** `SkillLibrary` 4,145 行/102 方法（`skill-store.ts:862-5007`）；`EvolutionCurator` 2,350 行/51 方法（`curator/src/index.ts:291-2641`，其中 `runCore` 1,116-1,558＝442 行、`applyMutations` 1,647-1,940＝293 行）。单函数：`tool-skill-manage/src/index.ts:566-1771`＝**1,205 行**；`commands/src/index.ts:301-1382`＝1,081；`review/src/index.ts:347-1305`＝958。全仓（TS AST 实测）≥100 行函数 **83** 个（≥200：38；≥400：7；≥800：5）。这三个 `apply` 把「注册/路由/参数/错误文案/回退」揉在一个函数里，是 D3 规则不断追加的根因。

**D3 arch 规则注册表自相矛盾且无自校验。** `verify-arch-guards.mjs` 2,589 行/42 条 `RULES`；**id `N40` 指三条不同规则**（1031 `withTreeWrite`、1044 focus、docblock 264 `tool-skill-manage` mutator）；docblock 43 行规则（含重复 id）vs 注册表 42 条、顺序也不同；文件头 150/1000 行称「`--list-rules` 打印的注册表与 docblock 必须一致」，但 `--list-rules`（2187）只 `console.log`，**没有比较器，也没有 gate/spec 调用**。注册表**单向校验**（只查 `has(rel)`，不查「登记但文件已删」），实测 5 条死注册：`RAW_WRITE_REGISTER` `evolution-merge/src/domain/state-v3.ts`(340)、`PLATFORM_CITE_BASELINE` `preset-composition.ts`(454)/`tool-dispatch.spec.ts`(459)/`installer-preset-base.spec.ts`(462)、`DEPRECATED_LOG_ACCESSOR_REGISTER` `evolution-skill-discovery/src/adapter.ts`(676)、`MUTABLE_STATE` `preset-composition.ts :: overridesCache`(777，769 行注释自述已被 composer 取代)。`GUARD_VACUITY`/`SKILL_LIBRARY_TODO` 为空是好的（类已关闭），但台账没平。

**D4 门禁系统的体积与元数据。** 92 行 manifest、133 个 mjs（23,707 行）、数据资产 `gate-manifest` 2,067 / `family-facts` 2,075 / `family-test-lines` 1,757 / `bundle-rows` 1,170 / `traceability` 852 行。不可执行行 **7 条 `kind=external`**：13/14/15 脚本不存在，33/56/57/78 自述 retired，`gate-78` 理由直接写「Exact duplicate of gate-23」。4 条 `registration`（gate-01/05/29/81）expiry `0.60.0`，全部在 0.56.0 续期过，当前 0.59.6——**下次发版即到期**。验证/产品比：src 79.5k : tests 60.4k : gate 脚本 23.7k ≈ 1 : 0.76 : 0.30。

**D5 `platform-contract`↔`adapter` 双包镜像，三处手工枚举无门禁。** 两边各 ~20 个同名文件；**19 个 port 名两边都 export**（实测 diff）；`contract/index.ts` 19 条 `export *`、`adapter/ports.ts` 19 条 re-export、`adapter/service.ts` 再列一遍 ⇒ 新增一个 port 要改 4 处；**没有任何 gate 校验三处集合相等**。类型/实现分离本身干净（contract 无平台 value import，实测 0 处），问题只在枚举同步。

**D6 路由表有生成器，payload 形状没有：同一 `PendingRow` 两份手写且已不同。** `approval/src/routes.ts:33` vs `evolution-ui/src/panels/settings/api.ts:13`：服务端 `kind: PendingKind`、`age: ReturnType<typeof elapsedSince>`、`verb/target` 必填；客户端是字面量联合、`age: {unit:string;n:number}`、`verb?/target?` 可选、另有 `operationCount`。`gen-client-seam.mjs:32-34` 只生成 routes/states/contracts/fallbacks（路由表单一来源、有 `--check`），**payload 类型各客户端手写，无 parity gate**。风险：服务端响应改字段，客户端静默读到 `undefined`（当前客户端更宽松，未炸）。

**D7 组间反向依赖（无环，但违「组间只经契约」）。** `merge → commands`：`evolution-merge/src/command-defs.ts:3`、`commands.ts:2` 直接 import `parseCommand`/`buildSurface`（域依赖命令层）。`ui/skill-health → curator`：`evolution-ui/src/panels/history/host.ts:16,39,41,100` 与 `evolution-skill-health/src/index.ts:11,25` 用 `ctx.get('evolutionCurator')` 每请求取域服务，UI 的 host 半边因此要求域行先挂载。

**D8 三个 UI 包三种半边约定。** `evolution-ui` 一个包同时是 host 行（`index.ts`、`panels/history/host.ts`、`routes.ts`、`stats.ts`）与浏览器入口（`src/client/index.ts`），客户端组件散在 `panels/settings/*.ts` 而不在 `client/` 下；`merge-ui`/`skill-health` 则是严格 `src/client` + 薄 host `index.ts`。`build-client.mjs:25-36` 只认 `dsh.client && src/client/index.ts`，新增面板若只被 `apply` 链静态 import 才会进 bundle——放错目录**静默不进构建**，无告警。

**D9 退役包仍在生成/门禁回路。** `lib-family-packages.mjs:48` 把 `evolution-preset` 列为 RETIRED（不发布），但 `bundle-rows.json` 仍有 **4 个形态**（all/host/preset/**standalone**），`standalone` 的 target 正是 `evolution-preset/cordis.yml`（`gen-bundle-patches.mjs:121`），由 gate-61 `--check` 守；同文件 35-39 的 `EVOLUTION_BUNDLE_TAILS` 仍含 `dsh-evolution-preset`，`verify-arch-guards` N6 的 `BUNDLE_PKGS` 仍把它当安装态；其 `package.json` 还直接依赖 `@deepseek-ai/dsh-storage{,-json,-domain}@^0.2.2-rc.5`（semver，非 workspace）。→ 一个不发布的包仍占 1/4 的生成器与门禁面。

**D10 机器绝对路径/外部审计目录。** `gates/guards.mjs:97-138`（`D:/dsh/audit-v37/*`）；`run-gates.mjs:98` 的 `identity.adapterSha` 读 `D:/dsh/_tools/lib-line.mjs`，缺失时静默变 `"absent"`；`line-policy.json` 的 `familyRoots` 写死 3 个本机路径；`verify-graph-edges.mjs:38` 固定期望 `D:/dsh-homes/web/skills`。`lib-env.mjs` 已给出正确的「flag→env→候选」范式，这几处没走。

**D11 死验证器/陈旧基线。** `verify-architecture-baseline.mjs`（126 行）不在 92 行 manifest、无调用者；其 `architecture-baseline.json` 的 spec 路径是 `packages/evolution/...`（镜像不存在），tag `v0.49.0`/commit `aeedc8fe` 与当前 0.59.6 差 10 个版本。`family-test-lines.json` `measuredAt 2026-11-20 / tree 465e420a`，HEAD `564431ac`（两向对账兜住了僵尸登记，但不再描述当前树）。

**D12 测试跨包 reach-in（5 处）。** `evolution-core/tests/unit-backend.spec.ts:8-9` → `../../evolution-merge/src/*`；`evolution-host/tests/s4-hmr-double-apply.spec.ts:12` → `../../evolution-ui/src/panels/history/host.ts`；`evolution-review/tests/review-executor-skill-write.spec.ts:16` → `../../tool-skill-manage/src/index.ts`；`evolution-skill-discovery/tests/main-entry*.spec.ts:9-11` → `../../evolution-core/src/io-registry.ts`。测试绕过包导出与 `.d.ts`，发布入口坏了仍可绿。

**D13 一处未登记的「读失败当缺失」。** `evolution-merge/src/domain/merge-snapshot.ts:77` `live = needsLive ? await options.live!().catch(() => undefined) : undefined`；79-85 行用 `live.managed(row.b)` 决定 b 侧是 live 还是 archive ⇒ 读失败被折成「已归档」，快照**不带 degraded**（对比同文件 60-66：readiness 失败会 blocked/degraded）。同类：`tool-skill-manage/src/index.ts:1574` `.catch(() => [])` 让审批卡版本数变 0。N36/N14 的 `READ_METHOD_RE` 只认方法名，看不见传进来的回调。

**D14 文档/事实漂移。** `docs/developer/architecture.md:1-3` 标题「36 个包」，正文自注物理包 23 个；§1 分层图仍含 `policy/threat/learning-graph/skill-usage/memory-files` 等并包前组名（镜像里是 activity 子路径与 core 文件）；§2 七组表与当前 23 包不一一对应（如 `preset` 已退役、`activity` 四合一）。开发者入口页落后约 10 个版本（0.49.0 → 0.59.6）。

## 5 架构边界表（keep / merge / contain / delete）

| 包 | 组（实际读实现） | 判定 | 备注 |
|---|---|---|---|
| evolution-platform-contract | L0 纯类型（520 行，0 value import） | **keep** | 唯一契约层，干净 |
| evolution-adapter | L0 宿主实现（897 行，唯一 import 平台值） | **keep** | 与 contract 19 文件镜像，需 D5 |
| evolution-core | 能力底座→事实上帝包（28k 行） | **contain+split** | D1/D2，见 §6 M1 |
| evolution-state | 状态消费者+provider seam（1,543 行） | **keep** | 单一介质，读实现见 pin 强制与多 provider 拒绝 |
| evolution-approval | 暂存审批（1,075 行） | **keep** | 与 curator 直写分工已在 docblock 声明 |
| memory | 记忆注册表+provider（1,028 行） | **keep** | |
| tool-skill-manage | 模型写入工具（1,960 行，单 apply 1,205） | **split** | D2 |
| evolution-merge | 合并域（9,816 行）+ 自建命令表 | **split/含 D7** | 依赖 commands 反向 |
| evolution-merge-engine | vendored 引擎（19.9k 行，含 `src/index.bundle.js` 5,819 行；`verify-upstream.mjs` 字节校验） | **contain** | 冻结是显式不变量，keep 但别再长 |
| evolution-commands | 人类命令面（5,490 行，单 apply 1,081） | **split** | D2/D7 |
| evolution-curator | 生命周期域（2,695 行，单类 2,350） | **split** | D2 |
| evolution-review | 后台审查（2,489 行，apply 958） | **split** | D2 |
| evolution-maintenance | 维护扫描（1,619 行） | keep | |
| evolution-activity | 四合一（feedback/learning-graph/replay/threat，2,879 行） | keep | 已合并，边界清楚 |
| evolution-skill-discovery | 目录/检索/用量（3,781 行） | keep | |
| evolution-skill-health / merge-ui | 纯浏览器面板（752/1,513 行） | keep | 半边约定正确 |
| evolution-ui | host+client 混装（7,388 行） | **split** | D8，见 §6 L3 |
| evolution-client-kit | 浏览器 seam+生成物（5,994 行） | keep | 生成物 `--check` 有 gate |
| evolution-host / all / preset | 组合（9/31/9 行 + YAML） | host/all keep；preset **delete** | D9 |
| evolution-agent | 预设 delta（9 行） | keep | |
| test-support / scripts | 夹具 / 门禁（1,513 / 23,707 行） | contain | scripts 需分层（D4/§6 L2） |

## 6 更优拆分/合并建议（按成本档）

**S 档（≤1 天，低风险）**
1. `run-gates` overlay 身份校验（P1-1）：比对 overlay 内 `packages/evolution/package.json` 版本，不符→`cannot-decide`；`--overlay` 显式化。
2. 删 gate-13/14/15 行+登记（或搬回脚本升为 script 行）；删 33/56/57/78 retired 行（表格 id 可保留占位）。
3. `verify-arch-guards` 自检门禁：docblock↔RULES 双射、id 唯一（现 N40×3）、注册表键必须存在（现 5 死键）。
4. `gen-platform-line --check` 补一条本地 gate 行（现在只有 CI-only 的 spec 兜底）。
5. `gen-client-seam` 从 host 路由返回类型生成客户端 wire 类型（D6），或至少生成 JSON schema 供两侧 parse。

**M 档（≤1 周，机械搬运为主）**
1. 拆 `SkillLibrary`：read/list、write/mutation、history/archive、health/stats 四模块，子路径按机制分（`skills.read`/`skills.write`）；200+ 内部 import 走 subpath，面大但纯机械。
2. 三个千行 `apply` 改「action → handler 模块」分派表（tool-skill-manage/commands/review），行为不变，用现有 spec 兜底。
3. `merge` 的命令表用 merge 自己的轻量 builder（或直接内联 `CommandDef` 类型），去掉 `merge→commands` 反向依赖（D7）。
4. 门禁登记统一走 `lib-exemptions` 的 `{reason, owner, expiry(version), plan}` 评估器（现 machineLocal/localOnly 用自由文本 expiry），到期即红（D4）。

**L 档（跨版本，需要单独设计）**
1. **双布局收敛**：CI 直接以镜像布局构建（`inject-evolution-paths` 已能把 `@deepseek-ai/dsh-*` 指到 upstream），删掉 overlay 复制与 layout token 翻译；或反向把 `packages/evolution` 定为唯一布局、镜像由生成器产出。现状是两套布局都手工维护（P1-1/P1-2 的根因）。
2. 门禁分层为「纯判据 / 执行器 / 登记表」三层，登记表版本化并集中评估（承接 M4）。
3. `evolution-ui` 拆 host/client 两包（与 merge-ui/skill-health 一致），client 只从 client-kit 生成物取类型（D8）。

## 7 覆盖清单

- **通读**：`package.json`×23、`pnpm-workspace.yaml`、`platform-line.json`、`docs/developer/architecture.md`、`gates/registry.mjs` 头、`run-gates.mjs`、`lib-env.mjs`、`lib-exemptions.mjs`、`lib-family-packages.mjs`、`persisted-write-inventory.json`(结构)、`verify-layout-sync.mjs`、`verify-architecture-baseline.mjs`、`ci-overlay.mjs`、`normalize-mirror.mjs`、`build-client.mjs`、`verify-core-surface.mjs`、`gen-host-commands.mjs`、`gen-client-seam.mjs`(1-70)、`verify-test-lines.mjs`、`verify-platform-contract.mjs`(头+锚表)、`verify-gate-manifest.mjs`(84-170)、`.github/actions/*/action.yml`×3、`release.yml`、`architecture-baseline.json`、`client-exceptions.json`、`line-policy.json`。
- **脚本化扫描**（临时脚本在 `%TEMP%\audit-arch`，已删）：全仓 src/tests import→包级边与环；exports 重复定义；TS AST 函数/类尺寸；generated/生成器清单与调用者；硬编码盘符路径；arch 注册表键存在性；gate 实体执行与 `path` 分组；包/测试行数。
- **只 grep/抽读**：`verify-arch-guards.mjs` 规则实现体（1-1130 外按需）、`prepare-release`/`publish-scoped`、各域实现（并发/merge 事务/工具内部按分工不深挖）、locale JSON、测试正文。
- **未验证**：CI 真实运行、真机 host、运行期行为；`.release-staging`(28.9MB, ignored) 本地残留未计入结论。

## 8 复现命令

```bash
node packages/scripts/run-gates.mjs local --json-out "$TEMP/gates-local.json"   # 实测：pass57 fail0 cd4 skip1
node packages/scripts/verify-env.mjs --json                                 # 看 overlay/profile/adapter 解析
node packages/scripts/verify-core-surface.mjs .                             # root star exports 70 (<=75)
node packages/scripts/gen-platform-line.mjs --check                         # OK（当前新鲜，但无本地 gate 行）
node packages/scripts/verify-platform-contract.mjs packages --upstream <upstream>  # 需 --accept-recorded 才绿
```

审计期间本审计只新增本文件，未改动任何源文件（探针脚本全部在 `%TEMP%\audit-arch`，已删；`git status` 中该目录下的其他文件属并行审计员）。
