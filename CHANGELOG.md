# Changelog

## 0.3.56 (patch) — 0.4.0 系列批 2：配置两层化 / 错误附下一步 / 文档五区（WC/WD2-D4/WE/C4）

- **WC 配置两层化**：①**拨盘层**——5 个语义拨盘（autonomy / scope / curatorBackground / memoryInjection / threatStrictness）文档化 + 背后字段映射表（全部实测存在，T-WC2 钉住 7 个字段）与三档风险标注（日常/调优/高危）；②**env 收口**——core 新增 `env.ts` 单源模块（`allowRowCollisions()` + 键表），`DSH_EVOLUTION_ALLOW_ROW_COLLISIONS` 读取迁移（行为不变）；配置层 `!!js` env（SESSION_QUERY/SESSION_QUERY_PATH）按边界**保留在 profile 配置求值层**（不可迁移），文档表区分两读取层；③**生成式导航**：命令表/拨盘/env 表均以「单源渲染 + 测试守卫」形态落地（README 五区）。
- **WD2-D4 失败与命令体验**：①常见错误编号化 E-301/302/303（approval/curator/replay 服务未挂载——附「下一步」指向 doctor）；②threat 拒绝消息统一附豁免通道指引（`threatExemptLabels`——内存/技能双写面）；③README Operate 区 Troubleshooting 表（already registered 双装解读、E-3xx、threat、form none——每行含下一步）。
- **WE 文档五区**：根 README 重组为 Concepts / Get started（含 **C4 首 10 分钟叙事**：首次审阅 defer、第一条记忆/技能从哪来、去 `/evolution doctor`/`mutations` 看什么、怎么停）/ Reference（命令表×拨盘×env）/ Operate（Troubleshooting×Migration 四类用户）/ Development（包地图+compositions+invariants+双布局下沉）；zh 同步（配置拨盘表 + 常见问题表）；dev README 补 dials/env 节（canonical 测试面）。
- **护栏**：T-WC2（dial-reference 守卫：README 拨盘节存在 + 7 字段逐一存在于所属包源码）；T-WD2 既有（命令表/hint 单源）延续。
- **门禁**：core 303（+env 迁移下 preset-composition 9）、commands 47（+E-xxx 断言面）、dial-reference 2；oxlint 0/0（206 文件）；tsc 0；全量以 CI Linux 为准。

## 0.3.55 (patch) — 0.4.0 系列批 1：概念产品化 + 安装模式 + 生成式命令面（WA/WB/WD1）

- **WA 概念产品化**：根 README 首屏新增「Concepts: the two evolution loops」——记忆进化/技能进化两回路 + 共享引擎（Review 心脏 + Curator 代谢 + Governance 闸门）+ 术语表（plan/pending/staged/snapshot/consolidate/nomination/drift/substantive/catalog/rank/review mode——中英单源，与命令输出同一套词汇）；zh 快速开始同步（含概念简报 + 模式表）。
- **WB 安装模式产品化**：M1–M4 模式表（M1 全自动默认 / M2 人审把关 / M3 只装底座 / M4 按会话进阶——与 all 互斥）；**新增 `/evolution doctor`**（只读自检：安装形态识别 full/host/preset/layered/none、三方冲突检测（all/host/preset 双装 + all vs layered）、`DSH_EVOLUTION_*` 体检（SESSION_QUERY 白名单等）、服务挂载清单、pending 数；`--json` 供脚本；输出末尾附建议动作）；INSTALL 验证节改为「跑 doctor 应看到 ✓」；npm 元数据场景化（host/preset/commands/all description 改写为语言）。
- **WD1 生成式命令面**：`evolution-commands/src/registry.ts` 子命令注册表成为**单源**——input hint、bare `/evolution` help、README 命令表全部由它渲染（原三处手写副本删除——v10 R-13 类漂移根治）；README/zh 命令表同步为注册表渲染。
- **护栏**：T-WB2（doctor 六用例：四形态分类/冲突/env 体检/渲染尾建议/多 profile 聚合）；T-WD2（hint==注册表合成、README 命令表与注册表逐条一致、summary 非空）。
- **门禁**：evolution-commands 47/47（+doctor 7 + registry 3）；oxlint 0/0（204 文件）；tsc 0；全量以 CI Linux 为准。

## 0.3.54 (patch) — route B：默认安装即全量（`dsh-evolution-all` 升级为完整 bundle）

- **行为契约（安装体验反转）**：
  1. `@lmzhen/dsh-evolution-all` 从被动聚合包升为**完整 bundle**——新增 `dsh.bundle.patch`（`cordis.patch.yml`）：行集 = evolution-host 基础设施行 ∪ 4 个模型工具行（`tool-memory`/`tool-skill-manage`/`tool-session-query`/`evolution-skill-catalog`），全部 profile **root** 级。`dsh plugin add all` = 装完即全量：每会话自动获得后台自动化 + 记忆/技能工具 + SKILLS/MEMORY 指引注入，**无需预设与会话选择**（旧 all 用户升级重启后即全量——行为变更）；
  2. **删减 = 包选择**：`host` 保持 infra-only（same automation minus model tools）——移除全量 = 卸 all 装 host；
  3. **三方互斥 fail-loud**：all / host / one-click preset 两两互斥（同 scope 双装 = 重复行 → 上游 invariants `already registered` 启动即抛）；**all 与 layered Evolution 预设亦互斥**（预设 scope 模型行双挂载同类触发）。install-layered `--mode agent/layered` 检测到 profile 已装 all 时提前拒绝并给出二选一文案。
- **防漂移守卫**：bundle-mutual-exclusion.spec 新增 G-A（all 的 infra 行体 ≡ host.patch）/G-B（all 的 4 模型行体 ≡ preset.patch）/ G-C（模型行包 ⊆ all 依赖闭包——infra 行由 host 自身契约担保）；T2 组合层证明 all+host / all+preset 双装真实构成重复行（fail-loud 前提）；installer T5（agent 模式遇 all 拒绝）。all.spec 依赖断言升级 6 项（补 `dsh-tool-session-query`——v10 F6 缺口在此版闭合）。
- **文档**：根 README/README.zh/INSTALL/包 README 三向安装表重写（全量默认 → 精简换包 → 进阶 layered → 兼容 preset）；evolution-all/README 与 src docstring 重写（不再是"one command 装但只挂 infra"的 H-08 语义）。
- **门禁**：host/all/preset 69/69（+G-A/G-B/T2×2/T5、all 依赖 6 项）；oxlint 0/0；tsc 0（三包）；全量以 CI Linux 为准。设计蓝本：`dsh-evolution-mirror-plan-route-b-full-bundle.md`（机制事实含 applyEntryPatches insert 无去重——互斥 fail-loud 的承重证据）。

## 0.3.53 (patch) — P1-2 延伸修复：catalog cap 注入下沉至预设组合器（V10-14 收尾）

- **P1-2 延伸 [组合层可达]**：v10 修复只在 install-layered（源码树自举工具）注入 `catalogDescriptionMaxLength: 60`——而 `/evolution preset install`（commands 路径，**npm 用户唯一预设生成途径**）走 core `composePresetComposition`，无注入：生成预设的会话可见 tool-skill 行仍跑平台默认 500，P1-2 症状在该路径原样存活。**修复**：cap 注入下沉为**组合器契约**——core `composePresetComposition` 内建 `injectCatalogDescriptionCap`（幂等：已有 `config:` 行不动；marker 注释标识组合器文本；无 tool-skill 行时 warn 一次并原样返回），install-layered `generateAgentPreset` 同步内化同一规则；两路径输出字节一致（installer.spec parity 钉，fixture 升级为含 tool-skill 行——任一侧漏注入即红）；commands preset install 端到端用例补 cap 断言（判别力：旧 fixture 无 tool-skill 行测不出注入）。
- **门禁**：core preset-composition 9（+2 判别：注入/幂等）、installer 13（parity 升级）、commands（preset install 含 cap 断言）共 50/50；oxlint 0/0（200 文件）；tsc 0（core/host/commands/agent 四包）；全量以 CI Linux 为准。

## 0.3.52 (patch) — v10 审计轮（批次 0–8）：行为契约变更声明（V10-01~18）

**来源**：v10 审计报告（P1×2、P2×19、P3≈80）按架构层级分批（批次 0–8）实施；按计划约定，本节集中声明本轮**行为契约变更**，逐条一行。批次 8（T 横切：README/INSTALL 同步、invariant 样板注释、延后台账落档）同版交付。

- **V10-01 [P2·数据完整性]**：consolidate reference 模式目标已存在时改为**追加**（原无条件覆盖——"consolidate → 重建 → 再 consolidate"静默清除旧降级知识；与 restructure 追加语义对齐）。
- **V10-02 [P2·数据完整性]**：normalizeFrontmatter 发现**重复 key 拒写**（进 issues 拦截；原按 key 查 Map 改写错行、带病字节经 last-wins 校验静默落盘）。
- **V10-03 [P2·误报通道]**：SkillLibrary/MemoryStore 新增 `threatExemptLabels` 选项（默认空=行为不变）——部署可经 config 打开豁免白名单；拒绝消息附加命中 label 与豁免提示。
- **V10-04 [P2·数据完整性]**：state-json **记录级门禁**——必填字段/枚举不过关的记录走 quarantine 隔离并在返回集合剔除（原 `{"foo":1}` 被当作合法记录、NaN 静默传播，非法 status 成为查询不可见僵尸）。
- **V10-05 [P2·有界化]**：损坏文件隔离副本收敛为**固定名 `<file>.corrupt`** 原子覆盖（原时间戳+随机后缀，每次读取新写一份无限堆积）；历史 `.corrupt-*` 由 sweep 超 7 天兜底清理。
- **V10-06 [P1·耐久性]**：io 写路径对齐上游 crash-durable 协议——tmp `open('wx')` + `handle.sync()` + POSIX 目录 fsync 后 rename（原裸 writeFile+rename 无 fsync，掉电产生空/截断状态文件，触发 E-9 永不自愈 fail-loud）。
- **V10-07 [P2·锁完备]**：写锁接管新增**第三分支**——锁体非空、pid 不可解析（NaN）、mtime 超 1h 宽阈值可接管并 warn 一次（原撕裂写锁使该目标全部写入永久 fail-loud 需人工删锁）。
- **V10-08 [P3·语义]**：`/evolution maintain` 冷却/在飞拒绝改返回 **err**（原 success 文本——消费方无法从结果类型区分"已执行/被拒"；monorepo 内已核无按文案判断的消费方）。
- **V10-09 [P3·结构化契约]**：`MaintainOutcome` 新增 `recommendationCount`；commands 侧**删除** formatPlan 渲染文本解析（`/^- \[/gm`+Notes 切割，不留双轨；渲染本身不变）。
- **V10-10 [P2·接口失配]**：review 证据通道改读 `tool/result` 的 `message.content`（tool-result 块文本；原 `output` 字段上游 rc.2 不存在、`[result]` 行恒空、审阅证据静默降级）；错误标记同时看 `data.error` 与块级 `isError`；截断预算不变。
- **V10-11 [P2·root 统一]**：review / learning-graph 新增 `skillsRoot` 配置（默认空=原行为），接入 `resolveSkillsRoot` 统一解析——自定义 root 部署下 review/`/graph` 不再向默认树写错。
- **V10-12 [P2·防御纵深]**：威胁 deny 迁入 `tools.guard` **单调通道**（与 policy 同通道，不可被 pre-execute 监听器短路）；原监听器移除避免双扫描。
- **V10-13 [P2·状态机]**：review `skillReviewTrigger:'both'` 同回合**互斥**——completed 回合命中 cadence flush 后跳过 completion 通道（原同一完成点可双发、双倍 token 互相干扰）。
- **V10-14 [P1·组合可达]**：install-layered 生成 Evolution 预设时向 standard 来源的 `tool-skill` 行注入 `catalogDescriptionMaxLength: 60`（幂等：已有 config 跳过）——layered 形态读取侧 60 字符 cap 恢复生效（原 host patch 覆盖到不了预设 scope、模型可见上限实为平台默认 500）。
- **V10-15 [P2·env 边界]**：`DSH_EVOLUTION_SESSION_QUERY_PATH` 空串回退默认路径（原 `resolve('')` 落进程 CWD 产生杂散 session-query.db）；`DSH_EVOLUTION_SESSION_QUERY` 非法值白名单归一 `startup`（原直接炸 zod ValidationError、profile 无法启动）。
- **V10-16 [P2·装配]**：standalone `cordis.yml` 的 `evolution-state` 行**显式 pin `provider: 'domain'`**（原实际生效 provider 由 yml 行序隐式决定、双 provider 注册介质静默分叉；头注释 "fallback" 改写为真实语义）。
- **V10-17 [P2·发布元数据]**：tarball `repository.directory` 改由打包目录名生成、指向实际扁平目录 `packages/evolution-*`（原按改写后包名拼接指向不存在路径，已发布包源码跳转全部失效）。
- **V10-18 [P2·CI]**：版本守卫（verify-layout-sync）接入 validate action；安装步骤改 frozen-lockfile（或步骤名如实化，以 CI 实跑二选一）；release.yml 补 `timeout-minutes` 与 PR paths-ignore。
- **落地状态注记**：批次 8（本节落笔）时点对照工作树核验，批次 0–7 修复**均尚未见于工作树**（并行批次实施中）——上列条目按计划声明；收尾消项复核（计划 §6-6）确认某条未落地时由主控在该条补注 deferred。
- **T 横切（批次 8，本版已交付）**：README/README.zh 新增 `/evolution` 命令面全量枚举（对齐 `evolution-commands` 注册面，内建 help 为权威；原清单缺 curator pause/resume/status/scope、mutations、consolidate、learn、maintain、preset install、restructure、replay 等十余条，且裸 `|` 破坏表格渲染）；INSTALL 验证一节 vitest 路径修正为扁平布局 + 双布局注记（G5.5 口径）；30 份 `src/invariant.ts` 头注释补样板声明（audit v10 S-09；不抽共享工厂，计划 §4-3）；README（en+zh）补测试导入取舍声明（I-03：约 30 组未声明 `@deepseek-ai/*` 测试导入依赖合并布局，不为测试补 devDependencies）与上游升级对照清单（I-02：USER_DSH_RANK 影子 rank 对照 + `@deepseek-ai` 包名撞名检查）；`packages/docs/deferred-items-v10.md` 落档计划 §5 全部 12 项延后台账（含重访触发条件，本地存档不上传）。

## 0.3.51 (patch) — v9 审计批 2：口径与判别力批（V9-05~12）

**来源**：v9 审计报告剩余八项——文档口径修正（`~` 展开挂账、CHANGELOG 失实句、mtime 消费方声明）+ 实现与注释对齐（threats 边界、redact 锚注、maxDepth 守卫、.bak 失败形态）+ 测试判别力补强。全部先核验后修复，无报告字面照办。

- **V9-05 [P3·口径/分裂脑]**：三处 DSH_HOME resolver 行为分裂——`state-store.evolutionRoot()` 有 trim 守卫（V8-06，自称 single source），而 `memoryRoot`/`skillsRoot` 仍用裸 `||`：`DSH_HOME=" "` 曾解析到 CWD 相对 `" /memories"` 侧车。**修复**：两个 root 复用 `evolutionRoot()`（核心逻辑单点，注释指向）；判别用例（三 root 对空串/空白/真实值行为一致——用一个用例钉住 split-brain 不再复发）。
- **V9-06 [P3·历史文档失实句]**：0.3.47 的 V8-14 条目隐含交付「parity 恢复 + 无 failed 噪声」——但当时仅函数级参数接线，生产 run() 仍 4 参（0.3.50 V9-02 才补）。**修复**：该条目附**更正注记**（历史句按交付事实保留，注记为当前权威陈述：0.3.47=函数级；0.3.50=生产接线；0.3.51=注记）。
- **V9-07 [P3·文档失实]**：io.ts 的 `mtime` 探针注释称「Consumers use it as a cheap invalidation stamp」——**全树无消费方**（skill-catalog 失效是事件驱动的 `skill-mutated`/`skills-refresh`）。**修复**：注释如实化（无消费方声明，探针保留为后端契约扩展点，接线前先补文档）。
- **V9-08 [P3·边角声明]**：0.3.49 固定名 `.bak` 的 two failure shapes 未声明——(1) 旧 `.bak` 删除失败：无害（copy 契约=覆盖 `cp force`）；(2) copy 失败：backup null → 拒绝消息无备份后缀、语义不变。**修复**：backupFile 注释声明两形态 + 判别用例（copy 抛错 → 拒绝消息无 backup 后缀 + drift 语义保留）。
- **V9-09 [P3·测试断言]**：① 重复 add 容忍（`no duplicate added`）实现存在但**无断言**（曾消失）——恢复判别用例（add 重复 → ok:true + 消息含 no duplicate added + 条目数不变；batch add 同容忍）；② render-facts 的 dup_heading 只有 pass 形态断言——补 **over 形态渲染断言**（value=重复标题(2) verdict=over 完整面）。
- **V9-10 [P3·边界/注释]**：① threats `ssh_backdoor` `/authorized_keys/i` 无 `\b`——`unauthorized_keys` 类复合词曾误红（C2 表纪律对齐）；真实 `.ssh/authorized_keys` 引用不受影响；判别用例（复合词不触发 + 真 .ssh 引用封锁）。② redact 注释「other patterns already carry their own anchors」**失实**——JWT（`eyJ…`）与 bearer 行并无左锚；注释如实化（无 `\b` 是有意选择，出现真误报再评估）。
- **V9-11 [P3·挂账]**：evolution 配置路径面（`skillsRoot`/`eventsHome`/preset target）**不展开 `~`**——主库 `@deepseek-ai/dsh-home-paths` 的 `expandHomePath` 未复用；`skillsRoot:"~/skills"` 按字面解析。**挂账（低严重度暂不修）**——平台层无统一展开契约，家族自行展开会造成行为分裂；登记 `known-limitations 局限九`（触发条件：真实用户反馈 `~` 不生效时再评估，首选项=复用主库 expandHomePath 于 resolveSkillsRoot 单点）。
- **V9-12 [P2·测试判别力专项]**（五项，全部红转绿可判别）：
  1. **approval 重放路径**：approve 的两个未测分支补判别——runner **throw**（`{ok:false}` 之外的形态：记录保持 pending + claim 释放，`remains pending` 消息）与 **无 runner** approve（claim 释放 + `No replay runner registered` + 记录仍可 reject）；
  2. **V8-08 record 半边**：restructure 端到端用例此前只断言事件——补 `skillUsage.record(name,'patch')` 断言（记录行被误删时用例必须红）；
  3. **maxDepth 守卫**：实现与注释不一致——负数通过 `Number.isFinite` 却被注释声称兜底 1。**修复**：守卫补 `>= 1`（注释与实现对齐）+ 行为用例（NaN/Infinity/0/-2 → 1；合法 4 原样透传）；
  4. **plan-validator action 写回**：V8-23⑪ 的 memory 侧无 action→`add` 写回有实现无断言——补判别用例（skill 侧 V6-26 对称既有）；
  5. **.bak 判别精确化**：三处 `startsWith('MEMORY.md.bak')` 是前缀超集（时间戳累积形态也会绿）——改**精确名**判别 + 固定名覆盖用例（两次漂移 → 恒 1 个 .bak 且为最新字节）。
- **门禁**：core 316/316（+状态 22/memory 22/threats 10）+ approval 20（+2）+ maintenance 92（+orchestrate 21/render-facts 5 含新）+ validator 12（+1）+ commands（含 record 半边断言）；oxlint 0/0（全树 194 文件）；tsc 0（五包 --force）；全量以 CI Linux 为准。

## 0.3.50 (patch) — v9 审计批 1：仓库状态与声明修复补完（V9-01/02/03/04）

**来源**：v9 审计报告修正类批——三项「声明修复的补完」与一项修复引入回归。

- **V9-01 [P2·仓库状态]**：**30 个 manifest 版本被 dcebd8c（0.3.45 pinned-contract update）反向改写为 dev 基线 `0.1.0-rc.1` 且四个版次未对齐**（root=0.3.45、CHANGELOG=0.3.49 三方不一致——一次「robocopy 二次同步带入 dev 清单后未跑 normalize」的反向同步事故；发布不受影响（tarball 版本由 git tag 在 pack 时覆写），但 committed 预览契约被破坏且 normalize 文档契约与仓库现状自相矛盾）。**修复**：① 本版发布链 normalize 把 31 个 manifest 钉回发布线（0.3.50）；② **新守卫挂入 verify-layout-sync**：「manifest 版本 == CHANGELOG 头节」检查（根 CHANGELOG 首个 `## x.y.z` 与全部包 manifest + 根 package.json 一致）——当前漂移形态被守卫当场抓出（30 manifest + 根全报），未来 CI 可见。
- **V9-02 [P2·修复未接线]**：V8-14 的 `protectedNames` 只接了 core 签名与 scopeView——**生产调用 run() 仍 4 参**，marker 保护的 `created_by:'agent'` 技能照旧进归档候选 → deleteProtection 拒绝 → error 噪声（v8 报告 V8-14 原症状在生产入口原样存活）。**修复**：run() 补第 5 参（一行）+ **run() 全链路集成判别用例**（bundled marker + agent 记录 → errors 空、archived 不含——**红转绿实证**：临时去参 → errors [Array(1)] 红 → 还原绿）。**教训**：带新参数的修复必须核验全部生产调用方接线（V6-48 同型第二例，已入收口检查单）。
- **V9-03 [P2·声明失实]**：V8-22 未交付——0.3.49 的修改目标是**镜像** packages/README，随后发布链 robocopy 用 dev 版覆写掉了；且根 README 互注断言「对侧注释存在」为假。**修复**：改 **dev 树 README.md（canonical——robocopy 同步镜像 packages 副本）**——补 preset install 注记 + 双布局命令规则两段 + 改互注（准确描述 canonical 关系）；根 README 互注同步修正。**教训**：双副本/布局文件的 canonical 端是 dev 树，镜像侧编辑会被 robocopy 冲掉。
- **V9-04 [P2·修复引入回归]**：V8-11 把 target 存在性/合并校验后移到归档之后——干净拒绝（not found/超限）变成「先归档全部 source 再逐回滚」的破坏性路径（restore 失败即半完成）。**修复**：归档循环前恢复**廉价 target 存在性预检**（serial 内权威读保留——竞态修复目标不失）；判别用例（missing target → ok:false + source 未归档）——预备检对拒绝路径零破坏。
- **门禁**：curator 51/51（+V9-02 集成）+ skill-store 38/38（+V9-04 拒绝路径）；oxlint 0/0（全树）；tsc 0（--force）；verify-layout-sync 守卫对当前漂移报 31 项（判别力实证——发布链 normalize 后应 0 项）；全量以 CI Linux 为准。

## 0.3.49 (patch) — v8 审计批 6（收尾）：文档同步 + 死代码清扫 + 测试缺口（V8-22/23）

**来源**：v8 审计报告批次 6（L6 文档 + T 横切）——v8 审计轮最后一个版次。

- **V8-22 [P3]**：`packages/README.md` 补根 README 的两段补句（preset install 注记 + 双布局命令路径规则）——0.3.43 的修复只落了根副本；两文件头部互加 **「双副本需同步修改」** 注记（不做生成机制/守卫脚本——漂移面仅两处，手动同步 + 互注成本最合理）。
- **V8-23 [P3·死代码/文档漂移批]**（十二子项）：
  - **删除**：`saveActivity`（零生产调用、apply 直用 transactIo+serialize——含 F-304 注释更新与测试注释修正）、`summarizeAssessment`（零生产引用，jsdoc「for tests and replays」失实——含测试删除与类型导入清理）、constants 与 review 两处过期 doc-comment（合并残渣）、curator 孤儿 JSDoc、plan-validator 零 import 的 schemastery 运行时依赖、evolution-state 的 storage-domain/state-domain 幽灵 devDeps、evolution-state README 标题改写。
  - **修正**：io.ts size/mtime doc 对齐实现（仅 ENOENT/ENOTDIR 归 null，其余 stat 错误是 IO error）、tsconfig.host.json 悬挂指针加 "(upstream tree only)" 限定。
  - **补齐**：state-json 漏报 io-node devDeps（9 spec 实测用）、state-domain 漏报 storage/storage-json（3 spec 实测用）。
  - **点修**：orchestrate maxDepth 加 Number.isFinite 守卫（导出 API 面——NaN/负值防折叠）；plan-validator memory ops 按 V6-26 口径写回显式 `action: 'add'`（新消费端不再猜默认）；memory 漂移备份改**固定名 `<file>.bak`**（写前删旧——原 `.bak.<stamp>` 无保留策略跨会话无限累积；既有测试断言同步适配）。
- **T 横切**：V7-11 累计预算专项用例（多命中 replaceAll 超累计预算 → 整体拒绝——此前 fuzzy-patch.spec 无该专项，覆盖靠随机 fuzz；判别用例：300 段 × 单次 ~1M 扫描 ≈ 累计 300M ≫ 8M——`## Section  title` 双空格形态保证 fuzzy 非 exact 命中）。
- **门禁**：受影响面全绿（skill-store 37/memory-store 19/activity 12/render-facts 4/validator 11/review 28）；oxlint 0/0（全树）；tsc 0（四包 --force）；全量以 CI Linux 为准。**v8 审计轮 24 项新发现 + 平台对照全部闭环：修 19 / 核验不修 2（V7-10 观察项延续、V8-04 已修）/ 文档 3**。

## 0.3.48 (patch) — v8 审计批 3+5：review 状态机收尾 + 发布链守卫（V8-03/04/17/18/19/20/21）

**来源**：v8 审计报告批次 3（L4 状态机）+ 批次 5（L6 发布链守卫）合并。

- **V8-03 [P3·保护域]**：flush 的 `evolution/review-scheduled` emit（subagent 成功路径）与 completion 通道同款 emit 均包 try/catch + warn——抛错监听器曾穿透 flush 跳过计数清零（V7-04 重复交付的 emit 入口变体）；判别用例（抛错监听器 → 通知仍达 + 计数清零 + warn 命中）。
- **V8-04 [P3·状态机]**：flush 取值改 **fresh 优先**（`kind ?? latch ?? undefined`）——完成轮当轮跨过第二阈值时 `advanceReview` 返回 combined 但旧 latch-first 丢弃它（V7-14 裁定的「完成轮当轮交叉」残余窗口——无中间轮覆写）；fresh 优先语义与「last-trigger-wins 越晚越贴近相关性」一致；skip 轮 kind=null 自然回落 latch。**行为变更（CHANGELOG 声明）**：完成轮 fire 与段内旧 latch 并存时以当轮 fresh 为准。判别用例（5/10 双阈值 10 轮序列：turn9 前 latch=memory → turn10 completed 交叉 → 交付 `[Auto-review]`（combined）而非 `[Auto-review — Memory]`）。
- **V8-17 [P3]**：publish-scoped 的 npmCliJs 候选只在 env 存在时加入（APPDATA/ProgramFiles 未设曾产生 CWD 相对幻影候选——install-layered V6-51 同款处理）。
- **V8-18 [P3]**：发布主链路真空守卫——manifest 或 publish-order 声明 0 包即 fail-loud（原来空集相等比较通过、循环零次后打印 "publish run complete"——F-103 教义与 verify-* 三脚本对齐）。
- **V8-19 [P3]**：`--only` × `--groups` 组合——点名包落在截断切片之外时 fail-loud（原来静默跳过仍报 complete——操作者以为发了实际没发）。
- **V8-20 [P3]**：prepare-release 的 exports 校验覆盖**对象形态**（{types, default} 递归一层同 inShipped 检查）——string 形 35 处原已查、object 形 61 处（含全部主导出与 ./invariant）从不校验的空转被闭合。
- **V8-21 [P3]**：`@deepseek-ai/dsh-evolution-agent-preset` 列入 evolution-commands 的 **optionalDependencies**（运行时 createRequire().resolve 的声明语义——被补齐；verify-dependency-closure 静态 import 盲区的运行时面获得声明）。
- **门禁**：review 28/28（+2 判别）+ anchored-smoke 2/2 + lifecycle 2/2；oxlint 0/0（含 scripts）；tsc 0（review --force）；publish-scoped/prepare-release `node --check` 语法校验通过；全量以 CI Linux 为准。

## 0.3.47 (patch) — v8 审计批 2+4：守卫与口径批（V8-02/06/07/08/09/10/12/13/14）

**来源**：v8 审计报告批次 2（L2 守卫）+ 批次 4（工具命令面）合并；V8-06（plan 批次遗漏项）补入。9 项全部先核验后修复。

- **V8-02 [P2·数据完整性]**：memory 分隔符守卫改为检查**最终落盘 entry**（`addDatePrefix` 前缀与内容的接缝可合成 `\n§\n`——`§\nfoo` 过旧守卫但变 `## date\n§\nfoo` 后分裂为两条且 drift 假阴性）——addCore 与 applyBatch 两入口同修；判别用例（addDatePrefix:true + `§\nfoo` → 拒；无前缀同 fact 行为不变）。
- **V8-06 [P3·口径]**：`evolutionRoot` 的 DSH_HOME 空串守卫扩展为 **trim**（上游 home-paths `trim().length > 0` 采纳测试）——`DSH_HOME=" "` 不再产生 CWD 相对侧车（/evolution preset install 与 evolutionHome 同源修复）；判别用例。
- **V8-07 [P3·配置]**：maintainCooldownMs 接入家族 clampedNumber 管道（min:0 保留「0=禁用冷却」）——NaN 曾静默禁用冷却（恰是该配置要防的重复模型调用场景）、±Infinity 曾永久冷却；**注意**：cordis 加载剥键（0.3.45 实证）使该路径经 schema 即默认值——clamp 为直构/深度垃圾的防御层（判别=clampedNumber 既有测试族 + 注释说明）。
- **V8-08 [P3·观测面]**：`/evolution restructure` 命令的 SkillLibrary 构造接入**单一写汇**（第 4 参 onMutation——`evolution/skill-mutated` 事件此刻发出）+ 成功后 `skillUsage.record(name,'patch')`（与 skill_manage 同动作的观测面一致）；判别用例（端到端 restructure → 事件 `{action:'restructure', name}` 收到）。
- **V8-09 [P3·形状守卫]**：skill_manage 的 `args.restructure` 加 `Array.isArray` 守卫（非数组垃圾实参曾 `.map` TypeError）——第二道防线（tool schema 先拒）；测试证「结构化拒绝 non-TypeError」。
- **V8-10 [P3·双口径单源]**：RESTRUCTURE_TARGET_RE 加 `(?!.*\.\.)`——restructure 可创建的集合与 validateSupportPath 可打开的集合重合（`references/my..notes.md` 曾可建不可开——孤儿文件；RE 侧收紧而非放宽 traversal 面）；判别用例（双点拒/单点存）。
- **V8-12 [P3·误伤]**：redact `sk-` 模式加 `\b` 左边界（`task-…`/`risk-…` 词尾 sk- 曾整段误红）；判别用例（task-/risk- 不误伤 + 真密钥仍红）。
- **V8-13 [P3·误伤（行为契约放宽，CHANGELOG 声明）】**：threats exfil 组 `cat/curl/wget` 加 `\b` 词边界（`concat .env files` 曾触发 scope='all' 全局写封锁——任意 prose 命中即全锁）；判别用例（concat/wget-demo/scurl 不触发 + 真 `cat .env`/`curl "$API_KEY"`/`wget "$TOKEN"` 仍封锁）。
- **V8-14 [P3·视图口径]**：lifecycleCandidate 与 computeLifecycleTransitions 增加 **protectedNames 参数**（与 computeScopeView 共享同一 marker 集）——marker 保护的 `created_by:'agent'` 技能不再同时出现在 managed[] 与 protected[]（视图与转移 parity 恢复；转移引擎不再产生被 deleteProtection 拒绝的 failed 噪声）；判别用例（marker+agent → protected 有、managed 无、archive 无）。
  - **更正注记（0.3.51 V9-06）**：本条目所述 parity 恢复在本版交付时只完成了**函数级**参数接线——生产 `run()` 当时仍以 4 参调用，运行态视图分裂与 failed 噪声依然存在；`run()` 第 5 参接线与全链路集成用例由 0.3.50（V9-02）补成。历史句按 0.3.47 交付事实表述，本注记为当前权威陈述。
- **门禁**：受影响面全绿（memory-store 19/redact 7/threats 9/state-store 4/skill-store 36/curator 50/commands 30/tool-skill-manage 17=172）；oxlint 0/0（全树 194 文件）；tsc 0（三包 --force）；全量以 CI Linux 为准。

## 0.3.46 (patch) — v8 审计批 1：L1 存储与并发基座（V8-05/15/16/11）

**来源**：v8 审计报告批次 1（L1 基座——先核验再修，四项均亲核属实后落地）。

- **V8-05 [P3·并发]**：`pendingSelfCleanup` 生命周期双不对称修复：
  1. (a) 登记删除移入 rm **成功**路径——rm 瞬态失败（Windows EPERM/EBUSY）时保留登记，下一写仍可自愈（原来无条件删除使注释承诺的 "always recorded" 失实，进程重启前只 fail-loud）；
  2. (b) 登记表 `Set` → `Map<lock, bodyToken>`：登记时记录失败释放的锁体 token——自愈分支比对「当前 body == 登记 token」才删——登记后残留锁被外部移除、同进程另一写者在同路径新建活锁的场景不再误删（V4-05 注释声称杜绝的形态实际可达）。
  - **验收**：io.spec 新增 V8-05 判别用例（登记旧 token + 磁盘新同 pid 锁 → 写者 fail-loud 且活锁不被删）；F-367 用例适配 Map 形态；**32-way 压测前后整跑 0 丢失**。
- **V8-15 [P3·provider 契约]**：json provider `releasePendingClaim` 补 domain 同款 status 守卫（`pending/executing` 之外直接返回）——已解析（approved/rejected）记录的 claimedBy/claimedAt 审计归因不再被剥；**G7.4 一致性 harness 补「resolve 之后再 release」段**（json/domain 两侧行为一致断言——补上此前只测 executing→release 的分叉面）。
- **V8-16 [P3·形状门]**：record-map 文件的**value 级**形状门（readJson 与 jsonTransact 两入口同款）——`{"a": null}` 这类 value 畸形经过原顶层门后会在 listPending/enforceResolvedCap 触发裸 `.status` TypeError；现在 quarantine（原始字节保留）并指名具体 record id。判别用例（`{"a":null}` → 拒绝且 `.corrupt-*` 旁本在位）。
- **V8-11 [P3·并发/申报]**：`consolidate` 的 target 预读与 merged/pointer 构建**移入 in-process serial 队列**（与 update/patch/restructure/writeSupportFile 同一第二层）——并发 patch 在「预读与提交」之间的交错覆盖窗口闭合（判别用例：consolidate×patch 并发双写皆存；时序性——旧实现大多时序下会覆盖 patch 而红）。**申报**（按 G2.5 先例）：`create`/`archive`/`removeSupportFile`/`setPinned` 四个低频单文件入口的无锁读→写标注为文档化残留（core README 并发模型段补条——不做加锁：收益不抵锁面扩大）。
- **门禁**：受影响面 88/88（io 25 含 32-way/V8-05、skill-store 35 含 V8-11 并发、state 家族 28 全绿）；oxlint 0/0（含 tests）；tsc 0（--force）；全量以 CI Linux 为准。

## 0.3.45 (patch) — v8 审计批 0：V8-01 平台契约 P1 — review 子代理 outputSchema 去 `'json'` 方言

**来源**：v8 审计报告批次 0（最高优先 P1——独立先行发布）。

- **V8-01 [P1·接口冲突/平台契约]**：review 子代理的 `outputSchema` 使用了 `defineTool` 作者 DSL 方言 `items: { type: 'json' }`——而 `subagents.start` 的 outputSchema 走 **raw JSON Schema 校验边界**（上游 `assertObjectJsonSchema`，dsh-tools json-schema.ts 的 SCHEMA_TYPES 七个类型无 'json'）——**默认部署（reviewMode='subagent'）的评审通道在真实平台 100% start 失败**，每次静默降级为 inject 回退；结构化计划管线（validate→read-before-write→approve→execute）自初始开源发布起从未运行过。8 轮审计未发现的原因 = mock 化测试（10 处 `ctx.provide('subagents')`） + `SubagentLike` 把 request 声明为 `unknown`（TS 无法拦截） + 无跨仓 schema 对照。**修复**：
  1. `REVIEW_OUTPUT_SCHEMA` 单源常量（模块级导出）——数组节点改为 `{ type: 'array' }` **省略 items**（上游语义 "absent accepts any JSON item"；per-op 结构校验由 plan-validator 分层承担）；
  2. `SubagentLike.start` 的 `request` 从 `unknown` 收窄为 `SubagentStartRequestLike`（outputSchema 按 raw JSON-Schema 子集字面量类型化——`'json'` 若再入在 TS 层即报错）；
  3. **契约测试**（review.spec V8-01）：以上游 SCHEMA_TYPES 白名单**递归遍历** REVIEW_OUTPUT_SCHEMA 断言每个 `type` 值合法——并做**红转绿判别力验证**（临时注入 `'json'` → 测试红 → 还原绿）——防 mock 化测试再次放行同类漂移（本缺陷潜伏 8 轮的直接原因）。
- **对照核验**：evolution-maintenance 的 outputSchema（orchestrate.ts）本就合法未动；review 其余 start 字段面与上游一致（v8 报告 3.0 平台对照表）。
- **门禁**：review.spec 26/26（+1 契约用例）；oxlint 0/0；tsc 0（review --force）；全量以 CI Linux 为准。

## 0.3.44 (patch) — v7 收尾批：P3 清扫（V7-08/09/11/15/16/18）+ 测试专项补齐（V7-20）

**来源**：v7 审计轮最后一批（P3 清扫 + 四项测试缺口）。

- **V7-08 [P3]**：`archivedIdsCache`（json provider 每实例读一次）在 archive **任何写入后**失效——原实现只在实例启动读一次，cache 建立后的 append/轮转加入的新 id 永不被 mutation 路径（`mergedWithFilteredLegacy`）排除——幽灵 pending 双胞胎可经「append 后、list 前」的 mutation 并入。修复同时覆盖轮转与非轮转写入（两处 return 前失效）；判别用例（cache 空建立 → resolve append live-0 → legacy ghost 键=id → mutation → 排除；**教训：filterLegacy 按 legacy 键对比 archivedIds（id 值）——测试构造的键必须等于 id，键≠id 的"幽灵"不被排除是正确行为**）。
- **V7-09 [P3]**：signals 的 assistant 分支补 `data.message` 本身缺场守卫（V6-21 只守 content——message 缺场 `.content` 仍 TypeError 且被 E-6 吞掉整轮信号；user 分支的 E-49 同款不对称残余）。
- **V7-10 [P3] 核验裁决：不修（观察项）**：空体锁接管 1s 门（io.ts:304）静态双持窗口需「创建者在 open 与 write 间被阻塞 >1s 或时钟偏差 >1s」——未实证 + 锁协议第五版经 32-way 压测多轮稳定 + 接管后仍有 re-read+票二次验证——成本收益不划算，记录观察（若未来出现该形态事故再配合压力实跑修复）。
- **V7-11 [P3]**：fuzzyReplace 的 replaceAll 循环加**累计预算**（每次扫描 work 累加，超 FUZZY_MAX_WORK 返回 null——不部分应用任意前缀）；单次预算（V6-17）与累计预算分离；null 的上层消息补「or the replaceAll fuzzy budget was exceeded」。
- **V7-15 [P3]**：`skillReviewTrigger`（review）与 `reviewMode`（policy）schema 与 Config 接口均收窄为**字面量联合**（类型面闭合——拼错在 TS/配置作者层即失败；schemastery 仍剥键静默（0.3.43 实证），运行时 warn 不可达，已在注释中写明）。
- **V7-16 [P3]**：cleanup 枚举补全 0.3.38-0.3.42 新增的四张 per-session 状态表（pendingCadenceReviews/pendingCadenceWarned/skipNextCadenceFire/cadenceResetWarned——原 cleanup 只清三张旧表；实际无泄漏（闭包整体回收），口径已对齐）。
- **V7-18 [P3]**：install-layered 的 E-33 互斥检查从全名 includes 改为**包尾段匹配**（scope 无关——`@lmzhen/dsh-evolution-preset` 不再绕过默认 scope 装 host 的互斥）；判别用例（直接构造跨 scope manifest——scoped 安装需 .release-staging 测试不可行，检查先于 copy 故构造可行）。
- **V7-20 [P3·测试专项补齐]**：① V6-31（.bak 键集）+ V7-08 行为用例；② V6-33（claimPending 返回拷贝——调用方 mutation 不污染域表）；③ V6-16（无 transact 后端下 serial 队列串行化并发 add——丢记录判别）；④ V6-08/V5-20（stamp 探针同秒后缀形态 `<name>-<stamp>-<rand>`——原只测 plain+正例）。
- **回归**：受影响 spec 全绿（pending-cap 12/12、installer 12/12（+V7-18）、curator 49/49、domain 6/6、memory-store 18/18、skill-store 34/34、review 25/25）；oxlint 0/0（全树）；tsc 0（五包 --force）；全量以 CI Linux 为准。**v7 审计轮 20 项+1（V6-48 失效）全部闭环（修 11 / 核验不修 2（V7-10/14）/ 文档 7）**。

## 0.3.43 (patch) — v7 批三：发布文档契约（V7-05/06/17）+ 声明失实与死代码（V7-07/12/13/19）

**来源**：v7 审计轮第三批（文档契约 + 低风险文字面/实现补正）。

- **V7-05 [P2·文档漂移]**：`evolution-review/README.md` 补 **Review delivery contract** 节（两通道在 `turn/end completed` 时执行、中途零执行；`reviewMode` 显式 inject 的「立即注入契约 0.3.39 已取代」；`skillReviewTrigger` 默认 'cadence' 与 'both' 的双结尾注入警示；`reviewWakeInject` 默认 true + followup 唤醒 + 无 followup 降级 + 唤醒轮 fire 一次抑制；计数窗口「注入→注入」（resetOnFire:false + flush 清零）；完成轮 `?? kind` 兜底；通知与 prompt 同通道；清零持久化失败一次性 warn）；CHANGELOG 0.3.38 条目「显式 inject 保留立即注入契约」句加 **superseded by 0.3.39** 标注。
- **V7-06 [P2·文档三方不一致]**：英文 README「Layered install」节补 `/evolution preset install` 一次性步骤（写 `.agent-presets/evolution/`——走 `dsh plugin add` 发布链的部署者此前按英文文档装完 host 却无预设；对齐 zh README 三处口径）。
- **V7-17 [P3]**：三份 INSTALL（根 + packages/ + dev 树）六处 `packages/evolution/scripts/install-layered.mjs` 修正为 **`packages/scripts/install-layered.mjs`**（平铺镜像的实际路径——照抄原路径必 ENOENT）；README 双布局节补同规则说明（安装命令路径随布局而变）。
- **V7-07 [P3·声明失实 → 补实现]**：tool-memory 的 `operations: []` 现**前置拒绝**（approval 门之前，`ok:false`「No operations provided」）——0.3.37 V6-25 声明「空 operations 的 approval 前置拒绝在 tool-memory 层已有」本不成立（空数组会走 approval 得 "memory 0 ops" 且可 staged、重放无意义），本版把声明变实（**行为**：空批量数组不再进入审批）。
- **V7-12 [P3·死代码]**：tool-skill-manage 的 clamp 告警移到 `limit()` 调用**之后**（原位置求值恒空数组——warn 永不触发）。**实证加深**：schemastery 对 NaN/0/Infinity **剥键/置 null 且不报错**——经 cordis 加载路径非法值本就到不了 limit——warn 覆盖的是**直构/其它解析器**（防御层定位已在注释与测试中写明——测试锁「非法值永不到达为合法数字」的非负断言形态，防止将来 schema 放宽）。V7-12 报告称「tool-memory 同款先钳后查」不实（tool-memory 无该 warn 机制）——已在测试注释与 release-log 记录。
- **V7-13 [P3]**：evolution-threat 的 `apply` 注释对齐 V6-05 现状（钳制下限 PATTERN_OVERLAP+1 = 4097，非 G3.1 时代的 at least 1；schema `.min(1)` 同段说明更新）。
- **V7-19 [P3]**：skill-health `reasons` 文案「above the soft limit」→「**at or above** the soft limit」（`>=` 分支在 == 阈值也触发；既有测试的子串断言兼容）。
- **测试**：tool-memory 12/12（+V7-07 空数组拒绝 + approval 门零调用断言）；tool-skill-manage 16/16（+V7-12 schema 剥离三输入断言）；skill-health 9/9（文案子串兼容）；review 25/25（README 仅文档，无代码变化）。
- **回归**：oxlint 0/0；tsc 0（受影响包 --force）；全量（以 CI Linux 为准）。

## 0.3.42 (patch) — v7 批二：V7-03 通知唤醒通道 + V7-04 清零失败留痕（V7-14 核验不修）

**来源**：v7 审计轮第二批（0.3.40 状态机收尾）。

- **V7-03 [P2·行为不一致]**：`trySubagentReview` 成功路径的结果通知（applied / 零落地两处）原为 `agent.inject`（非唤醒）——默认 subagent 部署的成功路径里主会话对审查结果**零感知**（通知 pending 至用户下轮发言），与 0.3.40「任务结束模型立刻开始总结」的决策口径相悖。**修复**：抽出共享唤醒通道 `deliverMessage(agent, text, summary)`（followup 优先 + 唤醒轮 cadence fire 一次旗标 + 无 followup 降级 inject），review prompt 与两条结果通知统一走该通道——subagent 成功路径的通知现在**被唤醒的模型立即感知**（skip 旗标随行，interval=1 不自驱）。completion 通道（task-complete 提示词）保持 inject（其 session 级一次性旗标不同域）。
- **V7-04 [P2·状态机]**：flush 交付后的计数清零持久化（`saveReviewState`）失败时——交付已发生、latch 已删、磁盘计数仍 ≥ 阈值——stateful 部署下轮会重复交付（无崩溃、审查幂等，纯成本）。**修复**：清零 save 包 try/catch + **一次性 warn per session**（「could not be persisted … a stateful reload may re-deliver」）——留痕供操作者识别重复来源；内存计数已清零（当前进程保持新段）。
- **V7-14 [P2] 核验结论：不修（判据推翻）**：报告按 0.3.39 语义（fire 即归零）静态推演「已到期的 skill 被覆盖/复位」；0.3.40 的 `resetOnFire:false` 使**先到期域计数持续超标**——后到域到期时 `advanceReview` 必返回 `combined`（涵盖两域），latch 单槽覆盖终被 combined 兜住；「纯 kind 覆盖另一到期 kind」与「单 kind 交付 + 另一域已到期」在持续 due 语义下**不可达**。单槽的「越晚越贴近当前相关性」注释语义（0.3.38）保持。**防过度修复不做结构改动**；未实跑（逻辑推演 + 全部源码实证）。
- **测试**：V7-03 判别（subagent 成功 → 通知走 followup、inject 零——onFollowup/onInject 分叉断言）；V7-04 判别（fixture `failSaveFrom:2`——交付前 save 成功、交付后清零 save 抛 → 交付 1 次 + warn 文本命中）；review.spec 25/25 + lifecycle/anchored-smoke/persistence-resume 6/6（通知相关既有用例 G4.4/V6-24/V4-21 因 fixture followup 桥接 onInject 保持断言兼容）。
- **回归**：oxlint 0/0（194 文件）；tsc 0（review --force）；全量（结果以本版 CI Linux 为准）。

## 0.3.41 (patch) — v7 审计轮第一批：V7-01 发布链 P1 + V7-02 审查自激循环（P2）

**来源**：v7 审计报告（`dsh-evolution-mirror-audit-report-v7.md`）核验轮——全部 20 项新发现经主审亲核 + 只读子代理交叉验证**全部属实，0 误判**；本版交付第一批（P1 + 发散性 P2）。

- **V7-01 [P1·发布链修复自身失效]**：V6-48 把 `cmd.exe /c npm` 换成 `npm.cmd` 直启（shell:false）——Node ≥18.20/20.12/22 的 CVE-2024-27980 加固使无 shell 的 `.cmd` spawn 必抛 EINVAL（本机 Node 26 实测复现；同仓 install-layered.mjs:243 注释早已自认「spawn of npm.cmd is blocked on Windows (EINVAL)」——V6-48 未做同仓知识检索）。**修复**：`publish-scoped.mjs` 解析 npm CLI 入口（候选：APPDATA 独立安装 / node.exe 旁 bundnode_modules / Program Files\nodejs——本机三候选均在），用 **node 直启 npm-cli.js**——execFileSync 保持无 shell：tarball 路径含空格不再被重分词（V6-48 的原始动机同时保全）且无 `.cmd` spawn 面；候选全缺则 fail-loud。**实跑取证**：`node npm-cli.js --version`（12.0.2）+ 含空格 cache 路径参数 `npm view` 成功（重分词 canary）+ 旧形态对照 EINVAL。
- **V7-02 [P2·状态机]**：0.3.40 唤醒式注入在 `interval=1` 下可自激成「审查→新轮→再审查」无界循环——五环节全部源码实证：① 上游 agent.ts:283 把 followup 消息 append 为 `user/message` 无来源过滤；② observeEvent 无条件累计（MEMORY_REVIEW_PROMPT ≈474 字符 ≥ substantiveMinUserChars 默认 200）；③ flush 交付后清零（resetOnFire:false）→ 注入轮从 0 起；④ interval schema/clamp 均允许 1；⑤ 注入轮 completed → `pendingKind = latch ?? kind` 再 flush 再 followup。**修复**：`skipNextCadenceFire` 一次旗标——deliverReview 走 **followup 分支**时 set；下一个 turn/end 的 cadence **fire 抑制一次**（计数照常累计——同轮混入的真实用户内容不丢失；下真实轮正常再触发）；inject 降级/非唤醒路径不 set（无新轮无需抑制）。旗标并入死会话 sweep（P1-10 同款）与 pending 表同域；in-memory（重启清 inbox 队列，循环无法存活）。
- **测试**：V7-02 判别用例（interval=1 + followup：turn1 真实轮注入恰一次 → turn2 唤醒轮被抑制（无 skip 则二次注入）→ turn3 真实轮再注入——三断言区分循环/抑制/再仲裁）；F-102 适配（subagent abort → fallback 唤醒交付 → 唤醒轮被抑制 → 下一**真实**轮 spawn 成功——单飞复位语义保持，断言补一轮）；review.spec 23/23 + lifecycle/anchored-smoke/persistence-resume 6/6。
- **回归**：全量 736 中 730+ 绿、失败 6 例全为已知 Windows 负载 flake 族（guard/inject-paths 5s 子进程超时、ENOTEMPTY 临时目录竞态）隔离复跑全绿；oxlint 0/0；tsc 0（review/core --force）。

## 0.3.40 (patch) — V6-27 真 Session 对象修复 + 计数注入时清零 + 唤醒式审查注入（followup）

**用户决策**：① 审查注入改**唤醒式**——`agent.followup`（= next-turn + 唤醒，空闲驱动立即开新轮）替代非唤醒 `inject`（pending 至下一驱动点）：任务结束瞬间大模型立刻开始总结任务；② 计数窗口改为「注入→注入」——阈值命中不再归零（`resetOnFire:false`），flush 注入时清零重计（续聊从新段起点计算）；③ 段内阈值多次命中只注入一次（session 级 latch 保持）。

- **V6-27 【真缺陷修复】approval 平台形状 TypeError**：平台 `user-approval` 的 `overrideOf(session: Session)` 无守卫读 `session.events`（`user-approval` 真实实现 `effectiveApprovalPolicy(session.events)` 即 `undefined.length`——逐字重放实证）；历史传参 `sessionId` 字符串在**启用 approval 的部署上 request() 必崩**（默认 `enabled=false` 使其潜伏）。修复：`ApprovalRequest` 增 `session?: Session`，三调用面（review/approval-precheck？—— 实为 review runApproved/tool-memory/tool-skill-manage）随 `exec.agent.session` 透传**真对象**；`deriveSessionPolicy(sessionId?, session?)` **无 session 对象不再探测**（字符串永不进入 `overrideOf`）；无 session 时配置链 `config.policy ?? 'ask'` 兜底。
- **【核心】计数窗口 = 注入时刻**：`advanceReview` 增 `resetOnFire?:boolean`（默认 true 保留既有语义；review 传 false 使计数跨阈值单调累计）——阈值命中不再清零；flush 执行注入后 `turnsSinceMemory/turnsSinceSkill=0` 并 `saveReviewState`（续聊从注入点重计，下段不误触发）。完成轮命中（latch 空 + 本轮 fire）经 `pendingKind = latch ?? kind` 兜入 flush（不再像 0.3.39 那样完成轮命中丢失）。
- **【核心】唤醒式注入**：`deliverReview` 优先 `agent.followup(message)`（平台语义：next-turn + 唤醒；`source:{kind:'plugin',plugin:'dsh-evolution-review'}` 合法唤醒源），无 followup 的宿主降级 `inject`（`reviewWakeInject` 默认 true，显式 false 走 inject）。
- **平台事实（核验，写入文档口径）**：`send()` 原语按 (target×wakeup) 路由；`agent.followup(msg)`= next-turn+唤醒（**无完成句柄**——message id 标识领取/丢弃事实）；`agent.inject(msg)`= next-step 不唤醒；`agent.steer(msg)`= next-step+唤醒。followup 在 turn/end 后唤醒=新 turn 开始（agent-loop idle 的 followup/steer 先例）。
- **测试**：V6-27 平台形状桩回归（mock `overrideOf` 逐字节重放真实 shape：读 `session.events` 无守卫 + 调用记录断言 session **对象**传入、无 session 时不探测）；计数/latch stateful 用例（interval=2 全序列：段内 fire×2 零注入 → 完成轮注入恰一次 → 注入后清零（下一段 silent）→ 新段再触发——七轮断言）；`reviewWakeInject` 默认 followup 判别（onFollowup 收到、onInject 零）+ no-followup 降级 inject；既有九条两段流用例 turn1 改段内轮（blocked）+ turn2 完成轮 flush（0.3.40 完成轮命中即注入语义）。
- **回归**：全量 vitest（735 全绿 731 + 4 已知 Windows 负载 flake 隔离复跑全绿，CI Linux 为准）；oxlint 0/0；包级 tsc 0。

## 0.3.39 (patch) — 审查全通道延迟化 + 默认 trigger 收敛（V6-53 follow-up）

**用户决策**：不仅注入，**子代理执行也在任务完成后进行**（平台机制：`subagents.start` = 唤醒式子代理（立即驱动、立即生成），`agent.inject` = 非唤醒式（pending 至下一驱动点）——0.3.38 只延迟了注入回退，subagent 仍在阈值命中即跑）。且 `'cadence'` 与 `'completion'` 在结尾注入时机重叠 → 默认 `'both'` 无意义。

- **两通道统一延迟（核心）**：cadence 阈值命中 → **只暂存 kind（0 执行：不 spawn、不注入）**；`turn/end` 且 `reason.kind==='completed'`（平台语义：turn 正常完成——`aborted/blocked/error/max-tokens/interrupted` 均不算）时统一执行：
  - `reviewMode='subagent'`（默认）→ 此时才 `subagents.start` 跑审查（子代理失败 → fallback 在结尾注入——已无更晚边界）；
  - 显式 `'inject'` → 此时才注入（**原「立即注入」契约被取代**：BOTH 模式都按用户定案在任务完成后执行）。
  - flush 先于 cadence 暂存块（完成轮本身可能同时是阈值触发轮）。
- **默认 `skillReviewTrigger='completion'` 无需，改为默认 `'cadence'`**：0.3.38 后 cadence 的延迟执行即「结尾总结」，`'both'` 会在同一边界再注入一次 task-complete 提示词（双注入）；completion 通道保留为显式可选（`'completion'`/`'both'` 部署行为不变）。
- **平台事实（核验，写入文档口径）**：`TurnEndReasonMap` = `completed / aborted / blocked / error / max-tokens / interrupted`（可合并扩展）；无会话级结束事件——「任务结尾」只能从 turn/end reason 派生；`agent.inject` 为 non-waking（结束瞬间不会自动开新模型轮——总结在**下一驱动点**执行，用户不再回复则保持 pending 不消费）。
- **计数口径**：cadence 内部计数 `turnsSince*` 阈值即归零（滚动等窗口——每次触发标准与首次相同）；completion 通道的 20 次门槛用会话累计（无重置）；延迟 flush 不叠加 20 门（阈值已证值得审）。
- **测试**：E-19/E-59c/E-41/F-203/G4.4/V4-21/F-102/V6-24/lifecycle 九条按两段流重写（turn1 暂存零执行 + turn2 flush 执行）+ 默认断言 'both'→'cadence'；新 E-19 变体断言「多个阈值命中 = 一次 flush 执行、单飞行保持」。
- **回归**：全量 vitest（本机并行已知 Windows 负载 flake 隔离复跑全绿，CI Linux 为准）；oxlint 0/0；包级 tsc 0。

## 0.3.38 (patch) — 审查注入延迟化 + v6 M5 收口挂账清点

**背景（用户报告）**：auto-review 提示词在中途注入打断任务（且注入同时使主对话前缀缓存从该轮起全部失效）。核验发现的真相：**`skillReviewTrigger` 只门控 completion 通道**；中途注入的唯一来源 = cadence 通道在回退路径（子代理不可用/单飞行/失败/子代理无结构化计划）下的立即 `agent.inject`——阈值检测逻辑本身无问题，需要改的是「注入时机」。

- **【核心】cadence 回退延迟注入化**：默认（`reviewMode='subagent'`）下，回退不再立即注入——审查按 session 暂存（`pendingCadenceReviews`，同一 session 最后一次触发覆盖前次——越晚越贴近当前相关性；warn 每 session 一次），**在对话结束（turn/end reason=completed）时注入**；延迟审查经阈值触发已证明值得审，故 flush 不叠加 completion 通道的 20 次调用门（两者并存、各司其职：延迟审查=阈值分析，completion=任务完成专属提示词）。显式 `reviewMode:'inject'` 部署保留原立即注入契约（显式自选不受默认变更影响）——**superseded by 0.3.39**（0.3.39 起两通道均在任务完成后执行，显式 inject 也不立即注入；本句不再准确）。flush 置于 cadence 块**之前**（完成轮本身可能是 cadence 触发轮——置后则永不到达）；暂存表并入死会话 sweep（P1-10 同款）。**效果：默认部署全程零中途注入——打断与主前缀缓存污染同灭；阈值检测与末尾注入并存**（用户设计的「照常触发、延后注入」落地；`skillReviewTrigger` 默认保持 `'both'` 不再需要改）。
- **验证**：E-59c/E-41/lifecycle 三条原「fallback 立即注入」断言改为「无即时注入+延迟」；新用例 V6-53（子代理失败→turn1 零注入 → turn2 结束时注入且仅一次——stateless 夹具下 interval=1 逐轮触发、flush 前置于 cadence 块的设计被该用例钉住；首次实现 flaky 根因=夹具 state 每轮重建 + flush 位置，均已修正）。
- **v6 M5 收口**：T.1 余项已在 0.3.37 完成（threats 实计 26、prompts 标题 v14、V5-03 mtime 回归）；**审计挂账清点（按「不修申报项」口径维持，防口径漂移）**：F-328（完整 hash）、G4.8/N-2（上游平台议题）、F-309/310/311/354（脚本层申报）、capability 接线声明——全部维持挂账，不在修复范围。
- **回归**：全量 vitest（本机并行已知 Windows 负载 flake 隔离复跑全绿，CI Linux 为准）；oxlint 0/0；包级 tsc 0。

## 0.3.37 (patch) — v6 审计 M4：契约对齐与发布卫生（V6-16~52 大项 + T.1 余项）

v6 审计（0.3.33 全量复审轮）M4 里程碑（最后一批实质项；M5 收口随本版）；每项先核验属实再修。**行为/契约变更声明**：V6-26（缺省 action 归一为显式 patch）、V6-27（部署级 `config.policy='never'` 在 request() 内生效——此前静默 staged 堆积）、V6-25（enum 外 action fail-loud——此前静默按 replace 执行）、V6-45（发布包移除失效 `./src/*` 导出子路径——全仓零消费已证）。

- **V6-16 [P3]**：MemoryStore 补进程内 serial 队列（SkillLibrary 同款）——无 transact 自定义后端上的同进程并发 RMW 裸 read→write 丢更新；add/applyBatch 走队列链（node 后端跨进程锁不变）。
- **V6-17 [P3]**：patch 的 fuzzy 扫描 O(n·m) 无输入上限（实测 20k×20k 6.1s 阻塞事件循环）→ 非精确锚超预算（>4096 字符或 n·m > 8M）显式拒绝「too large for fuzzy match」；精确命中走快路径仍放行。
- **V6-19 [P3]**：runSingleWrite 对 transact 契约违规（task 未被调用）返回结构化错误（原无条件解引用 TypeError）；带「write 字段」形状守卫。
- **V6-20 [P3]**：parseUsage 顶层 Array 拒绝（原 `Object.entries([…])` 产生 "0"/"1" 幻影技能记录并被 RMW 持久化）——与其他入口的 shape 防御补齐。
- **V6-21 [P3]**：signals 的 assistant/message 分支补 content 数组守卫（E-49 只修了 user 半边；malformed assistant content 曾 TypeError 且被 review catch 吞掉整个 turn 的信号）。
- **V6-25 [P3]**：applyBatchCore 对 enum 外 action（'Add'/'upsert' 等）显式 fail-loud（原带 old_text 时**静默按 replace 执行**且 ok:true——语义漂移）；空 operations 的 approval 前置拒绝在 tool-memory 层已有（applyBatch 自身早已返回 ok:false）。**行为契约变更**。
- **V6-26 [P3]**：缺省 action 归一——plan-validator 接受的 skill op 一律带显式 action（缺省 → 'patch'）；review 的 filterUnreadSkillOps 删除 `!== undefined` 前置条件（缺省 action 的未读技能不再靠下游"Unknown skill action"兜底逃过滤网）。**行为契约变更**。
- **V6-27 [P3]**：approval 的 deriveSessionPolicy 补有效取值链 `overrideOf ?? config.policy ?? 'ask'`（与导出的 effectiveSessionPolicy 同口径——部署级 `policy:'never'` + 无会话 override 时写不再被 staged 堆积，方向 fail-closed 不变）。**行为契约变更**。
- **V6-43 [P3]**：skill-usage 的 `session/event` 监听器改 `ctx.effect` 登记（家族 tool-memory/skill-catalog 惯用——插件卸载/重装不再残留无主观察者；HMR 归属测试钉住）。
- **V6-44 [P3]**：`invalidate()` 与 `MemoryRegistry.snapshot()` 标注 test-support API（无生产消费方，按声明保留）。
- **V6-45 [P3]**：30 包 package.json 移除 `"./src/*"` 导出（发布产物无 src——该子路径必然 404；全仓零 `@deepseek-ai/dsh-evolution-*/src/` 导入已 grep 实证）。**行为契约变更（发布面收紧）**。
- **V6-46 [P3]**：verify-event-pairing 的 EMIT_RE 同步 `\w*[Cc]tx`（V5-01 只修了 ON 侧——ioCtx.emit 形态生产者对守卫自身盲区；哨兵用例新增 ioCtx.emit 负例）。
- **V6-47 [P3]**：normalize-mirror 无 `## x.y.z` 标题时 **fail-loud exit 1**（原安全回退 '0.1.0-rc.1' 会把 31 个 manifest 版本全部降级改写——一次格式漂移即版本回退事故）。
- **V6-48 [P3]**：publish-scoped Windows 分支弃 `cmd.exe /c`（重新分词——含空格的绝对路径被斩断）改 `npm.cmd` shell:false（仅本地手动 publish 路径）。
- **V6-49 [P3]**：install-layered 的 install() 安装前检查同 profile 已有另一 bundle（host ⇄ preset 互斥）→ fail-loud（文档警告不是 enforcement——工具自身曾能把文档化事故变成现实）；`DSH_EVOLUTION_ALLOW_ROW_COLLISIONS` 不豁免（互斥是安装面语义）；dry-run 不查（幻影 profile 无真实状态）。
- **V6-50 [P3]**：prepare-release 未用 spawnSync 导入删除；install-layered `=== prefix` 被 startsWith 覆盖的冗余分支删除。
- **V6-51 [P3]**：install-layered Windows APPDATA 未设时跳过该候选根（原 `join('', …)` 得 CWD 相对路径进入 existsSync 探测）。
- **V6-52 [P3]**：agent.cordis.yml 头注释「agent/layered/oneclick modes」→ 实际两模式（oneclick 装 preset bundle 行不写该文件）；evolution-all 注释补第 5 项依赖（evolution-agent-preset）。
- **V6-22/30/31/32 [P3]（state-json 残余边界）**：appendArchive 折叠发生且无新增时也落盘（磁盘残留自愈）；enforceResolvedCap 逐出按 **entry 键集**（同 id 双 entry 不再过逐出/漏归档——每条逐出必对应归档）；readArchivedIds 并入 `.bak` 键集（轮转后的旧 id 仍是幽灵排除依据）；jsonTransact 注释与 transact-guard/transact.spec 用例名「null = keep」→「null = ensure-absent」（文件存在即删除——与 seam 行为一致；provider 状态层 null=keep 语义不变，两层注释已区分）。
- **V6-33 [P3]**：state-domain 的 claim/tryResolve 返回值浅拷贝（json provider 副本口径——调用方就地修改不再无声明污染 domain 内存 map）。
- **V6-34/37 [P3]（口径小项）**：skill-health softBodyChars 注释对齐实现（>= 即 warn）；saveUsage 补 doc-comment「whole-file write，绕过 malformed 防御与 transact——prefer mutateUsage」（生产引用 0，保留为测试播种）。
- **T.1 余项**：threats.spec 注释「28 patterns」→ 实计 26；prompts.spec 用例标题 v13 → v14（PROMPT_BUNDLE_VERSION 0.3.30 已升）；io.spec 补 V5-03 noop 短路直接回归（stat mtime 不变断言）。
- **回归**：全量 vitest（本机并行下已知 Windows 负载 flake 隔离复跑全绿；CI Linux 为准）；oxlint 0/0（194 文件，首跑 3 差全为我改动区的 no-unnecessary-condition——按「unknown 先守卫」手法修正）；包级 tsc 0；mjs `node --check` 全过。

## 0.3.36 (patch) — v6 审计 M3：观测与治理精度（V6-10/15/23/24/28/29/35/36/38/41/42/08/09）

v6 审计（0.3.33 全量复审轮）M3 里程碑；每项先核验属实再修（全部 12 项经源码复读确认——其中 V4-26 的「字段内嵌独立 Notes: 行」为残余真实缺陷、V6-09 的 `.catch(()=>[])` 与 V5-20「不再静默」声明相抵）。

- **V6-10 [P3] 失败可观测闭环（activity/replay）**：V5-19① 的事件维度是「半接线」——`EvolutionActivityRecord` 折叠白名单与 `ReplayPlan`/`record()` 都丢弃 `executionFailures`/`executionError`，全执行失败的 plan 在持久观测与 replay 记分中呈现为「0/0 干净空计划」。修复：activity 记录/折叠保留两字段（旧 sidecar 缺字段按缺失读取）；replay 入 record、记分板报表追加 `N failed(: 原因)`（历史/测试构造的 plan 无该字段按 0 显示——可选字段兼容）。
- **V6-15 [P3] writeSupportFile noop 纪律**：对同一支持文件重复写相同内容时 IO 层被 V5-03 物理短路，但 audit、mutation event 与 tool 侧 patch_count 照涨（update/patch/memory-add 的同根收敛漏了 write_file）。修复：`writeSupportFileCore` 字节等同（trimEnd 归一，update 同款判定）→ `noop: true, write: null`——`runSingleWrite` 既有 write:null 语义自动跳过 audit/event；tool-skill-manage 既有 `result.noop !== true` 门自动不计数。
- **V6-23 [P3] onTurnEnd catch 内 review-error 裸奔**：turn-end 失败路径的 `ctx.emit('evolution/review-error')` 无保护域（cordis emit 同步直呼监听器——抛错监听器变 unhandledRejection，V5-19③ 同类漏网）；与 trySubagentReview 内已保护的 emit 对齐：包 try/catch + warn。
- **V6-24 [P3] 零落地计划对模型零反馈**：`if (actions.length > 0)` 门使全部 op 被 stage/拒绝/吞跳的 plan 无任何 inject——「部分失败有通知、全失败无反馈」不对称。修复：零落地也 inject「0 ops landed + 原因摘要（validation 拒绝数 / 未读跳过数 / 执行失败数+细节 / abort）/ 500 字符预算」，与已落地通知同通道。
- **V6-28 [P3] atomicWriteFiles commit 段 rmSync 裸露**：rename 与 unlink 常同因 EPERM/EBUSY 双败——rm 抛错穿透外层 catch，`already committed` 披露链整条丢失（node 实测 T4: discloses? false）。修复：rmSync 包 try/catch，失败消息携带 `already committed: ...` 披露（部分安装对操作者可见）。
- **V6-29 [P3] maintain timeout 缺域上界**：`--timeout 5000000000` 超 `AbortSignal.timeout` 上限（2^32-1）同步 RangeError，被外层 catch 转译不崩溃但校验缺域。修复：命令门 + `runMaintain` 双处校验（≤ 4294967295，显式拒绝消息）。
- **V6-35 [P3] lenient 提名解析器两处静默语义丢失**：`mode:` 出现在 `into:`（或 from）之后被静默丢弃（demote 降级为 append）与 `- name:` 在 consolidations 段内使 section 翻转为 prunings（名变归档提名）。修复：`CuratorNominations` 增 `warnings`（解析器**补 YAML 段标题行跟踪**以区分「prunings 段正常首行」与「真错位」——首次实现曾误告警 canonical 形状，自测抓出）；warning 流经 recommend → run report 新字段 `nominationsWarnings`（build/render 同步），归因对操作者可见、解析保持 lenient。
- **V6-36 [P3] computeScopeView 漏 builtin 桶**：`PROTECTED_BUILTIN_SKILLS`（'plan'）命中被共享门挡下却不在 exempted/protected/managed 任何桶——视图少一个解释维度、「视图总能预测 curator 可触碰」承诺破口。修复：builtin 归 protected 桶；`/evolution curator scope` 标签补 `/ builtin`。
- **V6-38 [P3] 字段内嵌独立 Notes: 行仍截断**：V4-26 的 standalone-header 匹配对「finding 值自带 `\nNotes:\n`」仍提前截断（node 实测 2 条建议计 1）。修复：`formatPlan` 渲染前对 finding/recommendation **字段值预处理**（内嵌独立 `Notes:` 行改写为 `> Notes: (inside the field above)`）——渲染层不可能再把它当段头。
- **V6-41 [P3] mutations/curator report 无防崩加固**：`curator status` 有显式姿态而这两处无——形状受损的审计/报告文件让命令抛未捕获 TypeError。修复：raw 数据先降 unknown 再形状守卫（Array.isArray / typeof 校验，损坏行丢弃或「Report file unreadable.」）；**注**：守卫直接写类型化数组上会触发 oxlint no-unnecessary-condition（声明类型已非空）——先 `const records: unknown = ...` 是正确形态。
- **V6-42 [P3] atomicWriteFiles 重复 name 自我指涉**：第二次 rename ENOENT → rm 掉刚提交的新文件 → 从 .bak 恢复旧内容、报错自我指涉。修复：入口唯一性校验 fail-loud（`duplicate input names: ...`）。
- **V6-08 [P3] stamp 探针前缀匹配兄弟技能假阳性**：`.archive` 枚举 `entry.startsWith(\`${name}-\`)` 命中 bundled 兄弟（`foo-bar-<stamp>`）→ 崩溃归档的非 bundled `foo` 被假阳性 suppression（日后同名重建静默脱离生命周期门）。修复：按 skill-store 归档命名的**精确形态**匹配（`^<name>-\d{14}(-[0-9a-z]{1,6})?$`——名称字符集保证锚点无需转义）+ 命中后 frontmatter 名称复核（E-3 先例；**SKILL.md 缺失时不复核**——崩溃态 marker 保持为信号，缺失正文不得反向漏 suppression，delta 复核发现的收紧）。
- **V6-09 [P3] `.archive` 枚举失败仍静默**：`.catch(() => [])` 把失败降级为「非 bundled」（与 V5-20「probe 失败 warn 不再静默」声明相抵，exists 抛错有 warn、list 抛错没有）。修复：去掉内联 catch，让失败流入外层 probe catch 统一 warn。
- **回归**：全量 vitest **717**（+12 新用例：V6-10×2 / V6-15 / V6-23 / V6-24 / V6-28 / V6-29×1 命令门+orchestrate / V6-35 / V6-36 / V6-38×2 / V6-41 / V6-42；curator.spec 两处 recommend 断言补 warnings）；oxlint 0/0（194 文件）；包级 tsc 0；本机并行下 5 例已知 Windows 负载 flake（guard 5s 超时 / ENOTEMPTY×3 / 32-way 预算边缘）隔离复跑全绿——以 CI Linux 为准。

## 0.3.35 (patch) — v6 审计 M2：并发自愈与配置防御（V6-04/05/06/18/39/40）

v6 审计（0.3.33 全量复审轮）M2 里程碑；每项先核验属实再修（全部 6 项均经源码复读确认：V6-04/18 的「空体锁/票永久锁死」、V6-05 的扫描窗口悬崖为确定性缺陷，V6-06/39/40 为配置/口径穿透）。

- **V6-04 [P2] 空体锁/空体票的永久锁死闭环**：
  - 建锁路径改为显式 `open('wx')` + 独立写体——**仅当本轮创建成功打开过文件**（`lockHandle` 非空）时，写/关闭阶段的失败先关闭并 `rm` 自身残留再 throw（O_EXCL 保证该文件属于本轮；此前 `writeFile('wx')` 在打开后的失败会留下 0 字节/半体锁，其体永不通过 pid 探针 → 接管永不触发 → 该路径所有后续写者 40 次预算耗尽后永久 fail-loud）。
  - 接管条件扩展「**空体死锁**」（创建者死于 open 与写体之间）——空体无 pid 可探测，仅在 mtime > 1s（与接管阈值同值）时按死锁接管：在途创建者写体紧跟 open，>1s 无体即已死/挂起；1s 门防误删并行创建中的活锁。接管仍走单一执行门（`current === holderContent` 重读 + 票协议，BOTH 形态共用）。
  - 空体 `.next` 票回收——`:290` 的 `ticketBody !== ''` 门放宽为「体非空走旧票规则 ∪ 空体且 mtime > 1s」：空体票此前永不被回收（空体 → pid 解析 0 → 旧「stale 且非空」门恒假）→ `writeFile(ticket,'wx')` 永远 EEXIST → 每次接管 40 次预算耗尽。**评审补强**：票错回收代价=接管者重试一轮；票无持有权（与「锁体 mtime 启发式」被 V4-05 证伪的本质区别——票回收不产生第二持有者）。
- **V6-18 [P3] sweep 覆盖接管票残留**：`sweepStaleTmps` 的匹配集合从仅 `.tmp` 扩展为「`.tmp` + `<base>.lock.next`」；`<base>.lock` 明确跳过（sweep 运行于已持锁内部——该文件即本轮活锁，匹配=自杀）。票回收语义与逐次接管路径一致（死 pid 或 >1s 旧票；空体仅按年龄回收）。崩溃接管者留下的票此前只靠「下一次接管」顺带清，无人撮合则永存。
- **V6-05 [P2] threats 扫描窗口下限与步长回退**：
  - `clampedNumber` 下限从 `{min:1}` 提为 `PATTERN_OVERLAP + 1`（4097）——0.3.16 的「不成文约束」显式化；小于下界的值回退默认 65_536。
  - `step` 改为**比例步长** `Math.max(Math.floor(windowSize/2), 1)`；任意合法窗口值下重叠 = `ceil(w/2)` ≥ 2049 > 最长模式跨窗 span（~530 字符，E-12 覆盖注记同步），全文本覆盖保证不变；扫描代价 O(n×2) 而非 O(n×w)（旧式 w≤4096 时 step 塌缩为 1——108KB 文本 4096 窗口实测 **5829ms**，修复后回落到个位毫秒）。
  - evolution-threat：schema `.min(PATTERN_OVERLAP + 1)` + `resolveMaxScanChars` 同步下限；README 声明合法区间（`z.number()` 仍放行 NaN/±Infinity，由装配钳制兜底）。
- **V6-06 [P2] 数值配置全部接入 clampedNumber 管道**：tool-skill-manage 的 maxSkillNameLength/maxDescriptionLength/maxSkillContentChars/maxSkillFileBytes 与 tool-memory 的 entryPreviewChars 从 `?? default` 改为装配期 `clampedNumber(…, {min:1})` + 一次性 warn（G3.1 同款——NaN/±Infinity 穿透 bare number schema 后 `limit > NaN` 恒假 → 沉默解除限长防线；entryPreviewChars NaN → `slice(0, NaN)` 空预览且 `slice(0,负)` 语义反转）。schemastery `.min(1)` 保留为装载期第一道；合法值行为零变化。
- **V6-39 [P3] feedback path 空白串穿透**：`rawConfig.path || undefined` 把 truthy 的 `'   '` 当路径（写 CWD 相对空白文件名）→ `(rawConfig.path ?? '').trim() || undefined`（V5-11 同式）。
- **V6-40 [P3] feedback 移除 qualityWired 一次性旗标**：`ctx.inject(['skillUsage'])` 在依赖被**替换**时重跑回调（cordis fiber 源码实证：epoch 按依赖 `impl.fiber.uid` 计算，提供方 fiber 变更即重装）——旗标使重挂后的新实例得不到接线（推送持续进入已卸载实例的闭包）。移除后每次重跑重包 `feedback.record`/`onRollback`（`baseRecord` 绑定位置保证幂等——重包是赋值替换、不叠加）。
- **回归**：全量 vitest **701/701**（+10：io 空体锁自愈/空体票回收/sweep 票回收与保留 ×4、threats 覆盖下限与性能 ×2、skill-manage NaN、tool-memory NaN、feedback 重挂接线/path trim ×2；threat-guard 矩阵更新）；oxlint 0/0（194 文件）；tsc 0；32-way 票压测 ×3 稳定 0 丢；本机并行下 2 例已知 Windows 负载 flake（guard 脚本 5s 超时、ENOTEMPTY 清理竞态）隔离复跑全绿——以 CI Linux 为准。

## 0.3.34 (patch) — v6 审计 M1：数据与安装正确性（V6-01/02/03/07 + V5-23 用例）

v6 审计（0.3.33 全量复审轮）M1 里程碑；每项先核验属实再修（V6-01/02 均为 v6 报告的确定性/高置信发现，主审复读确认）。

- **V6-01 [P1] 退休过滤被四条写路径绕过——根除**：savePending/claimPending/releasePendingClaim/tryResolvePending 的内层 legacy 合并此前**不带归档排除**——升级后首个状态操作若是 mutation（review staging 先于任何 list、操作员直接 `/approve`），归档集中的幽灵 pending 双胞胎会被写进活 map 并**永久化**（此后退休的 `id in current` 跳过使其不可再剔除）→ 可 claim → 重放数月前 staged args（V5-02 宣称根除的危害经修复自身写路径重新可达）。修复：提取**单源** `mergedWithFilteredLegacy`（`readArchivedIds` 缓存一次 + `filterLegacy` 双排除——与退休读路径同一逻辑），四路 mutation 全部改走该 merge；注释「merge result is identical anyway」随之删除（过滤存在后该叙述不成立）。
- **V6-02 [P2] 退休 transact 锁内参数**：`retireLegacyOnce` 的合并任务改用 `(fresh) => ({ ...retired, ...(fresh ?? {}) })`——此前零参闭包捕获锁外快照，跨进程并发写（进程 A 在 B 的退休窗口落盘 staged/approved）会被陈旧快照整文件覆盖（Y 消失 or X 从 approved 回退 pending → 可再 claim）。current-wins 语义不变、retired 仅补缺。
- **收敛记录**：V6-01 的「mutation 先于 list」场景同时是 0.3.29 V5-02 修复的真实遗漏——本批以确定性用例钉死（savePending 先行 → current 无幽灵 + claim null）；V6-02 依赖跨进程并发（单进程用例不可构造），以锁内参数语义 + 代码评审在案。
- **V6-03 [P1] 安装文档**：INSTALL.md §5 删除「手工拷贝 `evolution-agent/` 到 `.agent-presets/evolution/`」指引——该文件是 DELTA-only（4 个模型工具行），上游 agent-presets discovery 把发现的 `agent.cordis.yml` 当**完整装配**原样挂载（无 standard 合并）——按文档操作的生产会话只挂 4 行、丢失 standard 全部行。改为「装配经 install-layered 或 `dsh plugin add` 生成；手工路径仅允许拷贝 standard+delta 合成产物」。
- **V6-07 [P2] 中文文档**：README.zh.md 的 review 子代理允许列表仍写 `skill、skill_search、skill_load`（英文面 0.3.28/0.3.32 已修、中文漏改——V5-24/25 的镜像文档）→ 改为 `skill`（DSH 平台目录只存在 plain `skill`）。
- **T.1(1) 判别力用例 + 实现修正**：V5-23（0.3.32）首次补专项用例时发现实现缺陷——**精确拼写（`Foo`）也被歧义误拒**（lowercase 后命中歧义键）→ 修正：`spellingsByName` 按拼写集合判定——精确拼写恒合法、单拼写保留 canonical 归一、多拼写键的非精确形式才 fail-loud「use the exact spelling」（用例：`FOO` 拒绝、`Foo` 通过）。
- **回归**：全量 vitest **690/690**（+2：V6-01 用例子集 + V5-23 双用例）；oxlint 0/0；tsc 0。

## 0.3.33 (patch) — v5 审计补修：归档既有重复清理（V5-07 残余）

v5 审计 0.3.32 收口后的**复核轮**（逐项检查「已修项是否真实到位」）；发现并补修唯一真实遗留。

- **V5-07 残余补修**：0.3.32 收口时 V5-07 按「随 V5-02 legacy 退休收敛」登记——但复核查证：**档案内「既有重复条目」**（去重键引入前的历史重复，`id+status+resolvedAt` 相同）仍占用 5000 cap 且永不清理 → appendArchive 加载时按去重键**折叠重复**（首见保留，best-effort；`.bak` 可能仍含，审计允许落后）；新增「collapses historical duplicates」回归用例。
- **复核轮三档结论**（详见 release-log）：v5 全部 35 项——已修复 34 · 非缺陷/以核验销案 1（V4-38 口径争议——家族无 CONTRIBUTING 文件，口径以 v4/v5 核验结论记录为准）· 0.3.32 真遗留 1（V5-07，本轮补修）；残余记录（V5-04 的 `.takeover-*` 已被 0.3.29 ticket 协议淘汰；V5-08 的「不重写」已由 V5-03 短路实现）。
- **回归**：全量 vitest **689/689**（+1）；oxlint 0/0；tsc 0。

## 0.3.32 (patch) — v5 审计批 4（收口）：口径/文档与残余窗口（V5-06/11/12/20/23/24/25/27/31/35）

v5 审计（0.3.28 修复核验轮）批次 4（口径/文档失实 + 残余窗口），v5 审计**收口版**；每项先核验属实再修。

- **V5-06**：memory-store 批量 threat 拒绝（add/replace 两条）补齐 `current-entries` 预览——与同函数其余全部失败路径一致（V4-49 消息统一收尾）。
- **V5-11**：memory-files 的 whitespace-only `root` 穿透（`config.root ?` 不 trim → CWD 相对根）——V4-09 同类第三处（state-json/maintenance 已修）→ trim 后与空串同落地默认根。
- **V5-12**：state-json README 并发声明与实现相反（「cross-process locking is a storage-layer limitation」——本 provider 每次变更都走 transactIo 跨进程锁）→ 声明改为「进程内 + IO 后端跨进程锁」如实；「storage-json 无跨进程锁」的 caveat 限定到 domain provider（storage 侧原意保留）。
- **V5-20**：curator 的 bundled marker 探针只查 `.archive/<name>/.bundled`——同名二次归档的 **`<name>-<stamp>[-rand]`** 目的地不识别（bundled 性在两次归档间变化时结论错向；exists 抛错被 `.catch(()=>false)` 静默降级为「非 bundled」→ suppression 不落盘）→ 双形态探针 + probe 失败 warn（不再静默）。
- **V5-23**：validate-plan 的 canonical 归一在 facts 含**仅大小写不同的双名**时 last-wins 塌缩（`Foo`/`foo` 同存时重锚到另一真实技能）→ 歧义键显式 fail-loud（「use the exact spelling」），不再重锚。
- **V5-24**：preset 三处矛盾——①standalone「mount twice」论据改为如实（60-char cap override 由 host 提供、preset 用平台默认；host/preset 互斥不得同装——共享行如 maintenance-tools/session-query 由各自载体自己持有）；②standalone review 行补 `reviewToolAllow: [skill]`（与 overlay/host 字节一致，消除三形态行为差）；③README 的「relies on the base host for the two overrides」改写为逐项事实（preset 自持 session-query override、60-char cap preset-alone 用平台默认并附自行添加指引）。
- **V5-25**：INSTALL.md 的 `reviewToolAllow: [skill, skill_search, skill_load, read]` 示例列平台不存在的 skill_search/skill_load（与 0.3.18 幻影清扫相抵）→ `[skill]` + 注释。
- **V5-27**：threats.ts 注释「All in-repo call sites pass the default」失实（threat 包下传配置派生值）→ 「callers pass valid/clamped values；钳制是第三方调用的保证」。
- **V5-31**：tool-memory 的 `dsh-memory-files` 声明在 peerDependencies 但 src 零 import（仅 3 个 spec 使用）→ 从 peer 删除（测试归属已在 devDependencies）——闭合守卫抓不到的「反向虚增」。
- **V5-35**：core README 并发模型段更新——0.3.27 起构造**默认绑定**后端 transact（update/patch/writeSupportFile/restructure 逐文件入跨进程锁——「current default callers 未注入」叙事过时）；两阶段路径（create 双探针/archive-consolidate rename/restructure 多文件半应用树）如实声明为**文档化残留**而非锁定；顺带修 archive 复制回退的裸 ENOENT（并发归档败者/源消失 → ok:false 如实消息，技能留在原地）。
- **回归**：全量 vitest **688/688**；oxlint 0/0；tsc 0。
- **v5 审计闭环声明**：V5-01~V6 全部批次（1 并发数据完整性 / 2 守卫验证盲区 / 3 失败可观测性 / 4 口径文档）落地（V5-04 已被 0.3.29 的 ticket 协议淘汰；V5-05/07/26 经修复收敛）；剩余挂账同 v5 §5（平台议题 G4.8/N-2、F-328 申报、F-309/310/311/354、capability 接线声明）。

## 0.3.31 (patch) — v5 审计批 3：失败可观测性与发布链卫生（V5-13/14/17/18/19/29/32/33）

v5 审计（0.3.28 修复核验轮）批次 3（失败可观测性 + 发布链卫生）；每项先核验属实再修。

- **V5-19 执行失败可观测性（review 三缺口）**：① `plan-applied` payload 新增 `executionFailures`/`executionError` 维度（`rejectedOps` 只计校验拒绝——消费方不再把执行层失败当成「没有工作发生」；abort 或首个非 throw 失败都会命名）；② `executePlan` 记录每个非 throw 失败（`failedOps`）——任何失败都发 operator warn，**全部落空时更是显式断言**（旧代码零落地完全静默）；③ `plan-applied` 与 `review-error` emit 均移入保护域——同步抛错的监听器不再经外层 catch 把 `started` 翻 false 触发重复注入（V4-21① 封闭形态的换位复发，达性低但同类）。
- **V5-17 多文件部分提交披露**：atomicWriteFiles 的 commit 中途失败现在披露「已落盘文件清单」（`already committed: a, b`——旧代码只报失败文件，调用方把部分安装当「没发生」）；收尾 `.bak` 刷新循环 best-effort per-file（失败 console.warn、**不再把成功安装报成失败、不再中途劈开 bak 对**）。
- **V5-18 approve 归因诚实化**：executing 分支消息改为「并发在途/崩溃后遗留」双归因 + 明确「非你发起的 approve 不要 reject」（旧文案只怪崩溃并指引 reject——跨进程并发时后到者会被误导杀掉在途 approve；reject 侧早有诚实口径，现两侧对齐）。
- **V5-29 feedback 回滚回推**：失败 append 回滚内存计数/note 后，新 `onRollback` 钩子触发——apply 层用它重推 `skillUsage.setQuality`（旧行为：按 rollback 前乐观值推给 usage，usage 侧长期持有从未落盘的分数/quality_warn）。
- **V5-32 warn once 闸**：append 失败 warn 按**失败原因**去重（version-mismatch 类持续拒绝不再随每条 feedback 刷屏——消息含 target 会规避简单去重，故按 cause 键）；家族「进程级一次」模式对齐。
- **V5-33 policy 字符串面 warn**：非法 `reviewMode` 静默落 `'subagent'` 无 warn（数值字段钳制必 warn——字符串面不对称）→ 加入 clamped 列表、走同一条一次性 fallback warn。
- **V5-13/14 发布链卫生**：`atomicSwap` 重跑恢复——中断态（target 缺失、`.previous`=唯一 good copy）在重跑首句被无条件删除的窗口闭合（恢复 `.previous`→target 再走换入）；`.gitignore` 补 `dist.previous/.next`、`.release-staging.previous/.next` 规则（中断残留不再被 `git add -A` 误提交，`git check-ignore` 实测）。
- **回归**：全量 vitest **688/688**（+3：V5-17 部分披露 / V5-29 onRollback / V5-33 reviewMode warn；V5-18/19/32 断言扩展）；oxlint 0/0（194 文件）；tsc 0；mjs --check 过。

## 0.3.30 (patch) — v5 审计批 2：守卫与验证盲区（V5-01/05/15/16/21/22/26/28/30）

v5 审计（0.3.28 修复核验轮）批次 2（守卫/门禁自身与测试精度）；每项先核验属实再修。

- **V5-01 守卫失明根治**：event-pairing 的 `\w*ctx\.on\(` 大小写敏感——ioCtx/commandCtx/approvalCtx/toolCtx 全不匹配（v5 三项 node 实测复现；旧的「0 orphan」报告纯靠 replay 裸 `ctx.on` 兜底）→ 正则改 `\w*[Cc]tx` + 注释如实；**修复后实跑 6 emitted/4 listened/0 orphan/0 dangling——本次 0 orphan 是真实的**（activity 的 ioCtx 消费被计数、与 replay 冗余监听解耦）。
- **V5-15 真空/孤儿 strict 化**：event-pairing 新增 `--strict`（真空扫描 exit 1、orphan/dangling exit 1——与 arch-guards 口径一致）；action.yml 的 CI 调用补 `--strict`；非 strict 保持 WARN 报告形态（README 声明 EXEMPT 语义不变）。
- **V5-16 哨兵补盲**：guard-scripts.spec 新增「emit + `ioCtx.on` → 0 orphan」用例（正是 V5-01 漏网形态——门禁必须覆盖门禁）。
- **V5-26 计数与注释**：CHANGELOG 0.3.28 的「12 包」修正为「13 包」（git stat 实证，state-storage 含入）；verify-arch-guards 与 verify-event-pairing 头注释 Usage 改双布局说明（dev `packages/evolution/scripts/…` / 镜像 `packages/scripts/…`，按字面执行不再失败）。
- **V5-05 prompt 版本履约**：`PROMPT_BUNDLE_VERSION` 13→14（0.3.28 V4-39 语义性修改了 SKILL_REVIEW/COMBINED 文案但未按自订契约升版——混布部署版本层不可区分）；prompts.spec 断言同步。
- **V5-21 F-331 bundled 断言**：curator.spec 的 F-331 用例此前只造 pinned（标题写 pinned/bundled）——补树内 `.bundled` marker 技能 + 「LLM 提名不含 bundled」断言。
- **V5-22 最老淘汰钉死 + 防御对称**：V4-22 用例 seed 报告 mtime 拉开（同秒并列时淘汰对象原本不确定）→ 断言「最老 15 个 error 被淘汰、最新 10 个保留」；curator autoCheck catch 内的 `retainReports()` 补 try/catch（恢复路径唯一裸露调用点——provider 畸形输出的 unhandled rejection 消除，与持久化防御姿势一致）。
- **V5-28 durableNote 主分支用例**：V4-41 此前只测双失败（durable=undefined）——补「note-A 落盘成功 → 事件日志升版 → note-B 失败 → 还原为 note-A（最后已确认）且失败计数回滚」。
- **V5-30 死轮询修正**：activity-store.spec 的 `pollUntil(root,'plan-2')` 永不匹配（emit p1/p2/p3、稳态只剩 p2/p3）——每跑烧满 8s deadline——改 poll 'plan-3'。
- **回归**：全量 vitest **685/685**（+1）；oxlint 0/0；tsc core/curator/host 0；三守卫 strict 全过（closure 30 包 OK / arch strict 0——N4 71 warn-only 保持，+2 为票协议解析的合法 `?? ''` 兜底启发式误报类 / pairing 0 orphan + 真空 exit 1 实测）；mjs --check 过。

## 0.3.29 (patch) — v5 审计批 1：并发与数据完整性（V4-04 残余根治 + V5-02/03/07/08/09/10）

v5 审计（0.3.28 修复核验轮）批次 1（并发与数据完整性）；每项先核验属实再修。**方法论备注**：V4-04 在 v5 中被判「FIXED-VERIFIED」（静态推演不变量 + 6 路用例），但本批以运行压力实跑推翻——**6 路 0 复现、8 路 25% 丢、32 路 94% 丢**（writeFile open→write 空窗锁 + 探测→rename TOCTOU 双持级联）——并发类结论必须以「比生产最坏更坏的压力」验证为准（6 路 0 复现≠无缺陷）。

- **V4-04 残余根治（ticket 预占票接管制）**：接管从「rename 移走死锁」改为 **`<lock>.next` 预占票（O_EXCL 独占）**——同一时刻只有一个接管者可删除死锁（他人循环等待），删后回环进入公平 O_EXCL 竞争——**双持在构造上不可能**；锁内容改 `pid:token`（探测端识别创建中的空锁永不接管——空内容≠无主死锁）；释放端**身份化**（只删自己的内体，连锁删锁根除）；票文件无持有权语义（死票/崩溃票由探测者无害回收）。实证：**32/16/8/6 路 100/60/60/60 轮 0 丢**；48 路 fail-loud 为 2s 预算数学极限（正确语义）。新增 io.spec「32-way ticket takeover」回归测试（含残留断言 + 15s 预算）。
- **V5-03 noop 短路**：node 后端 `transact` 对**字节等同**结果（`next === current`）直接返回——不再 tmp+rename 重写（目录 mtime 搅动、「nothing written」消息失真）；noop update/patch、重复 memory add、state-json 去重回环等四处同根一并收敛（V5-08 的「不重写」口径顺带恢复）。
- **V5-02 legacy 一次性退休**：`pending.json`（pre-0.3.22 只读合并）在首次 `listPending` 时**迁移并退休**——并入 current、**以归档键集排除「已完成历史的幽灵 pending 双胞胎」**（cap 轮转已逐出 resolved 副本时，legacy 的 `status:'pending'` 旧副本不再胜出→不可再 claim→不可重放数月前 staged args）、改名 `pending.json.migrated`（证据保留）；claim/save/release/tryResolve 内层 legacy 读取以迁移完成标志短路（迁移失败幂等重试——跨进程安全：rename 后他进程读 null）。V5-07 的「跨代反复归档」随退休根除（注释更新）。
- **V5-09 逐出键集修正**：enforceResolvedCap 改按**记录 id** 逐出（手工文件 key≠id 不再「已归档却未逐出」造成 cap 静默失效）；畸形 `resolvedAt`（Date.parse NaN）按「最老未知」排序（不再不稳定排序）。
- **V5-10 轮转边界**：空档案不写 `[]` 的 `.bak`；单批 fresh 超 cap 时截断保留最新 CAP 条（最旧丢弃——审计面 best-effort 语义）。
- **回归**：全量 vitest **684/684**（+3 新回归：V5-02 退休链 / V5-09 键集 / V5-10 空 .bak）；oxlint 0/0；tsc state-json+core 0；32 路×30 轮压力 0 丢 0 错。

## 0.3.28 (patch) — v4 审计收口：口径/文档/后台缺陷批（V4-07~V4-50 剩余全部）

v4 审计（修复核验轮）收口批次——批次 1（0.3.26）门禁与修复有效性 + 批次 2（0.3.27）数据与并发完整性之后的剩余 P3 全部 + V4-22 设计；5 组并行子代理（文件面互不相交）逐项先核验再修（A core 域 / B state 域 / C 工具命令面 / D 后台审计面 / E 发布文档预设面），主代理逐项复跑 + 亲读验收。

- **state/接缝**：V4-07 一致性基座扩为逐字段比对（claimedAt/resolvedAt 类型级——json/domain 两 provider 无既有差异故零豁免、零实现缺陷）；V4-08 jsonTransact 写侧形状守卫（task 返数组/标量 fail-loud 且不落盘；quarantine/jsonTransact 模块级化仅供测试直调——函数插件仍无 default 导出）；V4-10 注释如实（seam 无 delete 语义）；V4-11 **+ 全仓扫描 13 包** tsconfig 幽灵 schemastery references 清扫（G5.5 同类，零 import 证实，逐包 tsc 0）。
- **core 口径**：V4-38 **核验推翻「test-only export」**——标称 11 符号（saveUsage/saveSuppressedNames/5 个 review prompt 常量/retainEventArchives/readEvolutionEvents/memoryRoot/QUALITY_WEIGHTS/ENTRY_DELIMITER）全有生产或跨文件消费方，无一 refs≤1（全仓 refs 计数口径，零删除、不占 V4-38 的改动面）；V4-39 prompts pinned 文案如实（任何 writer 无法归档——先移除 .pinned marker；foreground/delegated 的 update/patch 仍允许）；V4-43 scanThreats 自卫（maxScanChars 0/NaN/负 → clampedNumber 钳制）；V4-48 version 类型消息（`got "1" (string)`，数字/字符串歧义消除）；V4-49 分隔符拒绝消息形态统一（单条去 `Operation 1` 前缀、批量补 current-entries 预览）。
- **工具/命令面**：V4-13 graph noop 不计 patch（对齐 tool-skill-manage 口径）；V4-14 skill-usage README 监听面如实（skill_load 已删）；V4-15 单操作叠词（"memory add"——F-329 规则扩展到单操作）；V4-16 maintenance 探针 resolveSkillsRoot（''/' ' 不再落 CWD 相对根）；V4-17 atomicWriteFiles `.bak` 每次成功提交刷新（恢复回最新代）+ 消息含来源；V4-19 `--detail` 截断附 `…(truncated N chars)`；V4-24 names 校验 trim + 大小写不敏感（canonical 名，未知名字仍拒）；V4-26 行首独立 `Notes:` 定位（字段内嵌换行不再击穿推荐计数）；V4-27 测试缺口（noop 计数消费实测 src 正确仅补测 / F-331 pinned+bundled 不入 LLM 提示 / F-102 abort dispose 同构）。
- **后台/审计**：V4-18 轮转误导消息区分（「记录不在 pending 窗口」vs 正在被执行——归因不再误导）；V4-21 executePlan 中途 IO throw 改 **{actions, ok:false} 返回**——已应用项显式 + 「部分操作失败，以下操作已应用，请勿重复执行」提示，不再重复注入同 kind；completionInjected 在 inject 抛错时回滚（错误恢复后 completion 可重触发）；V4-22 curator-error **独立预算**（真报告 keep-20 / 错误 cap-10，F-327 排序）+ 每次 run 结束（成功或失败）都触发回收——持续抛错宿主 error 报告不再无界累积、真报告保留窗口不被挤占；V4-23 validateEvolutionPlan 根守卫（null/数组/标量显式拒绝而非 TypeError，与 maintain 对称）；V4-25 review README 声明 executionTimeoutMs 无效（未消费——配置 reviewTimeoutMs）；V4-40 replay weights 钳制 warn（与 maxPlans 一致）；V4-41 feedback **durableNote**（双失败回滚还原到最后一个已确认落盘的 note，绝不复现从未落盘值；注释如实：进程内 restore 不自愈、仅重启可自愈——由 durableNote 消除该边界）；V4-42 activity maxItems:0 钳制 warn（程序化装配面）；V4-44 钳制 warn 断言补齐（review 精确钳制值 + `AbortSignal.timeout(0)` 行为级 + capability/feedback/curator warn 断言）；V4-45 capability 负例双测（非 staged allow 拒收、approved 记录带外篡改 re-validate 拒绝——逻辑本就正确只补测）；V4-46 replay `dsh-session` devDep 幽灵删除；V4-50 feedback 拒绝经已注入 warn 通道（未来版本事件不再无痕丢失）。
- **发布链/文档/预设**：V4-32 publish-scoped `--groups ≤0`/非整数显式 fail（空转不再"完成"）；V4-33 核验=版本漂移已随 0.3.27 normalize 修复（不单独立项）；V4-34 prepare-release **atomicSwap**（target→`.previous` 两段换入、失败回滚、可重跑；staging 保留 lib/ 的说明——CI 恒先构建，过滤会丢运行时）；V4-35 头注释路径如实（flat 布局）+ CHANGELOG 0.3.21 G0.5 措辞拆分（BOM 实际在 inject-evolution-paths——V4-35 修正）；V4-36 根 README 包地图补 evolution-all/capability/maintenance + activity 行按实际功能描述（zh 为独立改写文档非镜像）；V4-37 standalone/oneclick 头注释**全量声明**行集差异（storage host-plane / tool-session-query 在 delta / maintenance-tools+session-query-sqlite+60-char cap 由 evolution-host 拥有——**E-33 互斥安装目标，零行集增删保字节 parity**；capability D-9 持出；V4-37② 以注释说明出处而非加行）；V4-47 activity description 按实际功能 + README `.min(1)` fail-loud 说明 + **七处 README `- - ` 畸形列表修正**（feedback/capability/io-node/host/state-domain/state-storage/preset——全树清零）。
- **回归（发布前全量发现并修复）**：首跑全量 102 文件 1 例失败——curator「paused gate」在并行负载下被饿过默认 5s 超时（5.04s；孤立全文件 47 用例仅 5.00s、单测 169ms——纯负载饥饿非功能回归）→ 该测试给显式 15s 预算 → 复跑 **102 文件 / 680 测试** 全绿；oxlint 0/0（194 文件）；tsc 30 包 0；dependency-closure 30 包 OK；arch-guards strict 0（N4 69 项 warn-only 保持）；event-pairing 0 orphan/0 dangling；publish-scoped/prepare-release `node --check` 过。
- **闭环声明**：v4 审计报告（`references/audit-report-v4.md`）P3 全部落地（V4-38 核验为不适用、V4-33 已随 0.3.27 修复、V4-44 的 plan-validator/approval 无该面不强加）。剩余挂账=上游平台议题（G4.8/N-2）+ F-328 申报 + F-309/310/311/354 脚本层申报 + capability 接线状态（README 已声明"implemented but not yet wired"）。

## 0.3.27 (patch) — v4 审计批 2：数据与并发完整性（V4-01/04/05/06/09/12/20）

v4 审计（修复核验轮）新发现的批次 2（数据与并发完整性）；每项先核验属实再修（A/B 子代理分域实施，主代理逐项亲读验收）；transact 接线按用户裁决=构造默认绑定。

- **V4-01 归档重复增长**：pending-state-archive.json 无去重且每次 append 全量重写（O(A²)）——只读合并的 legacy `pending.json` 会把已轮转记录重新引入再归档，无限膨胀 → append 按 id+status+resolvedAt 去重（fresh 空则短路返回 current 不重写）+ `ARCHIVE_RESOLVED_CAP=5000` 超限轮转 `.bak` 侧车（与 PENDING_RESOLVED_CAP 同款纪律）。
- **V4-04 锁接管窗口**：stale 接管的「重读一致→rm」下，两 peer 同过探针时后完成者会删除对手刚重获的**活锁**（双持→并发执行）→ 接管改为 `rename` 原子独占（rename 源独占，仅一人成功；失败者 ENOENT 回环重试，绝不删他人活锁）；接管名与锁同目录（同文件系统保证原子）。
- **V4-05 同 pid 活锁可被同进程写者抢占**：`pendingSelfCleanup.has(lock) || mtime>1000` 的 mtime 分支把「本进程另一任务执行>1s」误判为死锁 → 同 pid 分支只保留 `pendingSelfCleanup.has`：执行中的锁（任何时长）绝不回收，仅回收「任务已结束但 finally rm 失败并登记」的遗留锁（安全保守——遗留未登记的由跨进程接管路径覆盖）。
- **V4-06 双重 quarantine**：readJson 的形状检查原在 parse try 内——wrong-shape 的 quarantine（throw）落入 catch 再 quarantine 一次（每读二份 `.corrupt-*`）→ 形状检查移出 parse try。
- **V4-09 root 空白穿透**：state-json 配置 root 未 trim——whitespace-only `' '` truthy 落到 CWD 相对路径（与 resolveSkillsRoot 口径不一致）→ `(rawConfig.root ?? '').trim() || evolutionHome()`。
- **V4-12 snapshot 两读让渡**：memory/user 两次独立 await 之间可插入 serializedWrite（applyBatch）——混合代快照 + sha256 钉在不存在的状态 → 两读收进同一 serializedWrite 任务（单代快照；跨进程窗口保留为已声明接受）。
- **V4-20 SkillLibrary transact 默认绑定**：构造第 5 参未注入时默认 undefined（旧无锁行为；8 个生产实例化点均未注入）→ `transact ?? (io.transact ? 适配包装 : undefined)`——显式注入优先；后端 `(path, task)` 实例签名自动适配；无 transact 后端保留纯 read→write + 进程内 serial 链。**用户裁决（四性）**：构造默认绑定（单点优于 8 处注入）。
- **测试确定性修复（发布前全量回归发现）**：全量首跑 3 例失败（并行负载下计时敏感）——feedback「persists across restarts」固定 20ms 等待 restore（改确定性轮询）、commands「records a learn event」固定 50ms 等待 fire-and-forget 写（改轮询）、installer「installs host bundle + agent preset」20s 超时被真实 npm 安装子进程越限（提至 60s 与兄弟测试一致）；隔离复跑 55/55 绿。
- **回归**：全量 vitest **100 文件 / 647 测试** 全绿；oxlint 0/0（192 文件）；tsc 30 包 0；dependency-closure 30 包 OK；arch-guards strict 0（N4 70 项 warn-only——新增 2 项为 `resolvedAt?`/`root?` 类的合法可选字段兜底，行级启发式正则误报类）；event-pairing 0 orphan/0 dangling。
- **核验说明**：V4-20 前生产 SkillLibrary 全未注入 transact；现在任何提供 transact 的 io 后端上的 SkillLibrary（commands/curator/review/maintenance/learning-graph/tool-skill-manage/skill-catalog 等）默认走跨进程 transact——本批以家族全量 vitest 覆盖。

## 0.3.26 (patch) — v4 审计批 1：门禁与修复有效性（V4-02/03/28-31）

v4 审计（修复核验轮）P2 新发现的批次 1（门禁与修复有效性——先修护栏再修内容）；每项先核验属实再修（v4 行号为准）。

- **V4-03 依赖闭包守卫接入 CI**：`verify-dependency-closure` 此前零调用点（F-105 防回归半边落空——「守卫正确但无人运行」）→ action.yml 在打包前插入该步骤（与 arch-guards 同款接线）。
- **V4-29 守卫自族 fail-loud**：closure 脚本补 `inspected===0` 真空 fail（原「打印 OK across 0 package(s)」真空通过）；头注释矛盾修正（type-only import 同样必须声明——d.ts 引用走同一声明，发布包无 tsconfig paths）；动态 import 不可见注明为文档限制。
- **V4-30 空转保护 + 守卫自测**：arch-guards 与 event-pairing 补「扫描文件/事件为 0 时失败/告警」（F-103 真空守卫类）；新增 `guard-scripts.spec.ts`（5 个哨兵用例：三守卫 × 正例+故意违规——真实树 OK、真空根失败、未声明 import 失败、DSH_HOME 违规失败、孤儿 emit 标记——门禁必须被门禁覆盖）。
- **V4-02 F-330 修复有效性（死代码→真修复）**：原补丁的 `bundledNames.has(name)` 在 `!treeNames.has(name)` 分支**不可达**（`bundledNames ⊆ treeNames` 构造不变量——同一次 `list()` 填充）——bundled 幽灵场景从未闭环；改为**归档副本 marker 探针**（`.archive/<name>/.bundled`——崩溃归档的 rename 已随目录携带 marker；`markerEntryName` 因跨包消费而导出，保持 N-1 单源）；补「bundled 崩溃自愈→suppression 落盘」专项用例（此前 E-15 测试全部用非 bundled 技能）。
- **V4-28/31 守卫注释与识别修正**：action.yml 的「N3/N4 stay warn-only」注释更正（0.3.25 起 N3 已翻 gate）；event-pairing 的 `ctx.on` 接收器正则修正为 `\w*ctx.on`（`ioCtx.on(...)` 的 plan-applied 消费此前不被计数——单一消费者的 `xCtx.on` 形态会误报 orphan）。
- **回归（发布前检查发现并修复真 bug）**：全量首跑 feedback.spec「persists across restarts」**2/2 连续复现** ENOTEMPTY（§56 模式：ctx2 的 Feedback 恢复链未 settle 就 rm 临时 home；负载变化使其从偶发变必现）→ teardown 补 `waitIdle()`（两处同类测试）；全量复跑 **99 文件 / 636 测试** 全绿；oxlint 0/0（191 文件）；tsc core/curator/host 0。
- **裁决记录（用户授权，四性权衡）**：①transact 生产接线（V4-20）=**构造默认绑定 `io.transact`**（0.3.27 实施——单点优于 8 处注入）；②F-328 完整 hash=**维持申报**（契约迁移复杂度 > 罕见场景收益，`--detail` + 声明已充分缓解）。
- **未在此批（顺延 0.3.27）**：V4-01（归档重复增长）、V4-04/05（锁残余 + 同 pid 抢锁）、V4-20（transact 默认绑定）、V4-06/09/12（state 域小修）。

## 0.3.25 (patch) — G5 其余 + G6 清扫 + G7.2 文档化 + N3 门禁翻转（批次 5，计划收官）

审计优化计划最后一批（批次 5：装配与清扫）；每项先核验再修（B 组发现计划 F 编号系统性错位——以审计报告原文机制描述为准核验；3 项核验为已满足/仅报告）。

- **G5.1 preset 行集统一**：agent delta 行集核验后按实际处理（tool-session-query 已在；60-char/maintenance-tools 由 host 拥有——delta 加入会双挂载）→ delta 注释显式声明最小集差异；standalone cordis.yml 与 README 按决策点 8 声明「storage 为 host-plane、preset 不拥有、standalone 无 host 时显式声明依赖」；README 手工组合示例与两 bundle 行集同步（补 session-query-sqlite/tool-skill override/reviewToolAllow/domain disabled）。
- **G5.2 碰撞契约统一**：core `composePresetComposition` 与 install-layered 接受同一 `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS` env（默认 fail、=1 warn+keep-both）——头注释「Same contract」由虚改实；core 与 installer.spec 补碰撞路径对偶用例。
- **G5.5 tsconfig 治理**：删除幽灵 references（commands→curator、learning-graph→memory/skill-usage——grep 证实无 import）；plan-validator 引用改兄弟式；README 声明「packages/evolution paths/refs 仅在完整 upstream checkout 可解析」（CI overlay）。
- **G5.6 zod 别名出域**：inject-evolution-paths 的注入列表**排除 zod**（其 pnpm-store 路径机器特定；且上游自带 zod 键会误触发 already-declares fail）——inject-paths 测试同步（2 条注入 + zod 负断言）；zod `^3.0.0` 声明 vs 实际解析 4.4.3 的偏差记录为已知项。
- **G6.1 死代码清零批**：PENDING_STATUSES 删除（类型内联字面量联合）、CLAIM_EXPIRY 死逻辑删除（**决策点 6**——expiry 分支不可达：canClaim 只放行 pending；executing 永不自动重放=E-24 安全语义真相化）、ensureRecord 删除（测试调用改 ensureRecordCreated）、skill_load 幻影键删除（读工具名单与 review 侧对齐）；**moved-twice 分支核验不符未删**（可达且有测试）；registryVersion/smoke-package/verify-layout-sync 核验后报告（脚本层，附主代理裁决）；core 死导出扫描=已满足（无 refs=1 真死 value 导出）。
- **G6.2 边界缺陷批（12 项）**：HEALTH_STAMP_RE 支持偏移/无时区 + hex 词强制含数字（`defaced` 不再误计）、relatedSkillNames 词边界（CamelCase 垃圾词元清零——如 `MySkill`→`y`）、feedback lastNote 回滚仅在本轮 note 时还原、零计数迁移注释、maintain names ∈ facts 校验、curator-error 纳入 retainReports（mtime 回退）、E-15 自愈补 bundled suppression、consolidations 候选池 marker 预过滤、normalizeSummary 杜绝「memory memory」叠词、plan-validator 容器级畸形逐项拒绝（Array.isArray 前置）、activity serializeActivity 单源、snapshot 恢复清理快照后点文件（F-316——`.usage.json` 幽灵清零，审计/抑制态保留）。
- **G6.3 契约对齐**：pinned 前台归档 → 守卫消息明确指引（决策点 5：改提示词——「移除 .pinned marker 后重试」）；io.spec 5s→1s 注释修正。
- **G6.4 测试缺口批**：FORBIDDEN_CONTROL_KEYS 专项覆盖、review.spec 名实修正、completion 通道集成（F-363——通过 runOnTurnEnd 的 inject 通道，非 subagent spawn）、recommend 抛错路径（F-364——E-52 warn+空提名）、note 灌水负例（F-365——Notes 段先截除再计数）；并发 approve+reject 已于 0.3.24 满足（报告跳过）。
- **G7.2 对偶形态 checklist**：落点=技能库（维护过程资产不进公开仓库）——清单固化于技能库正文（数值矩阵/JSON 三态/seam 字段/退出路径/提示词承诺矩阵）。
- **N3 门禁翻转**：剩余 25 项数值字段全部钳制（activity/capability/curator/review/memory-files——决策表：仅 curator `minIdleHours`/`bootGraceSeconds` 允许 0（`.min(0)`），其余 `.min(1)`；`reviewTimeoutMs` 0 不是 no-timeout——`AbortSignal.timeout(0)` 立即中止；`executionTimeoutMs` 判定为未消费的声明字段）；arch-guards N3 从 warn-only **翻转为 gate**（strict 失败）。
- **回归**：全量 vitest **98 文件 / 630 测试**；oxlint 0/0（190 文件）；tsc 28 包 0；arch-guards strict 0（N4 68 项 warn-only 保持——多为合法兜底）；dependency-closure 30 包 OK。
- **闭环声明**：v3 优化计划 **G0-G7 全部批次落地**。剩余非本地项：①上游平台议题（G4.8 的 config 全局默认策略服务端派生分歧 + N-2 overrideOf 签名——待平台包可考）；②F-328 完整 hash 方案（需放宽 PendingRecord 共享契约——申报为已知限制）。

## 0.3.24 (patch) — G4 控制面 + G5.3/G5.4 命令面（批次 4，5 组）

审计优化计划批次 4（控制面与命令面）；每项先按报告行号核对现状再修（12 项核验中 3 项已满足：G4.8 本地收敛已于 0.3.23 完成、G7.3 事件配对门禁已于 0.3.21 接入 CI、F-323 计数已行首锚定排除 notes）。

- **G4.1 maintain 子代理 dispose 对齐 review**：runMaintain 的 subagents.start 返回类型加可选 `dispose?`；start 后全部 return/throw 路径 try/finally 统一 dispose，失败经 `logger?.warn` 留痕不遮主结果；commands 生产路径接入 logger（dispose 失败在生产可见）。
- **G4.2 maintenance_probe disposer 绑定**：tools.register 经 `toolCtx.effect(..., 'evolution-maintenance.tools')` 绑定（HMR 卸载真移除——新测试证明 fiber dispose 后工具移除）。
- **G4.4 review emit 时序与双审查窗口**：①结果通知 inject 独立 try/catch（失败不再误判整条 pipeline 失败→修复「计划落地后 fallback 再注入」的双重审查）；②plan-applied emit 移到结果通知之后（E-41 同类原则；inject 失败仍记录 plan-applied——计划确已落地）；③completion 通道的 review-scheduled 后移到完成注入之后。
- **G4.5 review stateless 可观测性**：state 服务缺失时进程级一次性 warn（不每回合刷屏）+ README 已知限制声明。
- **G4.6 memory 计数活动加权（决策点 2）**：advanceReview 的 memory 行对齐 skill 行——无 memory 信号回合按 toolCalls 推进（`signal.memorySignal ? 1 : Math.max(1, signal.toolCalls)`）；memoryInterval=10 下高活动会话的记忆评审节奏加快（预期）；新增 5 用例（纯活动触发/混合累积/重置/skill 对称）；activity/feedback 零回退。
- **G4.3 reject executing 分支语义如实化**：注释与消息改为「best-effort 操作员清理、不持 claim、可能与在途 approve runner 竞争、写效果以实际为准」（不再误称 "crashed approve cleaned up"）；approval README 补并发 approve+reject 窗口声明；新增受控 gate 并发测试（executions==1、audit 如实）。
- **G4.9 /evolution pending --detail**：`pending [--detail]` 渲染每条记录的 staged args（500 字符截断、fail-safe）；默认折叠视图不变；消除「盲批」。
- **G4.10 挂空事件归属声明**：review README 声明 `review-scheduled`/`review-error` 为外部属主（宿主/平台消费方接线），与 verify-event-pairing 的 EXEMPT_ORPHANS 对齐（脚本注释与文档失配收口）。
- **G5.3 atomicWriteFiles 提交段自愈**：二次 rename 失败后从 `.bak` 恢复被删目标（best-effort、恢复失败注明、抛原始错误）——失败提交不再留下缺失文件；函数导出 + fs 注入（rename 失败路径确定性单测 2 用例）。
- **G5.4 /graph 节点可寻址**：memory 节点行渲染完整 id 含 snapshot token（`[id: memory:<source>:<index>:<8hex>]`）——copy/paste 保留 E-21 漂移守卫（裸前缀会静默跳过）；新增 2 用例（渲染形态 + 往返）。
- **回归**：全量 vitest **94 文件 / 609 测试**（+16）；oxlint 0/0（186 文件）；tsc 6 包 0；arch-guards strict 0（N1/N2 零违规；N3 25 项 G3.1 TODO warn-only 不变）；commands logger 接线后 tsc 复验。
- **未在此批收敛（顺延 0.3.25+）**：G3.1 剩余 25 处数值钳制、G5 其余（preset 行集/碰撞契约/tsconfig 治理/zod 别名）、G6 清扫、G7.2 文档化；F-328 完整 hash 方案（需放宽 PendingRecord 共享契约）。

## 0.3.23 (patch) — G3 配置治理 + G4.7 + G1.3 seam 单源 + G7.1 门禁生效（4 组）

审计优化计划批次 3（配置治理）；每项先按报告行号核对现状再修（14 项核验中 1 项部分属实——F-340 的 `this: void` 两边已一致，transact 宽度与 size 文档措辞为真实漂移）。

- **G3.1 数值配置统一钳制管道**：core 新增纯值助手 `clampedNumber(value, fallback, {min?, max?})`（core 保持零 schemastery 分层——校验器留在各包 Config 内联）；policy 12 数值字段、threat `maxScanChars`、replay `maxPlans/weights`（accepted/rejectedPenalty/evidence min 1、cost min 0）、feedback `qualityWarnThreshold`（[-1,1]，0/负合法）全部接入——schema `.min()/.max()` 装载期硬校验 + 装配期钳制（authoritative）+ 修正时一次性 warn。**schemastery 实测**：`.min(1)` 拒绝 0/负（fail loud），NaN/±Infinity 穿透由 clamp 兜底——决策点 3「0 回落默认」以「schema fail-loud + clamp 兜底」双保险实现（与家族 T-13 先例一致）；memory 内部 `limit<=0=unbounded` 保留为库内防御并在 README 声明。
- **G3.3 注册表 fail-fast**：`MemoryRegistry.provider(name)` 命名未命中由静默回退 first 改 throw（对齐 io/state-storage 注册表；grep 确认无调用方依赖旧回退）。
- **G3.4 redact 覆盖扩展**：bearer 改 `i` 大小写不敏感 + `\s+` 空白宽容；inline 赋值模式支持下划线/连字符连接键（`auth_token=`/`client_secret=`/`access_token=`）——连接前缀 `[\w-]+[_\-]` 设计保持 `monkey=` 负例不误伤（node 实测样例钉住）。
- **G4.7 JSON null 原始值防御**：skill-usage `skillNameFromToolCall` 与 review `collectReadSkillNames` 对 `JSON.parse('null')` 成功返回 null 的场景补非对象守卫（此前 `parsed.name` 抛 TypeError 击穿 E-65 防御）。
- **G1.3 seam 类型单源**：`EvolutionIo` 从 core `EvolutionIoLike` 派生（`Omit<...,'transact'> & { name; transact 窄化 }`）——size/isSymlink/mtime 契约与 `this: void` 全部单源继承，唯一有意差异（transact task 宽度）注释说明；双向编译断言（seam⊆core + node provider⊆seam）；evolution-io 新增 core 依赖与 tsconfig 引用。
- **G4.8 本地收敛（G7.1 前置）**：approval 包导出权威 `ApprovalPolicyLike` + `effectiveSessionPolicy`（单源）；tool-memory/tool-skill-manage 删除逐字节相同的本地副本改 import；approval 5 单测（override 优先/config 兜底/都无→'ask'）。
- **G7.1 门禁生效**：arch-guards N1/N2 **零违规 + `--strict` 上线**（action.yml 调用加 `--strict`）；N2 豁免区随权威移动（core→approval）；本次顺带修补 N1 漏网（skill-usage 的 `DSH_HOME` 裸读——F-207 清单外、0.3.21 起就在的第三处）；N3 上线（warn-only 清单，28→25 项外部包 G3.1 TODO）、N4 上线（warn-only `?? ''`/`?? id` 死回退列示，67 处多为合法兜底）。
- **回归**：全量 vitest **91 文件 / 593 测试**（+27）；oxlint 0/0（183 文件）；tsc 13 包 0；verify-dependency-closure 30 包 OK；arch-guards strict 干跑 0。
- **未在此批收敛（顺延 0.3.24+）**：G3.1 剩余 25 处（activity/capability/curator/review/memory-files 数值字段）、G4 其余控制面、G5/G6。

## 0.3.22 (patch) — G2 数据完整性 + G3.2 解析单源 + G7.4 一致性基座（3 组）

外部审计优化计划（optimization-plan-v3）第二批（批次 2：数据完整性）；每项先按报告行号核对现状再修，15 处核验全部属实后落地。

- **G2.1 transactCuratorState null=keep 统一**：seam 文档与 json 实现统一为「task 返回 null = 保留原记录」（与 domain 原语能力一致；生产调用方从不依赖 null=delete，json 曾删 primary 是唯一分歧点）；json/domain 两 provider 补直接测试（missing-key 种子 / null 入参 / 覆盖）。
- **G2.2 state-json 形状门**：readJson 与 jsonTransact 的 parse 后加每文件顶层形状校验（review-state/curator-state/pending-state/pending 的 map-of-record 结构），合法 JSON 但错误形状（`[]`/`42`/`"str"`）走既有 quarantine（原字节备份 + throw）——不再被当空状态无备份覆盖；归档侧车（数组）显式豁免。
- **G2.3 domain pendingSchema 补齐**：加 `origin`/`sessionId` 可选字段——zod 默认 strip 曾把审计归因字段在 domain 后端静默剥离；补「写→重开→读回字段保留」往返测试。
- **G2.4 MemoryStore 分隔符防御**：add/applyBatchCore（add+replace 分支）拒绝含 `ENTRY_DELIMITER`（`\n§\n`）或尾 `\n§` 片段的 facts（明确错误消息含操作+position）——根治「末尾 § 砖化永久 drift」与「中部 § 静默裂分」两种形态。
- **G2.5 SkillLibrary 事务化**：构造加可选 `transact` 注入（默认旧行为，向后兼容零改动）+ 私有 `makeSerialQueue` 串行链——update/patch/restructure/writeSupportFile 的整段 read→validate→write 进程内串行、单文件写在注入时走跨进程 transactIo；create/archive/consolidate 保留既有两阶段提交；README 补并发模型声明（进程内串行 + 跨进程锁 + 多写面 last-writer-wins）。
- **G2.6 审计哈希同源**：create/update/patch 把落盘字节（`trimEnd()+'\n'`）算一次作为 onDisk，writeText 与 audit 同源——审计 afterHash 与磁盘实际字节一致（可 reviewable/replayable）。
- **G2.7 审批存储治理**：pending-state.json 的 resolved 记录 cap 200 + 归档轮转（最老记录移入 `pending-state-archive.json`，best-effort 永不 fail resolve；只裁 approved/rejected）；approval 注释同步修订「KEPT as audit history」承诺；domain releasePendingClaim 的 missing-key 对齐 json 的 no-op 语义（良性/恶性区分与 claim/tryResolve 一致）。
- **G2.8 事件日志 version 校验**：读取端 v1-only——非 v1 读作空且不被误解析；appendEvolutionEvent 对非 v1 body 拒绝重写（保留原字节），版本不匹配消息与 malformed 区分。
- **G3.2 解析单源收尾**：core 新增 `evolutionRoot()`（`||` 空串回退单源；`evolutionHome()` 改由它派生——弃 `dirname(evolutionHome())` 派生的「DSH_HOME 恰以 evolution 结尾剥真实后缀」陷阱）；feedback×2 与 commands×3 的 `DSH_HOME ?? homedir()` 全部替换；commands×3 的 `new SkillLibrary(config.skillsRoot, …)` → `resolveSkillsRoot({ root: config.skillsRoot })`（空串/空白配置不再落到 CWD 相对根）。
- **G7.4 跨 provider 一致性基座**：test-support 新增 `runStateProviderConsistency(provider)`（review 往返 / claim→resolve / claim→release / transactCuratorState null 入参 / listPending 状态过滤——时间戳字段剔除比较）；json 与 domain 各调用一次。
- **回归**：全量 vitest **90 文件 / 566 测试**（+43：core 225 / provider 46 / consumer 108 等）；oxlint 0/0（181 文件）；tsc 7 包 0（含修复 G3.2 引入的 exactOptionalPropertyTypes 真 bug——`resolveSkillsRoot` 参数显式 `| undefined`）；策划/审批零回退。
- **未在此批收敛（顺延 0.3.23+）**：G3 其余（数值钳制管道/注册表 fail-fast/redact 扩展）、G4 控制面、G5/G6、arch-guards 翻 strict。

## 0.3.21 (patch) — G0 发布工程 + G1 锁协议 v2 + G7 门禁（3 组）

外部审计优化计划（audit-report-v3 / optimization-plan-v3）的首批落地；每项先按报告行号核对现状再修，修复后逐条交叉验证。

- **G0.1 依赖闭包守卫**：新增 `verify-dependency-closure.mjs`——30 包的 value import 必须已声明（type-only 感知，混合 import 按 value 上报）；补 feedback/state-json/tool-memory/evolution-review 缺失的 workspace 依赖；清除 11 处幽灵依赖（io/io-node/memory/learning-graph/commands 移除未用 schemastery；state 移除 dsh-storage-domain / dsh-evolution-state-domain）。
- **G0.2 平台范围守卫修复**：`verify-platform-ranges.mjs` 此前扫描数为空时静默通过（vacuous-pass）——改为 `scanned===0` fail-loud；action.yml 的 `--manifest-dir` 指向 `packages/evolution/.release-staging`；platform-range.spec.ts 重钉。
- **G0.3 重写补丁覆盖 .d.ts**：`rewriteScopedJs` 覆盖 `lib/types/**/*.d.ts`；29 个包 `files` 列表改为 `["lib/*.js","lib/types/**/*.d.ts"]`；守卫校验 `packed.files`，避免发布包留上游 scope 痕迹。
- **G0.4 暂存清单与版本一致**：`.staging-manifest.json`（包/版本/来源声明）+ install-layered 版本比较 fail-loud（防回滚安装）；`.release-staging` 生命周期清理。
- **G0.5 发布链 fail-fast**：publish-scoped 任一包失败即停；prepare-release `.next` 目录原子切换（rename 保留旧 build 可重跑）；inject-evolution-paths tsconfig 注入保留 BOM（tmp+rename——0.3.28 措辞修正，BOM 逻辑不在 prepare-release）；install-layered 原子写 + dry-run 不落盘。
- **G0.6 布局文档与元数据**：INSTALL/README 路径与 package-map 更新；build-lib 头注释；镜像根 package.json 移除 `workspaces`（扁平发布载体不再伪装工作区）。
- **G1 锁协议 v2（io.ts 单点）**：takeover 前重读锁内容（`current === holderContent` 才删除，防持锁者已换内容误删）；同 pid 锁回收改双条件（`pendingSelfCleanup.has(lock) || mtime > 1000`——同 pid 并发写者不可互相"治愈"，根治回收锁截胡）；`commitTmp` 失败主动删 tmp、renameWithRetry（EPERM/EBUSY ≤3 次重试 50ms）、同 pid 失败即时 sweep；io.spec +6 用例（203 全绿）。
- **G7.1 架构守卫**：新增 `verify-arch-guards.mjs`——DSH_HOME 只允许 evolution-core 解析（N1）+ ApprovalPolicyLike / effectiveSessionPolicy 单源（N2）；本版 warn 模式（5 处遗留 = G3.2/G4.8 收敛 TODO，收敛后翻 `--strict`）。
- **G7.3 事件配对守卫**：新增 `verify-event-pairing.mjs`——生产 src 的 `evolution/*` emit/on 配对核验：0 孤儿 0 悬空（`review-scheduled`/`review-error` 为 README 声明的外部属主豁免）。
- **回归检查**：vitest 全量 80 文件 / 523 测试全绿（+6 个 G1 io 用例；修复 anchored-smoke teardown `ENOTEMPTY` 竞态——先 dispose review fiber 再 rm、rm 带重试；修复 io.spec `transact` 可选成员调用类型）；oxlint 0/0（170 文件 89 规则）；tsc -b evolution-core 0；改动 specs 定向 typecheck 0 错；11 个脚本 `node --check` 全过。
- **未在此批收敛（顺延 0.3.22+）**：G2 数据完整性、G3 架构收敛（arch-guards 5 处）、G7.4 其余门禁。

## 0.3.20 (patch) — v2 审计复核修复批（外审新发现 N-1..N-5 + 行级卫生，6 组）

v2 再审计报告（audit-report-v2）经修复方逐条交叉验证后的处置批次；每项先按报告行号核对现状再修。

- **N-1 前台工具 sessionId 透传（P2 行为回归）**：tool-memory / tool-skill-manage 的 approval request 此前只传自报 `sessionPolicy` 不传 `sessionId`，平台 approval 服务挂载时服务端派生（`deriveSessionPolicy(undefined)`）恒不触发——无人值守（override 'never'）会话的写全部滞留 staging，与 approval docstring 矛盾。两工具补传 `sessionId`（exec 类型与 review 侧对齐）。
- **N-3 预算并集（P2 旁路）**：plan-validator 的 patch 预算从 `file_content ?? content ?? new_string ?? ''` fallback 链改为三字段取 max——空 `content` 不再遮蔽巨大 `new_string`；新增回归测试（N-3 用例）。
- **N-4 发布管线版本驱动 tag（发布前置）**：`publish-scoped.mjs` 恢复版本驱动的自动 tag 选择（prerelease→next / stable→latest；显式 `--tag` 仅覆盖）——0.3.18 删除该自动选择正是"latest 缺位"事故根因；release.yml 恢复裸跑（去掉硬编码 `--tag latest`，防止首个 `v0.4.0-rc.x` 被标成 latest）。
- **N-5 工具名单单源化兑现**：`EVOLUTION_WRITE_TOOLS`（core constants）此前零引用死导出——threat 与 policy 的本地硬编码写工具二元组改为引用该常量（S3.10 承诺补齐）。
- **行级卫生**：curator `latestReport` 的 glob 排除 `curator-error-*.json`（伪报告 + retainReports 永不回收）；tool-memory staged 返回改条件展开（消灭 `pending_id ?? ''`，与 tool-skill-manage E-70 对齐）；activity README 纠正 0.3.19 引入的低估表述（实现已用 `transactIo` 跨进程原子，原文"single-process safe only"过保守）。
- 门禁：vitest 全量（80 文件 / 515+ 测试，本轮涉改 8 包全绿）、oxlint 0/0、tsc 8 包 0。
- 未在此批闭环（需上游定谳）：**N-2**（`overrideOf` 签名在 approval 侧 string 与工具侧 session 对象矛盾——平台包不在镜像）；E-45/E-49 半边、E-59 中途异常路径、E-73 混代收窄等 v2 报告的 PARTIAL 项按优先级列入后续批次。

## 0.3.19 (patch) — audit 计划收尾（W1 契约单点化 + T-10 文档对齐 + D-10 死通道清理，4 组）

外部审计计划的收尾批次；每步先核验问题属实再修。

- **W1.2 ApprovalLike 权威化**：evolution-approval 新增导出权威 `ApprovalLike`（按公共方法面构造：request/run/hasRunner/registerRunner/list/approve/reject + 可选 isEnabled）；tool-memory、tool-skill-manage、evolution-review、evolution-commands、evolution-learning-graph 五处本地内联视图删除改 import（曾漂移：learning-graph 版漏 isEnabled、commands 版 status 联合更宽）——核验时发现第 5 处（learning-graph，0.3.18 E-26 新增）一并收敛；五包补 dependencies + tsconfig reference。
- **W1.3 home 解析单点**：evolution-state-json 删除本地 `defaultRoot`（`??` 写法带 DSH_HOME 空串穿透缺陷），改 import core `evolutionHome()`（`||` 兜底单源）。
- **D-10 AbortSignal 死通道清理**：evolution-io 的 `EvolutionIo` 与 memory 的 `MemoryProvider`/`MemoryRegistry` 删掉从未被任何调用方使用/转发的 `signal?` 参数（接口 6 处 + 实现 3 处；memory-files provider 同步收窄）；subagent 的 `AbortSignal.timeout`（review/maintain）不属死通道，保留。
- **S7.4 文档与元数据对齐（T-10）**：evolution-activity README 重写为现实现（durable plan-outcome store；退役的 session projection 双注册说明已失实删除，补 maxItems 配置与单进程局限）；evolution-review README 更正（审核工具面 = `skill` 单工具，Hermes 谱系的 `skill_search/skill_load` 允许清单在本平台不存在）；evolution-approval README 更正 runner 注册方（tool-memory / tool-skill-manage，而非已退役的 core evolution 插件；与 0.3.18 E-70 的声明确认一致）；approval-precheck 测试标题与 review.spec 断言核对一致、test-support 头注释核对无失实（两项记录为已就绪）。
- 回归验证：全量 vitest 80 文件/515 测试全绿；oxlint 0/0；tsc 涉改 14 包 0。（0.3.18 遗留说明：0.3.18 曾因 publish-scoped 默认 --tag next 进入 next tag；release.yml 已修复显式 --tag latest，本版起 latest 自动指向 0.3.19。）

## 0.3.18 (patch) — 审计 v13 修复批（阶段 4-6：工具面 + 后台通道 + 命令观测，31 组修复）

外部审计（dsh-evolution-mirror-audit-report.md）的第三批落地（S4.1-S4.6、S5.1-S5.11、S6.1-S6.6 全量 + L7 批次），每步先核验问题属实再修。

**工具面（S4）**
- **S4.1/E-30 技能树 root 单源**：core 新增 `resolveSkillsRoot(config)`（空/空白配置回落默认），tool-skill-manage / evolution-skill-catalog / skill-usage / evolution-learning-graph 四处统一调用（graph 此前无视配置）。
- **S4.2/E-20 快照单汇点**：tool-memory 删除 executeCore 内的双重渲染，快照刷新只保留 `evolution/memory-applied` 监听器（写时竞态/后完成者胜消除）。
- **S4.3/E-67 依赖强度与启动顺序**：systemPrompt 改软探测（M-7 教义；缺失时跳过引导/快照并 warn，主机照常启动）；挂载期 renderContext 包 try/catch（provider 未注册降级为空快照，首次写入自愈）。
- **S4.4/E-68/69/70**：patch old===new 短路（不重写、不计数、不失效 catalog——`noop` 结果）；`delete X absorbed_into=X` 自吸收拒绝；create 遥测合并为单次原子 `ensureRecordCreated`（消除 null 窗口与双锁流量）；staged 不再 `pending_id ?? ''` 冒充缺省；pin/unpin 免审批取舍声明（包注释 + README Safety model）；review 建议数上限命名常量。
- **S4.5/E-71/X-7**：catalog 进程内 summaries 缓存（mutation 事件 + 根 mtime 探针失效；带外改动经 `/evolution skills refresh` 显式失效 + README 声明）；core io seam 新增可选 `mtime?` 探针（node 后端实现，adapter 兜底 null）。
- **S4.6/T-13**：tool-memory `entryPreviewChars` 与 tool-skill-manage 四个 limit 配置加 `.min(1)`（负值/0 在配置期拒绝而非语义反转/全拒）。

**后台通道稳定性（S5.1-S5.3）**
- **S5.1/E-6/E-19**：review `onTurnEnd` 整体包 try/catch（warn + `evolution/review-error` 事件，绝不冒泡）；`trySubagentReview` 进程级单飞（in-flight 期间的 turn/end 只累计信号不触发子代理）。
- **S5.2/E-7**：curator `autoCheck` 顶层 try/catch（自动 tick 的瞬时 IO 故障不再 unhandled rejection；写 `curator-error-<id>.json` 留痕）。
- **S5.3/E-18**：stateless 组合 first-run defer 死循环修复——内存基线推进 + 一次性标记 + `first-run-deferred(stateless)` 标注；第二次到期 tick 真正执行 curate。

**后台通道数据面（S5.4-S5.8）**
- **S5.4/E-15**：archive+fold 两阶段自愈——目录已失但 usage 未折叠的记录下次 run 直接置 archived（崩溃窗口形态），永久 failed 条目消除。
- **S5.5/E-16**：curator state 原子化——state-storage seam 新增 `transactCuratorState(fn)`（json/domain 两 provider 实现），setPaused 与 runCore 收尾统一走单次原子读写。
- **S5.6/E-51**：fresh-install 手动 run 基线锚定 run 时刻（`lastRunAt: Date.now()`；dryRun 保留不推基线）。
- **S5.7/E-36/E-36a**：probe 与 facts 一致性——`snapshotFromLibrary` 接受并传递 `usageObserved`（同一构造）；core 导出 `MIN_STAMP_BODY_CHARS`；probe 输出 `below-min-body` 标记并区分 observed/unobserved/unknown（不再混同）；同 snapshot 探针/事实逐维度一致性测试。
- **S5.8/E-55**：maintain 模型路由读 `evolutionPolicy.get().curatorModel`（与 curator 同源，缺省 'deepseek-v4-pro'）；`jointSignature` 的 minStampBodyChars 从 core 导入（阈值单源，drift-signals 同步改引用）。

**后台通道契约清理（S5.9-S5.11）**
- **S5.9/E-57/58/59/41/37**：review 删除本地 `PolicyLike`/`EvolutionPlan` 分歧视图（改 import evolution-policy `PolicySnapshot` / plan-validator 类型）；`inject` 移除未用 'tools'；`reviewMode` 收紧为 `z.union([const('subagent'), const('inject')])`（审计建议的 'both' 经核系 skillReviewTrigger 混淆，未加死值）；`!result.structured` → review-error 事件 + warn + inject 兜底（不再静默 return true）；executePlan 部分失败返回已应用标记（注入提示"以下操作已应用，勿重复执行"）；`review-scheduled` 移到子代理确认启动后（先做后发，inject 兜底不误发）；删 `skill_load` 幻影分支（平台无此工具），skill_manage 无单技能读 action 的缺口写 README；completion 状态重启清零为接受行为（注释 + README）。
- **S5.10/E-52/53/54**：recommend 死分支删除 + 空 catch 补 warn；`CuratorStateRecord` 改 import 权威类型（schemaVersion 作为持久化字段延伸）；latestReport 改按 mtime 排序（UUID 文件名字典序误导死操作消除）；新增 `minIdleFailOpen` 配置（agents 缺失时 fail-open 可关）；policy 读取统一软探测。
- **S5.11/E-56/T-8/X-6**：validate-plan 停止原地改写调用方输入（归一化副本）；orchestrate outputSchema 补 required 与 validator 对齐；maintenance 删除未用 schemastery devDep；tools 注册去双重 cast。

**命令观测（S6）**
- **S6.2/E-29**：`/evolution` 命令注册包进 effect（卸载/重载不重复注册）。
- **S6.3/E-40**：preset install 原子化（临时名 + rename + `.bak` 保留 + 失败清理半截文件；第二写失败保持旧组合可用）。
- **S6.4/E-34/31/32/63**：feedback/activity 的 apply 期 `ctx.get` 改为 `ctx.inject` 延迟绑定；`maxItems`/非有限值钳制守卫；feedback 校验 rating ∈ {positive,negative}（NaN 不再写入）；parseCache 逐记录数值域校验（非法跳过 + warn）；零计数 legacy 记录迁移生成独立 note 事件；追加失败回滚乐观计数。
- **S6.5/E-26/21/72**：/graph edit|delete 的 skill 分支走审批 + 遥测（与 skill_manage 同等可用性模式）；memory 节点 id 嵌入快照 token（`memory:<source>:<index>:<snapshot>`），编辑/删除前重读索引位比对（TOCTOU 拒绝 + 提示重新 /graph）；memory→skill 建边改词元级全词匹配（`run` 不再与 running/grunt 建假边）；死分支 `?? id` 删除。
- **S6.6/E-64/65/66**：commands 删除 `resolveAgentPresetDir` 死分支；help/hint 补 `mutations` 与 `maintain --facts`；建议数改锚定行首正则；skill-usage 对畸形 tool/call 事件防御（`data?.name` + typeof 窄化）；usage→events 锁序契约固化 + 锚点失败 warn。
- **S6.1/E-5/E-39**：核验 0.3.16 已实现（单飞置位在 try 首行、失败/成功均更新冷却），无需改动。

**装配收尾（S7）**
- **S7.1/E-4**：核验 preset patch 已无 capability 行且依赖契约测试已存在，无需改动。
- **S7.2/E-33**：host/preset 双 bundle 互斥声明 ×3（INSTALL + 两 README）+ 行级互斥契约测试（共享行配置字节一致，preset 显式补 reviewToolAllow 对齐）；install-layered 无冲突检测能力故未加拒绝逻辑。
- **S7.3/E-74**：preset/host patch 的 `?? 'startup'` 改 `|| 'startup'`（空串穿透）；preset 路径改平台 `dshHomePath()`（home 解析单源）。
- **S7.5/D-12/X-5**：30 包 invariant 注释收敛为统一一句话模板；curator 类声明格式修正。

**发布前专项回归（本批交互引入的新 bug 修复）**
- `latestReport` 的 `this.io.mtime(...)` 未做可选调用（S4.5 新增 optional 探针 × S5.10 实现的接口边缘）→ `?.` 修复。
- maintain 模型路由 `runtime.evolutionPolicy?.get().curatorModel` 在 get() 返回 undefined 时读 undefined 属性（软探测接线 × E-55 实现）→ `get()?` + 类型携带 undefined。
- commands 补 E-55 生产接线（`evolutionPolicy: { get: ... }` 软探测透传，否则同源能力只存在于测试）。

**门禁**：vitest 全量 **80 文件/515 测试**（基线 77/462，+53）；oxlint 0/0（10 处风格/类型错误清零）；tsc 涉改 17 包 0；review/curator/maintenance 等各包新增回归测试（单飞、E-18 双 tick、TOCTOU、假边、probe-facts 一致、mtime 排序、原子 state 竞态等）。

**已知未做（0.3.19 收口）**：S7.4 文档与元数据对齐（T-10）、W1 收口（ApprovalLike 权威化剩余 4 处内联 + state-json `defaultRoot` 并入 core）、D-10 AbortSignal 死通道（随 0.3.19）。

## 0.3.17 (patch) — 审计 v13 修复批（阶段 2+3：存储介质层 + 审批控制面 19 步）

外部审计（dsh-evolution-mirror-audit-report.md）的第二批落地；每步先核验问题属实再修。

**存储介质层（S2.1-S2.8）**
- **E-8 写锁误判**：锁获取与任务分离为两个 try——win32 rename/EBUSY 的 EPERM 不再被当成锁竞争重试 40 次再报"could not acquire"（真实错误立即直抛）；接管阈值 5000ms→1000ms（此前大于 2000ms 重试预算，算术上永不接管死锁残留）。
- **E-8b tmp 残留**：写前惰性清扫同目录 `*.tmp`（>1h 且 pid 已死才删；在途新 tmp 保留）。
- **E-9 损坏状态文件**：JSON 解析失败不再当"空"覆写（曾静默清空全部 review state / pending 表）——原文件隔离为 `*.corrupt-<时间戳>` 并抛结构化错误；契约测试反转（quarantine + 拒绝覆写）。
- **E-10 resolve 返回分歧**：domain 的 tryResolvePending 对"已决但状态不符"改为返回记录（与 json 一致）——两个 provider 平行契约测试。
- **E-11 消费门面耦合**：evolution-state 不再运行时 re-export domain 的 zod schema/EVOLUTION_DOMAIN（纯 json 部署不再被拖入 zod + storage-domain 栈）；schema 留在其属主。
- **E-17 句柄泄漏**：dispose 先等待在途 open（重试预算内）再 close。
- **E-73 memory 注册表/快照**：provider 支持按名取用（与另两个 registry 对齐）；快照双读改为串行（消除混合代际）。
- **E-75/T-1**：claim 过期常量单点化（state-storage `CLAIM_EXPIRY_MS`）；状态 json 与 memory-files 的串行队列合并为 core `makeSerialQueue()`。
- **D-10 AbortSignal 死通道**：审议后保留（接口删除触面大，列入 0.4）。

**审批与控制面（S3.1-S3.11）**
- **S3.1/E-22 sessionPolicy 服务端化**：平台 approval 服务挂载时，会话策略由 `overrideOf(sessionId)` 派生——调用方自报值仅在无平台服务时作为回退（"自报 never 绕过暂存"关闭）；review 执行面透传 sessionId。
- **S3.2/E-23 run 闸门**：approval.run 是声明式的后台评审回放通道（无意图调用被拒）。
- **S3.3/E-24 崩溃窗口（executing 中间态）**：claim 原子置 `executing`——runner 执行后、resolve 落盘前崩溃，记录保持 executing+claimed：二次 approve 被拒（重复执行结构性不可能）；reject 提供无 runner 的清理通道；release 回滚 executing→pending（失败可重试）；`/evolution pending` 显式显示 EXECUTING。状态机（canClaim/canResolve/releasedStatus）在 state-storage 单点，两个 provider 共用（消灭 E-10 类漂移）。
- **S3.4/E-25/E-61 审计归因**：PendingRecord 记录 origin+sessionId；reject 失败路径释放 claim（原与 approve 不对称）；approve 成功消息含 id+summary。
- **S3.5/D-4**：PendingKind 删除 `skill_batch`（从未有创建方；zod 同步）。
- **S3.6/E-27**：validator 内容预算纳入 patch `new_string`（此前该字段可绕过 100K 上限）。
- **S3.7/E-28/E-28a**：policy 守卫扫描 memory `operations[]` 内层禁写键；threat 对 op 的 facts/content 取并集扫描（facts 非字符串不再遮蔽 content）。
- **S3.8/E-60**：validator 对畸形 op（null/string/[]）逐条拒绝而非 TypeError（模型输出面）。
- **S3.9/E-35**：capability 名正则禁尾/双连字符；approvedPackage 读回重校验（防带外篡改进入 Creator 激活）。
- **S3.10/T-1**：禁写键 + 写工具名单单点化 core constants（validator/policy/threat 三处引用）。
- **S3.11/E-76**：replay 空 policyFingerprint 视为缺失（排行榜不再出现空名条目）。

**门禁修正（重要）**：vitest include 曾漏 9 个包（approval/policy/threat/io/io-node/state/state-storage/capability/memory-files 的测试从未进入全量套件）——已补全；全量从 68 文件/429 测试提升到 **77 文件/462 测试**；新增状态机/崩溃回归/双 provider 平行测试。本地：77/77（462）、oxlint 0/0、tsc（全部涉改包）0。

## 0.3.16 (patch) — audit v13 修复批（阶段 0+1：7 项 P1/P2/P3 修复 + 债务批）

外部审计（dsh-evolution-mirror-audit-report.md，5 路分包全量通读 + 实测复现）的第一批落地，每步先核验问题属实再修。

- **E-1 redact 偏移量污染**：无捕获组模式改用字面量替换（旧 replacer 把 match offset 数字写进输出，如 `'use 4<redacted>'`）；仅 inline-assignment 保留前缀拼接；core 新增 redact 测试网（8 模式 + 无污染 + 幂等）。
- **E-2 fuzzyPatch `$` 展开**：精确匹配路径改用替换函数（字符串替换串会展开 `$&`/`$'`/`$$`，LLM 写 shell 替换文本会静默损坏文件）；快速/模糊/replaceAll 三条路径字面量语义一致 + 测试。
- **E-3 归档恢复前缀误伤**：`startsWith(\`${name}-\`)` 会把兄弟技能归档（foo-bar）误认为 foo——恢复前校验候选归档内 SKILL.md 的 frontmatter name；恢复回退失败 fail-soft（返回结构化结果，不裸抛）。
- **E-4 preset 未声明依赖**：删除 `evolution-preset/cordis.patch.yml` 的 evolution-capability 挂载行（与 D-9 注释矛盾、依赖未声明）+ 新增 dependency-contract 契约测试——**顺带抓到第二个**：patch 挂了 `evolution-state` 行而依赖未声明，已补（host 此前已正确声明）。
- **E-5/E-39 maintain 卡死与冷却**：单飞标志、富化与扫描整体移入一个 try/finally——富化抛错不再永久卡住 "already running" 且无日志；冷却在成功/失败时都更新；异常翻译为结构化命令错误 + 回归测试。
- **E-12 威胁扫描盲区**：`slice(0, 65_536)` 让 65K 之后的技能内容全部漏扫（内容上限 100K）——改为整文本重叠窗口扫描（重叠 4K >> 最长模式跨度），同一模式跨窗口命中去重。
- **E-13 快照恢复无保护**：restoreLatestSnapshot 抽取 `restoreSnapshotIntoRoot` 并包 try/catch——恢复失败自动回滚到 pre-rollback 快照（双失败时给出双路径救援提示），不再清空 root + 裸抛。
- **E-14 archive 跨介质双份**：copy 成功而 remove 失败时先回滚已拷贝的归档，再回滚失败也给出"双份待清理"明确消息。
- **T-14 consolidate 回滚静默**：`restoreFromArchive(source).catch(() => {})` 不再吞——回滚失败清单写入结果（"rolled back EXCEPT …"）。
- **E-38/E-38a restructure 定位与行尾**：改用 frontmatterBlock 严格闭合行（旧 `indexOf('\n---')` 匹配 `----` 行导致 frontmatter 泄漏进正文）；body 按字节切片保留闭合行后的换行符；CRLF 文件保留原行尾（不再整体 LF 化）。
- **E-42..E-50 P3 批**：`DSH_HOME ??` → `||`（空串视为未设置，3 处）；SKILL.md 为目录时 SkillLibrary.read 视为 absent（readText 保持 EISDIR——rotation 的损坏归档检测不松动）；afterHash 选 SKILL.md 改 basename 判断；hermes_env 补 `%USERPROFILE%` 变体；latestActivityAt 改 Date.parse 数值比较；yaml plain-scalar 补 null/bool/number/结尾冒号；reviewPrompt('memory','plan') 返回合并计划提示词（旧为错误通道）；observeEvent 内容形状守卫；mutation 事件 `filePath` 拆为 `skillDir`+`file`。
- **S1.10-S1.14 债务**：删除零调用 `MemoryStore.write()`（裸写路径，D-2）；`AUTHORING_DESCRIPTION_BAR` 迁 constants（drift-signals 不再 import skill-store）；`PROMPT_BUNDLE_ID` 由 VERSION 派生（T-5 双源消除）；指针行常量单点化（T-6）；X-1/X-2 随手修（transact 任务允许同步返回）。
- 本地：vitest 68/68（429）、oxlint 0/0、tsc -b（core/commands/maintenance）0。

## 0.3.15 (patch) — preset install composes the runtime standard + delta (P1-1 follow-up)

0.3.14's `/evolution preset install` copied the published `agent.cordis.yml` **delta-only** fragment into `$DSH_HOME/.agent-presets/evolution/`. The agent-preset registry mounts a preset's composition file **verbatim** (verified against `dsh-agent-presets` `mountPreset`), so the delta alone would have produced an agent carrying only the delta rows (no tools, no persona). The source installer path (`install-layered.mjs`) already generated the full composition — the 0.3.14 command skipped that step.

- `evolution-core`: new pure `composePresetComposition(standard, delta)` — standard rows first, then the delta, with the same colliding-row guard as `install-layered.mjs`; `installer.spec` pins **byte parity** between the two implementations.
- `evolution-commands` `preset install`: reads the runtime `standard` composition via the agent-preset registry (`agentPresets.read('standard')`), merges the delta shipped in `dsh-evolution-agent-preset`, and writes the composed `agent.cordis.yml` + `preset.yml` (idempotent; fails loud when delta rows collide with a standard that already absorbed them).
- Docs (README/README.zh/INSTALL.md): preset-install step now describes the compose semantics (was "copies the preset files").
- Tests: commands (composed output assertion + collision refusal), core (compose table), installer (parity pin).

- Local: full suite 65/65 (404), oxlint 0/0, tsc -b (core/commands/host) 0.

## 0.3.14 (patch) — audit v13 batch: preset delivery (P1-1), single-flight TOCTOU (P2-1), seven P3 items

The v13 audit verified the 0.3.12 install story and found a **claimed-but-unbacked mechanism**: the docs promised "preset installed by the family's preset layer — no manual copying", but `dsh plugin add` has no agent-preset install channel (upstream `apps/cli/src/plugin.ts` verified) and the preset files were not inside any published dependency closure — a user following the docs could not select the Evolution preset. The same audit surfaced a single-flight race and seven P3 items.

- **P1-1 preset delivery**: `dsh-evolution-all` now depends on `dsh-evolution-agent-preset` (the preset container — `agent.cordis.yml`/`preset.yml` ship inside the published dependency closure); new `/evolution preset install` command copies them idempotently into `$DSH_HOME/.agent-presets/evolution/` (no manual file copying anywhere); docs (README/README.zh/INSTALL.md) updated to the one-time `preset install` step; command hint + help text list it.
- **P2-1 single-flight TOCTOU**: `maintainInFlightSince` is now set **before** the first await (`buildEnrichment` is the slowest segment) — check and set are adjacent across synchronous code only, so two re-triggers during the enrich window can no longer both pass the guard; concurrent-window regression test asserts the second trigger gets "already running" and the scan starts once.
- **P3-1 doc values**: `011-maintenance-subagent-v2.md` still said `maintainTimeoutMs 默认 120_000` (code: 600_000 since 0.3.10) and cooldown 130s with the withdrawn "≥ timeout" rationale (code: 30s since 80ec941) — corrected + "以 code 常量为准" note.
- **P3-2 unknown maintain args**: `maintain --foo` / `--timeout=600000` silently fell into the generic help branch despite the branch comment claiming explicit rejection — replaced with an explicit `^maintain\b` rejection.
- **P3-3 frontmatter boundary single-owner**: new shared `frontmatterBlock` is the single closing-`---` detector for parse/normalize/detector (previously `parseFrontmatter`'s `indexOf('\n---', 3)` also matched `\n----` while normalize/detector required a trimmed exact line — a `----`-closed file would be seen as no-frontmatter by the normalizer but parsed by the family parser).
- **P3-4 real-parser verification**: `normalizeFrontmatter` now re-verifies every rewrite with the real YAML parser (`js-yaml` — the platform catalog's parser; new `evolution-core` dependency + `@types/js-yaml` dev dep): if the rewritten block no longer parses or a rewritten value's parsed content differs (the multiline flow `[a,` fast-path mis-quote shape), the rewrite is rolled back and reported in `issues` — fail-loud, never a silent value mutation.
- **P3-5 protected set enforced**: `validate-plan` builds `protectedNames` from `report.skills[].protected` and rejects any recommendation naming a protected skill — §7 "protected set → 0 recommendations" is now mechanical, not prompt-layer only.
- **P3-6 abort detection tightened**: the abort signal is hoisted so the catch can consult it; detection is `abortSignal?.aborted === true || name === 'AbortError' || message === 'This operation was aborted'` (replaces the broad `/abort/i`) — a cancelled run still translates to the aborted message, an unrelated "abort" string no longer does.
- **P3-7 manifest version alignment**: `normalize-mirror` aligns every package + root manifest version to the newest CHANGELOG line (was a hardcoded dev baseline `0.1.0-rc.1` — 13 releases off from what humans read); the dev-tree twin is a documented no-op (never rewrites canonical dev manifests); the exact release version still comes from the git tag via `prepare-release --version`.

- Local: full suite 64/64 (398 tests), oxlint 0/0, tsc -b (core/maintenance/commands/all) 0.

## 0.3.13 (patch) — maintain template v13: §6 language de-coupling

Content-level audit of MAINTAIN_PROMPT (v12) found exactly one dataset-visible coupling: the §6 language rule hardcoded the output language as `（中文）` ("follow the library body language (Chinese)"). On a non-Chinese library this would mis-drive the output language.

- §6: `与库正文一致（中文）` → `与库正文语言一致（不自订语言）` — the design intent (output follows the audited library) is preserved; the language anchor is gone.
- `PROMPT_BUNDLE_ID`/`VERSION` 12 → 13 (template text changed semantically; id and version bump together per the module contract).
- prompts.spec: version pin 13 + anchor on the de-coupled wording + a `not.toContain('（中文）')` guard against re-coupling.
- Local: full suite 64/64 (393), oxlint 0/0.

## 0.3.12 (patch) — one-command aggregate entry `dsh-evolution-all` + install docs

The family's published install previously needed five entry packages. `dsh-evolution-all` (dependency-only aggregate, no composition rows of its own — `evolution-host` plus the three model-tool packages `tool-memory`/`tool-skill-manage`/`evolution-skill-catalog`) makes it one command:

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
```

- New package `evolution-all`: manifest-only aggregate (contract test pins the four-entry dependency set; `prepare-release` publish order extended).
- Docs (README/README.zh/INSTALL.md): install section rewritten with the aggregate entry, a mechanism sentence (auto-recognized `dsh.bundle.patch` manifests → dependency tree pulled without flags), and a "choosing an install" table mapping scenario → operation → capability surface (full family / host-only / fine-grained exposure / legacy preset) — the model-tool visibility column is the safety-posture information a decision table previously lacked.
- Local: evolution full suite + contract tests, oxlint 0/0, tsc 0.

## 0.3.11 (patch) — authoring normalization + review completeness batch (template v12)

The inkos-harness case exposed a class defect: its frontmatter description carried an unquoted `: ` (YAML plain-scalar violation), so the **platform catalog silently dropped the whole skill** (strict YAML parse) while the family's lenient `parseFrontmatter` still scanned it — a skill invisible to the platform but "present" to the audit. This release fixes the class at the write point, surfaces it in the audit, and closes the review-completeness gaps found across four real runs (13:38 / A-B arms / 15:01).

**Generation side (write-point enforcement — guidance already existed but was ignorable):**
- core: `yamlPlainScalarNeedsQuotes` (single rule source) + `normalizeFrontmatter` — `SkillLibrary.create/update/patch` auto-quote YAML-unsafe frontmatter values before writing (double quotes; single-quote `''`-doubling fallback so `"`/`\` values stay fixable — no catch-22 on legacy descriptions); unfixable control characters reject instead of writing a broken skill; `normalizedFrontmatterFields` reported back, tool-skill-manage surfaces it as an `Authoring check` line.
- `frontmatterYamlUnsafeValues` — raw-line scan shared by the normalizer and the audit detector (quotes included: a value normalized by the write path is never re-flagged).

**Audit side:**
- facts skill headers now always carry meta: `# skill=x (protected=none catalog=yaml-invalid)` — §7 "protected set → 0 recommendations" becomes executable from fact data; catalog-unloadable skills become a visible flag instead of the auditor's honest-but-silent read-failure.
- `maintenance_probe` `description_chars` returns `desc-text:` (truncated at 160 with `(truncated: N total)`) — the §5-B5 nature triage (event-commitment/narrative/dense) becomes exercisable for skills the auditor cannot read.
- template **v12**: §5-B2 pointer_missing one-way semantics (`支持文件存在、正文无引用` — fixes the 15:01 inverted finding); §5-B5 third-class gate is semi-mechanical now (write a ≤60-char compression attempt first; keeping all route keys disqualifies the third class; failure must show the attempt + failing point) + per-class text signatures + "text visible → still classify; length-only → conf≤0.4".

**Command side:** single-flight guard — a re-trigger while a scan is running returns "already running" instead of spawning (0.3.5 discovered the cooldown never covers in-flight runs; a re-submit used to cancel the running scan at the platform level).

**Data:** inkos-harness description double-quoted (the instance fix).

Tests: frontmatter normalize (+ truth table, idempotence, no-touch, catch-22 regression, embedded-newline skip), write-path integration (create/update/patch), raw-line detector, facts meta, probe desc-text, single-flight four-state. Local: 63 files / 392 tests, oxlint 0/0, tsc 0; real-library render: inkos `catalog=yaml-invalid` → (after fix) 6/6 `catalog=visible`, zero-touch verified byte-identical.

## 0.3.10 (patch) — maintain default timeout 120s → 600s

A bare `/evolution maintain` run (14:37, commandId cmd-adce9ea7-1) aborted with "Maintenance scan was aborted..." exactly **119.94s** after the subagent spawned — the `AbortSignal.timeout(120_000)` default, verified from session logs (child createdAt → turn/end kind:parent; no user interrupt, no duplicate submission). The child was mid-analysis (§4 step ②, B2/B5 with the inkos-harness read-failure being handled correctly per §4) and needed only more time — the 13:38 run with `--timeout 600000` completed the same scan. 0.3.4's flag was the workaround; the persistent default stayed too tight.

- `evolution-commands` `maintainTimeoutMs` default 120_000 → **600_000** (comment updated with the evidence).
- `evolution-maintenance` orchestrate `options.timeoutMs ?? 120_000` → `?? 600_000` (standalone default parity).
- No test pinned the old default (specs pass explicit values). Local: maintenance + commands 59/59, oxlint 0/0.

## 0.3.9 (patch) — maintain probe: single-source description/quality enrichment

First real run (13:38) surfaced a source inconsistency as a B5 note: the facts block measured real `description_chars` (198/104/…) from SKILL.md frontmatter while `maintenance_probe` answered `description=missing` for the same skills. Root cause: the probe tool built **body-only** snapshots and never ran the scan's enrichment — two measurement sources for one signal (the 011 single-source violation).

- `evolution-maintenance`: `buildEnrichment` (descriptions/supportFiles/quality/usageObserved over the live library) moved from `evolution-commands` into the maintenance package (`src/enrichment.ts`, re-exported by index) — enrichment construction is now owned next to the scanner and shared by the facts preview AND the probe tool.
- `tools.ts` probe execute builds snapshots via `buildEnrichment(ctx, library)` + `snapshotFromLibrary(library, { descriptions, supportFiles, quality })` — the same construction the scan uses; `description_chars` can no longer disagree with the facts block.
- `evolution-commands` imports the shared `buildEnrichment` (local copy removed, unused imports dropped).
- Tests: probe contract test — enriched description → `${len} chars`, snapshot without one → `description=missing`. Local: evolution suite 62/62 (374 tests), oxlint 0/0.

## 0.3.8 (patch) — maintain cancelled-run translation

A cancelled `/evolution maintain` surfaced misleading text: the platform's driver **resolves** (not rejects) a cancelled run with `structured: undefined, stopReason: "aborted"`, while the command-retry cancellation path can also reject with a plain `Error("This operation was aborted")` (name not AbortError). Both slipped past the 0.3.3 name-only detection and were reported raw/undefined-plan.

- `orchestrate` no-plan branch now reads `runResult.stopReason === 'aborted'` → "Maintenance scan was aborted (the run was cancelled before the subagent produced a plan) — retry when the session is idle; concurrent re-submission cancels the previous scan."; other no-plan results keep the clarified message.
- `orchestrate` catch broadens abort detection to `name === 'AbortError' || /abort/i.test(name + message)` — the plain-Error abort shape now translates too.
- Tests: plain-Error abort shape, cancelled settle with stopReason. Local: orchestrate + commands 58/58, oxlint 0/0.

## 0.3.7 (patch) — maintain template v11: prompt-guidance rebuild (subagent-verified loop)

MAINTAIN_PROMPT rewritten (PROMPT_BUNDLE v10→v11) after a three-round **rewrite → real-subagent run → review-against-standards → fix** loop on the real skill library. Guidance fixes that landed:

- **§3 completeness contract** (validator-enforced): every `over` signal must land in an item's evidence or be declared in notes ("已审·无条款对应·不动作") — no silent omission (fixes the earlier 5-of-12 overlong-line underreporting shape).
- **§4 workflow**: explicit 5-step order + honest tool-fact reporting on read failure (the previous run papered over an unreadable skill as "无法读取").
- **§5-B1 three-question test** for anchor-vs-residue (cross-file reference / extra semantics / deletion impact), explicit *anchor ≠ readable* (a >4000-char line splits even when the anchor verdict holds), and **no is_override on the anchor path** (override is the §7 appeal channel only).
- **§5-B5 nature triage with a strict third-class gate**: event-commitment → trim; narrative → compress; dense-but-compliant requires an explicit "60 chars cannot hold this use-case boundary" proof before an override grant (the first loop ran all six descriptions as "豁免" — the shortcut the gate now closes).
- **§6 confidence downgrade rule** (semantic inference caps at 0.4) + **pre-submit checklist** (§7 reviewer perspective: independent judgment first, self-narrative as clue only, stricter bar for self-owned skills).
- Verified by three subagent rounds: round 1 (broken input) executed the §1 contract refusal correctly; round 2 exposed the exemption shortcut + mechanism mixing; round 3 converged (4 of 6 descriptions diverge into compress/pending, B1 kept without override, honest tool-fact report). Local: prompts 12/12, maintenance 40, commands 16, anchored-smoke 2/2; oxlint 0/0.

## 0.3.6 (patch) — maintain plan: truthful undo_path default for irreversible items

First real subagent plan hit `Maintain plan rejected by validator: plan[0].undo_path: required` — the model omitted/emptied `undo_path` on an item whose `reversibility` was `none`. The mechanical gate now normalizes that case instead of rejecting: `reversibility: none` + missing/empty `undo_path` → `'n/a'` (the display/audit contract's existing value). Reversible items (archive/restructure/patch/rename) keep the hard requirement — a fabricated undo path is never acceptable. Tests: missing undo_path + none → ok with `n/a`; missing + restructure → still rejected.

## 0.3.5 (patch) — maintain cooldown default 130s → 30s

`maintainCooldownMs` default lowered to 30s. The old 130s rationale ("≥ maintain timeout, so the window also covers in-flight runs") was a comment bug: `lastMaintainAt` updates AFTER a run settles, so the window never deduped in-flight runs anyway — 130s only punished rapid legitimate retries (e.g. iterating a failing scan). 30s remains a sufficient misclick guard; the window still applies on success AND failure.

## 0.3.4 (patch) — per-run maintenance timeout flag

`/evolution maintain --timeout <ms>` overrides the subagent deadline for THAT run only — no file edit, no restart (the runtime-facing answer to "keep timing out"). `maintainTimeoutMs` stays as the persistent default; the flag wins when present.

- `evolution-commands`: maintain branch parses `--timeout <ms>` (positive safe integer, rejects anything else explicitly — 011 §3 no-silent-swallow), threads it into `runMaintain` options; command hint + help text updated.
- Test: flag parsing (invalid value rejected with guidance; `--timeout 600000` reaches the subagent start with a signal). Note the test library must be NON-empty — `runMaintain` short-circuits an empty library before the subagent start (the empty-library path returns "Nothing to do" without spending a model call).
- Local: commands 16/16 + maintenance 38.

## 0.3.3 (patch) — maintenance abort translation + configurable timeout

0.3.2's `/evolution maintain` could surface the raw platform abort text (`Error: This operation was aborted`) when the one-shot subagent hit the 120s `AbortSignal.timeout` deadline (or a cancelled turn) — the orchestrate catch funneled `String(error)` straight to the command reply.

- `evolution-maintenance` orchestrate catch now detects `AbortError` **by name** (DOMException does not reliably extend Error) and returns a readable message ("Maintenance scan was aborted (subagent timeout or cancellation) — retry, or raise the timeout..."); other errors get a `Maintenance scan failed:` prefix instead of the bare `Error:` text.
- `evolution-commands` gains `maintainTimeoutMs` (default 120_000) threaded into the subagent `signal` — slow providers / very large skill libraries can raise the deadline.
- Tests: AbortError translation (clean message, raw text absent), timeout pass-through via the signal, existing failure-message case unchanged. Local: orchestrate 11/11 + commands 15/15.

## 0.3.2 (patch) — subagent maxDepth semantics fix

0.3.1's `maintain`/`review` subagents crashed on any real run with `SubagentDepthError: subagent depth 1 exceeds maxDepth 0`. The `maxDepth` spawn option is the **absolute cap of the child's own delegation depth** (platform `resolveChildDepth`: `childDepth = parentDepth+1` must be `<= maxDepth`), not "the subagent may not nest" — a `0` rejects the spawn itself. P2-9 had verified the value as *legal* (validator accepts non-negative safe integers) but not the *semantics*; the shape pins locked the wrong value and fake-subagent tests never exercised the real check.

- `evolution-review` `config.reviewMaxDepth` default `0` → `1` (interface comment corrected too).
- `evolution-maintenance` orchestrate spawn `maxDepth: options.maxDepth ?? 0` → `?? 1`.
- `anchored-smoke.spec.ts` shape pin now asserts `1` with the corrected contract note; local run 38/38 green (maintenance suite + anchored-smoke).
- Integration-plan P2-9 note corrected with the 0.3.2 re-read.

## 0.3.1 (patch) — fixes the 0.3.0 maintenance package packaging

0.3.0 shipped `@lmzhen/dsh-evolution-maintenance` broken in two ways (both fixed here, both caught by a new pack-time guard):

- **Missing bundle chunk**: the tsdown build splits the shared `probe.ts` into `lib/probe-<hash>.js`, but the package `files` whitelist only listed `lib/{index,invariant,tools}.js` — `npm pack` silently excluded the chunk while `lib/index.js` and `lib/tools.js` both `import "./probe-<hash>.js"`. Runtime signature: `ERR_MODULE_NOT_FOUND` for `.../lib/probe-*.js` on plugin-tree load. Fix: whitelist is now `lib/*.js` + `lib/types/**/*.d.ts` (chunks ship, tsc-only `lib/types/*.js` and `tsbuildinfo` still do not).
- **Unrewritten scope in a second entry**: `rewriteScopedJs` passed a single one-shot `names.keys()` iterator into every file's rewrite — the first file consumed the whole family-name set, so later files kept `@deepseek-ai/dsh-evolution-*`. Only `evolution-maintenance` has a non-index entry importing family code (`lib/tools.js` → `@deepseek-ai/dsh-evolution-core`), which is why only it broke. Fix: materialize `[...names.keys()]` (re-iterable per file) + comment pinned at the call site.
- **Pack-time guard** (`prepare-release.mjs`): the post-pack validation now scans EVERY runtime bundle in `lib/` (not just `index.js`) for unrewritten family names AND resolves every relative `"./x.js"` import against the staged bundle set — both 0.3.0 defects would now fail the validate chain instead of reaching npm. Also accepts npm 12's object-shaped `npm pack --json` output (npm 11 returns an array).

## 0.2.1 (patch) — memory snapshot refresh bypass fix (v8 audit P2)

- **Write-sink refresh** (`memory/src/index.ts`): `MemoryRegistry.applyBatch` now emits `evolution/memory-applied` after ANY successful write — the snapshot refresh moved from the foreground `memory` tool's own callback to the single write sink. Bypass paths (`/graph edit|delete memory:` and background-review direct writes, both default-deployment paths) now refresh the model-visible snapshot instead of leaving it stale until the next foreground tool call.
- **Subscriber** (`tool-memory/src/index.ts`): listens to the event and re-renders `snapshotText` (best-effort; the local tool callback stays as immediate refresh — idempotent double refresh at negligible cost). Zero cache cost: an unchanged snapshot injects nothing, a changed one appends one tail message (platform dedup).
- Tests: registry event unit (emit after successful write), tool-memory bypass regression (direct `applyBatch` → assembled context snapshot contains the new fact). Local: P2 clusters 32/32, full 294/311 (17 red = 14 timeouts + feedback 8-writer + layout-sync timing + anchored-smoke scheduling-sensitivity — all known/isolation-green classes, zero memory-surface), tsc 0, oxlint 0/0.
- Tooling: `vitest.evo5.tmp.mjs` include restored for `memory/tests` and `learning-graph/tests` (they were never collected by the suite).

## Unreleased — v7 audit fixes (P1-1 restructure frontmatter duplication + P3-1/P3-2/P3-3)

- **P1-1 (correctness, in the tagged rc.1/rc.2 code)**: `restructure` assembled `header + plan.body` where the planner had been fed the FULL normalized text — every successful call wrote a second frontmatter block (duplicate `name`/`description` keys, accumulating on repeated calls). The lenient `parseFrontmatter` and all `toContain`-style tests tolerated it (v7 audit caught it; 009-R claimed "zero behavior change" and this betrayed that claim). Fix: the planner now receives the body only; structure-level regression added — parsed body must never start with `---` and a second restructure must not stack copies.
- **P3-1 (gate completeness)**: `supportRefs` now matches ANY extension and nested paths (`scripts/run.sh`, `references/sub/x.md`) — the `.md`-only regex missed both, so the "dangling links are not constructible" claim was stronger than the implementation. `..` traversal stays out of the link set (path validation owns that class). Regression: non-md + nested refusal in append mode.
- **P3-2 (comment accuracy)**: `appendUsageWindowEvent` no longer claims "the next observed read retries" — the anchor fires exactly once (view 0→1); a failed append is never retried (sidecar stays the truth).
- **P3-3**: removed the dead `tag` variable in mirror `publish-scoped.mjs` (unused since distTag auto-selection); 008 design doc gains an implementation note (`type:'usage'` not `type:'skill'`; restructure events live on the process bus, not the timeline; anchor is fire-once). Cosmetic double-blank-line residue in skill-store comments left as-is (zero behavior).
- Local: v7-fix clusters 33/33, full 303/308 (5 load-timeout/8-writer class failures, known pattern), tsc 0, oxlint 0/0.

## Unreleased — 009: unified tree-change kernel — package-integrity gate + reference-mode demote (design 009, all batches)

- **Kernel `applyTreeChange`** (`evolution-core/src/skill-store.ts`): the single commit point for deterministic tree mutations — owns validation order (badName → protection → preconditions mount → pre-read rollback bytes → semantic/bytes/threat validation), two-phase write with byte-level rollback, audit and the mutation event. Mutators compose `TreeChangePlan`s; consolidate and restructure no longer implement two-phase commit themselves (009-I + 009-R; the archive step stays outside the kernel — it is a tree-external move with its own rollback loop).
- **Package-integrity gate** (009-I): `supportRefs()` (pure) extracts support-directory links; append-mode consolidation REFUSES a source that carries support files or whose body links its own references/templates/scripts/assets — zero side effects (no archive, no write), the message directs to `mode:'reference'` or whole-package archive. Restructure refuses a moved section whose text carries support links (those links stay behind); a new pointer line is a fresh link to a file written in the same plan. Dangling support links are no longer constructible.
- **Reference-mode demote** (009-II): `consolidate(target, sources, origin, { mode: 'reference' })` writes each source's body (frontmatter stripped, provenance comment) as `target/references/<source>.md`, adds a `> 详见 references/<source>.md` pointer line to the umbrella body, and archives the source (absorbed-into). Source bodies with support links are refused (dangling demote). Nominator surface: `CuratorConsolidation.mode` + `parseCuratorNominations` reads an optional `mode:` line BEFORE `into:`; the curator executor threads it; CURATOR_PROMPT documents the mode line and the YAML ordering contract. PROMPT_BUNDLE bumped 8 → 9.
- Solves the audit gaps 3-1 (execution-time package integrity) and 3-2 (demote execution surface) in one architecture; 3-3 stays a declared design boundary (review channel creates new umbrellas).
- Tests: core consolidate matrix (append merge / support-files refusal with zero side effects / linked-body refusal / reference demote + pointer + archive / reference refusal) 5 cases, parse mode unit, curator demote chain (nomination → reference file → pointer → archive), prompts pin 9. 009 clusters 86/86, tsc 0, oxlint 0/0.

## Unreleased — C: observation window semantics + usage anchor events (008 batch IV)

- **Observation window（信号门，零持久化）**：`usageObserved(usage)`（core，纯派生）判定库内是否已有任一观察证据；curator `healthView()` 在窗口开启前**不向评估传递 usage 计数**——churn（写幽灵）维度整体抑制（无 counts = 无可信输入），新增 `usageObserved()` 公开方法供命令面使用。`/evolution skills health` 在窗口未开时输出 `Usage observation not yet established — churn (write-ghost) rows are suppressed.`，不再静默显示干净结果。语义：`view_count=0` 仅在窗口开启后（库内出现任一可观测读）才等于"从未被读"——A2 部署前历史读取不可见的迁移期失真由此消除。
- **Usage 锚点事件**（`evolution-events.ts`）：`EvolutionEvent.type` 联合扩展 `'usage'`，新增 `counts`（库级累计快照 skills/views/use/patches）与 `window.opened` 字段；skill-usage 在**库级首次观察读**（view 0→1）时向事件时间线追加一次锚点事件（`type:'usage'`, `kind:'skill'`, `source:'observation'`, `note:'observation window opened'`，best-effort，侧车仍为真值）。语义注释入模块头。`eventsHome` 加入 skill-usage Config（默认 DSH_HOME/`~/.dsh`，测试显式隔离）。
- 周期聚合快照（每 N 次观察）**有意未实现**：观察计数在 usage 侧车已权威（时间线事件仅作窗口锚+时序可回溯），快照在真实观察高频且需跨重启聚合展示时再加（见 known-limitations #4）。
- Tests: 锚点事件（首读写一次/不重复/快照语义）、窗口抑制（无 view 时 ghost 不出现）、commands 窗口注记（有/无观察两态）。C 簇 51/51，全量 296/299（3 例已知负载假失败类，隔离绿），tsc 0，oxlint 0/0。

## Unreleased — B: restructure execution loop — SkillLibrary.restructure + plan op + approval reuse + prompt line (008 batch III)

- **`SkillLibrary.restructure(name, moves, origin)`** (`evolution-core/src/skill-store.ts`): deterministic content-distribution repair — body sections anchored by their exact `## heading` line move into `references/<topic>.md` and each span becomes a `> 详见 references/<file>` pointer line. The skill's name/directory never change (routing stays; the fat body sheds log-like detail — the mechanical counterpart of A1's size/stamp/scatter signals). Deterministic contract: H2-only anchors, H2 section boundaries (deeper headings travel with their parent), `references/`-only targets (`RESTRUCTURE_TARGET_RE`, no `templates/`, no subdirectories), max 5 moves (`MAX_RESTRUCTURE_MOVES`), duplicate/ambiguous/empty sections rejected with zero writes, frontmatter + threat + byte-budget revalidation, pinned/bundled/hub origin gate, two-phase commit with full byte-level rollback, audit trail + `evolution/skill-mutated` event (action `restructure`). Never automatic: candidates come from the approved review plan.
- **Plan op** (`evolution-plan-validator`): `SkillOp` action `restructure` with `restructure: [{heading, to_file}]` — validator checks the non-empty list, the move cap per plan, non-empty headings, and the `references/<topic>.md` target shape.
- **Review channel** (`evolution-review` + `evolution-core/prompts.ts`): the SKILL and COMBINED review prompts gain the restructure preference step (only headings that exist verbatim; never restructure a healthy skill), PROMPT_BUNDLE bumped 7 → 8; `executeSkillDirect` routes the op straight into `SkillLibrary.restructure` with the `background_review` origin. Approval reuse is unchanged (runApproved / runner replay both carry the op as-is — the skill runner gained the restructure branch). Read-before-write now treats `restructure` like patch/delete: an op on a skill never read this session is dropped with the other unread ops.
- **Tool surface** (`tool-skill-manage`): `skill_manage` action enum + parameters gain `restructure` (with `heading`/`to_file` items) and the description carries the mechanism; the tool path converts `to_file` → `toFile` and records a patch (it mutates content).
- Tests: core restructure suite (single move / append / multi-move ordering / unknown heading zero-write / duplicate / empty / out-of-domain targets / pinned origin gate / deeper-heading travel), validator restructure branch (shape/domain/cap), tool end-to-end restructure, prompts version pin 8. Local: B clusters 94/94, full 294/296 (2 load-sensitive flake classes — feedback 8-writer transact + installer 20s cold window — both isolation green), tsc 0, oxlint 0/0.

## Unreleased — A2: skill-usage read observation + usage churn dimension (008 batch II)

- **Read-side observation** (`skill-usage/src/index.ts`): the service now listens on `session/event` for `tool/call` records of the read tools (`skill`, `skill_load`) — the same bus seam evolution-review already uses — parses the skill name the same way, and bumps `view` on EXISTING records only. The declarative `READ_TOOL_KIND` table is the single classification point; a read of an unknown skill never mints a usage record (records stay authored by creation / patch / curator seed). This closes the read-side telemetry gap: the usage sidecar's view counters are live, so `usage.json = {}` no longer means "no reads".
- **Churn dimension** (`evolution-core/src/skill-health.ts`): `assessStructureHealth` gains an optional usage dimension — patch count at/above `churnMinPatches` (default 20, `DEFAULT_HEALTH_THRESHOLDS`) with zero reads warns "patched N times but never read (write-ghost — content may be dead)". Absent counts keep the dimension null; the verdict logic and the six-factor quality scoring stay untouched.
- **Curator `healthView()`** now loads the usage sidecar and passes per-skill `patch_count` / `view_count` into the assessment; `healthChurnMinPatches` joins the threshold config surface. Existing behavior pinned: observation is additive wiring, the write path (`record`/`report`/`setQuality`/archival) is unchanged.
- Tests: session/event emission through a real Cordis ctx (view counts from `skill` + `skill_load`, non-read tools ignored, no mint for unknown reads), churn warn/ignore units, curator write-ghost row via seeded usage counts. Zero behavior change, zero version move (008 program stays main-only).

## Unreleased — rc.73 A1: skill structure-health observability (008 batch I)

- **`SkillHealth` domain** (`evolution-core/src/skill-health.ts`): a pure, derived assessment dimension beside the six-factor usage quality — `assessStructureHealth` over body size (soft limit 40k chars, `needs-restructure` at 2x), stamp density (rc.NN / commit-sha / ISO-date lines per KB — the "invalid info" indicator) and scatter (large body with no support groups). Thresholds are declarative `DEFAULT_HEALTH_THRESHOLDS`, curator-configurable (`healthSoftBodyChars` / `healthStampDensityPerKb`).
- **Curator `healthView()`**: degraded skills only (verdict + reasons), derived on demand — never persisted, never a 7th quality factor (different dimension, different consumers).
- **`/evolution skills health`**: prints degraded rows or a clean verdict.
- **100k gate split-advice**: the create and patch error messages now carry the original's "Consider splitting into a smaller SKILL.md with supporting files." — the one-line gap against the original.
- Design: `docs/design-review/008-skill-loop-completion.md` (judgement table, four-seam architecture, robust batch decomposition A1/A2/B/C). Zero behavior change: assessment is read-only exposure; both new seams are additive.

## 0.1.0 (stable) — rc.72 content: audit-v6 + deep-sweep batch (G-1..G-3, H-1..H-3)

- **G-1 (P2, seq shadowing after active loss)**: `appendEvolutionEvent` derives the next seq from the ACTIVE only — a missing/whitespace active with archives present restarted at seq 1 and, by the timeline's active-wins dedupe, shadowed archived history one event per append. Now the empty-active branch consults the archive NAME anchors (single numeric glob, no content parse) and continues FROM the highest archived seq; `rotateIfDue` guards `rotateAt < 2` and empty tails (a one-event rotation previously archived everything and restarted seqs at 1). Regression: deleted-active + archive → append seq 2, timeline [1,2] intact.
- **G-2 (P3, retention/metadata surface)**: archive naming is STRICTLY numeric (`/^events-\d+\.json$/`) — a user file like `events-backup.json` is neither read into the timeline NOR pruned; `readEvolutionEvents` isolates `readText` errors (EISDIR squatting archive names) — such a file flags malformed and is skipped, never bricks the boot.
- **G-3 (P3, retention window vs aggregate integrity)**: cache snapshots now run at a CACHE_SNAP_EVERY=1024 appends cadence (inside the record task, truncated to the window), so `cache.lastSeq` always stays inside the retained window — after a hard crash the fold is complete (the at-most-cadence gap lives in the ACTIVE log); plus a fold floor guard: a cache whose lastSeq fell below the timeline is IGNORED (full fold) instead of fabricating a partial fold.
- **H-1 (existing P2 known-record, solved)**: curator fold lifecycle ownership — `applyCuratorLifecycleFields` is applied only to the names the run ACTUALLY transitioned (transitions engine + archive success/rollback + consolidation sources, passed as `stateOwned`); concurrent curator runs no longer revert each other's archive/restore via stale snapshots. Meta (quality + pinned) still refreshes tree-wide. Tests: ownership unit + the P1-2 stale-window behavior preserved (the transitions engine mutates the snapshot — discovering that the stateOwned set had to include `markStale` and all transition names).
- **H-3 (observations)**: single `listEventArchives` helper (numeric glob) now feeds the timeline, retention AND the feedback migration check; `@deepseek-ai/dsh-llm` moved to peerDependencies in evolution-commands (family alignment — review/curator already peers).

## Unreleased — rc.71: event-log rotation (007 design)

The audit-v5 §3 growth warning is resolved by split rotation — the active log is bounded so a single append is O(active) instead of O(total-history).

- **Split rotation inside the append transact** (`appendEvolutionEvent`, `rotateAt` default `EVENT_LOG_ROTATE_AT=4000`): when the active reaches the threshold, the older half is copied to `events-<lastArchivedSeq>.json` (its own lock file — no recursion) and the active is replaced with the newer half + the new event; seqs stay globally monotonic. An archive-write failure aborts the append (active keeps the full old content — no loss). `rotateAt` is a per-call knob (tests use small values; not a config surface).
- **Crash-safe by seq-dedupe**: the boot timeline (`readEvolutionTimeline` = active + all archives, merged by seq — active copy wins, sorted ascending) makes the crash window (archive written, active rewrite failed) yield the identical timeline — no double counts, no loss. Per-file `malformed` flag as rc.70-F-1; a malformed archive is skipped, never bricks the boot.
- **Retention**: `EVENT_LOG_RETAIN_ARCHIVES=10` at rotation, pruned NUMERICALLY (names carry the last archived seq — `events-10` must not outrank `events-2`); best-effort per removal; a concurrent boot read races a delete safely (missing = skipped).
- **Migration condition tightened**: legacy synthesis runs only when the active is absent AND no archive exists — with archives present the archive timeline is the truth, so a manually deleted active is never re-synthesized from the cache.
- **Consumers**: feedback `restore()`/`persistCache()` read the timeline (folds unchanged — they consume a seq-sorted array); boot cost calibrated: active parse bounded, total parse O(history) (~100-200ms at 10⁵ events — acceptable; NDJSON+offset index deferred to the 10⁶ scale).
- Tests: threshold rotation (archive/active split, seq continuity, 5-event timeline), crash-window dedupe, numeric retention (12 → 10 keeps 3..12), archives-suppress-migration.

## Unreleased — rc.70: audit-v5 batch (all seven findings)

- **F-1 (P2, malformed-gate inconsistency)**: read and append now agree on ONE boundary — "malformed" means NOT VALID JSON (refused on append, bytes untouched); well-formed JSON with a damaged `events` field is REPLACEABLE garbage (reads empty, rebuilt at the next append); a single damaged entry is normalized away at the next append while valid entries survive (self-heal semantics, matching the usage sidecar's per-entry normalization on read). Tests: shape-damage reads empty + rebuilds, damaged-entry drop with valid-entry survival.
- **F-2 (P2, UserMessage contract)**: `/evolution learn` now injects through `createUserMessage` — `UserMessage` requires `role:'user'` plus the minted id; the bare object only worked because the DeepSeek adapter routes undefined-role into the user branch. `evolution-commands` gains the `@deepseek-ai/dsh-llm` dependency (the review path already used the same factory). Spec asserts `role:'user'` on the injected message.
- **F-3 (P3, stale diagnostics)**: the EPERM comment and the fail-loud message now say 40 attempts (matching the rc.69 budget).
- **F-4 (P3, empty-file residue)**: `migrateFeedbackEvents` skip path returns `current` (null stays null = "no file" in the transact contract) — an empty legacy aggregate no longer creates an empty `events.json`. Test: no file created.
- **F-5 (P3, design/impl alignment)**: the 006 design doc now states the cache's write form accurately ("atomic whole-file write (rename under the write lock) — not an RMW transact, the cache is derived and rebuildable").
- **F-6 (P3, observability)**: a failed learn-event append is now `ctx.logger.warn`-ed instead of silently swallowed.
- **F-7 (P3, gate regex)**: the sidecar-inventory regex typo (`async function?` quantified the `n`) is fixed; the known per-file (not per-write-point) granularity is documented as a manual-review remainder.

## Unreleased — rc.69: audit-followup fixes (migration merge race, empty-log self-heal)

The post-rc.68 audit found two real defects in the event-log layer; both fixed with regression tests.

- **B-1 (P2, migration merge race)**: the rc.68 migration was first-writer-wins — a concurrent first append that created the log between `restore()`'s read and the migration transact made the migration silently skip, losing the legacy aggregate entirely. `migrateFeedbackEvents` now APPENDS the expected legacy sequence (seq-shifted) whenever the log does not already contain it as a contiguous semantic run (type/kind/target/rating/note; `seq`/`at` excluded — merged logs carry shifted seqs and re-synthesis stamps a new `at`). Idempotent and race-safe (the search runs inside the same transact); already-migrated rc.68 logs never re-append (their sequence is present), so no double-count. Regression test: concurrent-first-event log + legacy aggregate → 4 events, second migration no-op, restore sees both sides.
- **B-2 (P3, empty-log brick)**: a whitespace-only `events.json` (crash residue) was treated as malformed — every future append refused, bricking the loop's data plane until manual deletion. Whitespace-only content now reads as EMPTY (rebuildable) and the next append writes a fresh log; genuinely corrupt bodies still refuse (rc.65 posture). Tests: empty read + append rebuild, feedback record after an empty log.
- **B-3 (CI-only, lock budget)**: the write-lock retry budget (10 × 50ms = 500ms) was too tight for 8-writer contention bursts on a loaded CI runner — a legitimate serialization surfaced as a fail-loud throw (rc.65 behavior, correct integrity, wrong budget). Budget raised to 40 × 50ms (~2s); fail-loud is preserved, bursts serialize.
- **Minor**: the `Config.path` doc no longer claims the event log is the cache file's sibling (events always derive from `home`, never from the override).

## Unreleased — rc.68: feedback event log — single source of truth (K-6 absorbed, /learn events)

The rc.66 hangover's real fix (append-only event log) landed per the reviewed design (`docs/design-review/006-feedback-events-single-source.md`).

- **Event log is the truth** (`$DSH_HOME/evolution/events.json`): new `evolution-core/evolution-events.ts` primitives (`eventsFile`/`appendEvolutionEvent`/`readEvolutionEvents`) — every feedback increment appends one `{ seq, at, type: 'feedback', kind, target, rating, note? }` event under the write lock (seq = max+1 inside the transact, cross-process unique; malformed logs refuse the append, rc.65 posture). `feedback.json` becomes a **rebuildable boot cache** `{ version: 2, lastSeq, skills, sessions }`, written only from the event-fold truth (never from the optimistic memory state — no phantom double-count at later boots); the in-memory state stays the optimistic aggregate with the rc.66 memory-wins restore semantics.
- **Migration (idempotent)**: no event log yet → the existing aggregate (legacy v1 or v2 cache) is folded into synthetic events once (first process wins the transact, later boots see the log and skip), then the cache is rebuilt from the log. Tests: migration counts/notes, idempotence across two boots, cache-incremental fold never double-counts after an append, concurrent appends keep unique seq, malformed log bytes preserved.
- **K-6 absorbed**: `record(target, rating, note?, kind?)` dropped the per-call `io` parameter — both paths derive from the constructor surface only (io backend + home), so path/backend mismatch is structurally impossible.
- **/learn events**: the learn branch appends `{ type: 'learn', source: 'manual', request }` to the same timeline (soft-probed `evolutionIo` registry; the inject is never blocked). Feedback and learn now share one ordered log, so the self-improvement loop ("feedback before/after learning X") is answerable.
- **Sidecar inventory**: 7th row — `evolution-core/src/evolution-events.ts` (`appendEvolutionEvent`) joins the transact list; the lockstep test floor moved to 7.

## Unreleased — rc.67: audit-v4 batch (curator write-path convergence, merge-heuristic input, read-before-write, /learn injection)

The four AUDIT_REPORT_v4.md findings that belong to this batch landed together with the previously-accepted merge-heuristic input and the /learn delivery fix.

- **K-1 (P2, control-plane usage write escaped the transact migration)**: `consolidate()`/`restore()` no longer load→modify→`saveUsage` (a bare whole-file write). Both now fold through `mutateUsage` — the same transact-backed RMW as the automated path. This also closes the data-loss the audit did not list: the old path parsed a malformed usage sidecar as empty and rewrote an empty map over the corrupt bytes; the RMW refuses to touch a malformed sidecar. Regression test: counters survive a control-plane consolidate, and a corrupt sidecar survives a restore byte-for-byte.
- **K-2 (P2, record-granularity fold clobbered window bumps)**: new `applyCuratorFields`/`foldCuratorFields` in core define the curator's OWNED field set exactly (`state`, `archived_at`, `quality_score`, `quality_warn`, `pinned`) and project the run-start snapshot onto the disk map at field granularity — a concurrent tool-side counter bump between run start and save survives. All three curator writes (lifecycle fold, consolidate, restore) go through it. Unit tests pin the exact field set and the preserve-under-stale-snapshot behavior.
- **Merge heuristic input (rc.67)**: `computePrefixClusters` (core, next to `computeDedupGroups`) deterministically indexes candidate names by their first alphanumeric run; `recommend()` hands the model a "Prefix clusters observed" orientation section (groups ≥2, largest first) instead of making it infer clusters from the raw list. Orientation-only: the candidate pool, gates, and LLM-nomination authority are untouched, so the M-1 executability boundary is unchanged. Tests: pure cluster function + prompt-capture assertion.
- **K-3 (P3, read-before-write wording)**: SKILL_REVIEW and COMBINED now carry the explicit enforced rule — only skills loaded or read this session may be updated/patched/deleted/support-filed; `CREATE` of a brand-new umbrella is the sole exception (mirrors `filterUnreadSkillOps`'s READ_REQUIRED set and its create exemption). Prompt bundle bumped to `dsh-evolution@7`; the plan variants inherit the sentence verbatim (template concat) and the contract test pins it.
- **/learn injection (was echo-only)**: command results never enter model history, so the old `return ok(buildLearnPrompt(...))` echo could never reach the agent. The learn branch now injects the prompt as a first-class user message into the invoking agent (same shape as the auto-review inject path) and returns a short UI-only status. Spec updated to assert the injected message (content + plugin source) instead of the echo.
- **Windows lock-create race (found during this batch)**: `withWriteLock` threw on `EPERM` from the `wx` lock-file create — Windows surfaces the concurrent-create/delete race as `EPERM` instead of `EEXIST`, so a peer's holder-lock delete racing our create aborted the whole write. `EPERM` is now treated as the same retryable contention as `EEXIST`; the retry budget still fails loud.
- **Cleanup**: the audit's K-4/K-5 (stale `before dispose` comment, squeezed line in the curator-report command), plus four misplaced audit-number labels in code comments (`review` "M-4", `curator` "M-5"/"M-4", `state-domain` "M-9") — the v4 audit verified those fixes as self-check items but did not flag the labels; they now read `v3-round self-check`.
- K-6 (feedback `record` io/path mismatch) and the feedback event-log redesign are deliberately NOT in this batch: K-6's fix would be thrown away by the rc.68 single-source-of-truth redesign that absorbs it.

## Unreleased — rc.66: hanging-limit closeout (feedback transactional counts + lock liveness probe)

The four documented hangover items analysis concluded two were real and solvable with existing platform interfaces; both now landed.

- **feedback counts are transactional (was P3-①)**: `EvolutionFeedback.record` no longer accumulates in memory and flushes an overwrite — each increment runs INSIDE the transact (locked read → +1 → write), the same pattern as memory/activity/state-json. The in-memory state is now a read snapshot (settling to the on-disk truth after each locked write) with a synchronous optimistic update so `score()`/`setQuality` stays immediately consistent; malformed sidecars are still never overwritten; the old `flush` merge path is retired (each record is already durable) and unload now awaits the record task chain (`waitIdle`). The cross-process same-target lost-increment limitation is gone — regression test: two instances recording the same skill concurrently end with the exact sum on disk.
- **write-lock liveness probe (was P3-②)**: the >5s stale-lock takeover now reads the holder pid from the lock file and probes it with `process.kill(pid, 0)` — a LIVE holder is never stolen (a slow writer keeps its lock across the 5s mark), a GONE pid is taken over. The only remaining best-effort surface is pid-reuse-level; the retry budget still fails loud (rc.65). Tests: live-holder refusal, gone-pid takeover, plus the updated stale test.
- **reviewProvider note (was audit misreport)**: the schemastery field is documented as optional-by-default, matching the interface and the "Omit to inherit" doc.

## Unreleased — rc.65: v3-audit P3 batch (dead code, data boundaries, interface/doc hardening)

- **Dead-code privatized (5, test-free)**: `EVOLUTION_SKILL_RANK`, `CAPABILITY_NAME_RE`, `scorePlan`, `collectReadSkillNames`, `COUNTER_SWEEP_THRESHOLD` lost their exports (module-private helpers). Test-consumed exports (`gateConsolidations`, `shouldCompletionReview`, `filterUnreadSkillOps`, `sweepDeadSessionEntries`, `graphDensity`) were verified against the audit's own rule and left exported — test infrastructure, not dead code.
- **Data boundaries**: `mutateUsage` / `recordMutation` / `updateSuppressedNames` now refuse to rewrite a malformed sidecar (the swallow→empty→persist path would destroy recoverable telemetry; regression test pins byte preservation); a failed-archive rollback also clears `archived_at` (the pre-transition record read as 'active' with a stale archive timestamp); `plan-validator` accepts `event_seq` only as a real integer or a numeric string — `Number(null)` no longer mints seq 0; `signals.ts` documents that `turnsSinceSkill` is an activity-weighted counter (field kept for on-disk compatibility).
- **Feedback merge reverted with rationale**: the additive cross-process merge was rejected after the restore+flush double-count surfaced — a stateless JSON sidecar cannot distinguish two processes incrementing the same target from one record seen twice. The union-by-target overwrite stays, with the limitation documented (an append-only event log is the real fix).
- **Interface/docs**: the stale untracked `evolution-io/src/index.d.ts` artifact (missing transact/isSymlink) is deleted; `tool-skill-manage`'s `ApprovalLike` mirror narrows `origin` to the real 2-value contract; capability submission states the required `stageForeground=true` explicitly; `approval.registerRunner` throws on a duplicate kind instead of silently shadowing the first runner.
- Local harness include gained the `evolution-plan-validator` spec tree (another CI-only coverage gap closed).

## Unreleased — rc.64: v3-audit P2 batch (all eleven findings)

- **Tool layer**: `action=edit` now gets the same authoring/strict gate as create/update (the enum alias bypassed it — regression test added); staged approval args carry BOTH the approval origin and the library origin, so replay of a delegated-subagent write keeps the `subagent` library semantic and the pinned guard stays consistent; the tool description now states the enforced pin rule precisely (foreground and delegated subagents may; never from a background review).
- **Orchestration**: `latestReport()` reads each report's own `startedAt` instead of sorting UUID filenames (regression test: name-"a" newer beats name-"z" older); the curator's usage fold persists through `mutateUsage` (transact-backed) so a concurrent usage bump between run start and save is not clobbered; the review subagent's skill reads are collected AFTER `await run.result` so read-before-write sees them.
- **IO/state**: the memory oversized-file read-guard runs BEFORE the transact entry (inside, the backend has already loaded the whole file — "never loaded" only holds pre-lock; the in-flight refusal path that rewrote full bytes verbatim is gone); `evolution-state-json` state mutations (review/curator/pending claim, release, resolve, save) run through `transactIo` with the process chain as the second layer — the JSON provider was the last cross-process unsynchronized RMW; `evolution-state-domain` catches only `DomainError('missing-key')` and lets closed/backend failures propagate instead of masquerading as "already resolved" (both providers' tryResolvePending semantics aligned).
- **Architecture**: the curator prompt no longer promises scheduled-task reference rewriting that the engine never performs (referenced skills are stated as fully protected); `evolution-learning-graph` binds its command registration to the fiber via `ctx.effect` so HMR/reload cannot duplicate `/evolution graph`.
- Local harness gained the two previously-uncovered spec trees (state-json/state-domain tests) and the `dsh-storage-json` alias — the local full-suite coverage now matches CI's include surface for these packages.

## Unreleased — rc.63: v3-audit round (M-1…M-7) — prompt-channel separation, candidate-pool integrity, guard hardening

All seven findings of AUDIT_REPORT_v3.md landed in one round.

- **M-1 (P1, nomination channel vs execution reality)**: `CURATOR_PROMPT` is now an explicit NOMINATOR view — the operative "Your toolset:" section (skill_manage actions the channel never had) is gone, replaced by a "no tools, single deliverable = the YAML block" statement plus a "Return ONLY the YAML block" hard output constraint. Two hard backstops make the boundary mechanical: the recommendation parser now filters `consolidations` by the candidate pool (symmetric with prunings), and `applyMutations` refuses (visibly, into report `failed`) any consolidation whose source is outside the exact pool this run presented to the model — a model narrating actions it did not take can never land a real tree change.
- **M-2 (P2, review persona vs subagent tool filter)**: new `SKILL_REVIEW_PLAN_PROMPT` / `COMBINED_REVIEW_PLAN_PROMPT` channel variants — the full review policy with a channel-limited deliverable note ("only the read-only `skill` tool; deliverable = the structured plan; never narrate actions you took"). The subagent path uses the plan variant (`reviewPrompt(kind, 'plan')`); the inject path keeps the operative wording. Prompt bundle bumped to `dsh-evolution@6` (both variants in the digest).
- **M-3 (P2, my rc.62 regression)**: prunings nominations are filtered back to the deterministic stale pool only — dedup members join the recommendation pool for CONSOLIDATION inputs, never for pruning; an active non-stale skill is not archivable via LLM nomination. Regression test: a dedup member nominated into `prunings` stays in the tree.
- **M-4 (P3)**: memory transact wrappers return `null` on failure-with-missing-file (DELETE is a no-op when nothing exists) instead of fabricating an empty MEMORY.md/USER.md. Test: failed batch on a missing file leaves it missing.
- **M-5 (P3)**: `verify-layout-sync.mjs` dropped hardcoded `--auto` machine paths — both layout paths are required arguments.
- **M-6 (P3)**: the layout-sync header now states the actual coverage (scripts/ trees only; `packages/` is the normalize-mirror release surface, `--deep` deferred).
- **M-7 (P3)**: `verify-platform-ranges.mjs` fails loud when `--our-scope @deepseek-ai` would make family/platform deps indistinguishable (`--family-prefixes` required); feedback `parseState` excludes array shapes; tool-skill-manage documents why `systemPrompt` uses the soft `ctx.get` probe (optional service) vs `approval`'s hard `inject` (deliberate per dependency strength).

## Unreleased — rc.62: engineering-debt closeout (P1 ①②③ + P2 ④⑤⑥)

All six items from the formalization-readiness inventory landed in one batch (no release formalization yet — the 0.1.0 move stays a separate operator decision).

- **P1-① memory files transactional**: `MemoryStore.add`/`applyBatch` now run their read-modify-write inside `transactIo` — the last RMW media outside the sidecar inventory. A locked-view drift check replaces the second read (`driftFromRaw`, same formula as `detectDrift`), and every failure/no-op returns the current content unchanged (IMPORTANT: `null` means DELETE in the transact contract — returning null on a no-op wiped the file, caught by the existing regression suite during this batch). Regression tests: concurrent batches through a locking backend keep both records, concurrent adds too.
- **P1-② layout-sync guard**: `verify-layout-sync.mjs` compares the dev-tree and mirror `scripts/` trees with line-ending normalization — any real drift fails loudly (D-7 class). The batch also discovered and fixed a LIVE drift: the mirror `build-lib.mjs` carried CRLF while dev was LF. Subprocess tests cover identical/modulo-endings, content drift, and one-sided files.
- **P1-③ sidecar inventory enforced**: the inventory test reads the actual sources and asserts every RMW sidecar (usage / mutations / suppressed / activity / feedback / memory media) implements its write through `transactIo` — the documented list is now a mechanically enforced door. The inventory itself caught `evolution-feedback`: it was in the documented list but still did a plain full overwrite; `flush` now merges with the disk state inside a transact (union by target, in-memory values win) instead of clobbering another process's records. The local vitest harness also gained the missing `evolution-feedback` include.
- **P2-④ Learn workflow**: `DSH_AUTHORING_STANDARDS` ends with the 4-step learn operation chain (gather sources → apply requirements → author exactly ONE SKILL.md → report name/category/summary), the Hermes `learn_prompt.py` flow adapted to DSH tools.
- **P2-⑤ merge heuristic input**: curator recommendation candidates now include near-duplicate group members (via `computeDedupGroups` on the tree) in addition to the deterministic scanner's stale names — the LLM sees overlap even when the deterministic side sees nothing. Fake-LLM test asserts both members appear in the recommendation prompt.
- **P2-⑥ installer local false alarms**: the three slow installer tests gained explicit 60s timeouts (they were eating the vitest 5s default on slow local pnpm cold starts while CI stayed green) — the local full suite is now green for the first time (222/222).

## Unreleased — rc.61: authoring wording precision + mount/restore contract for the 60-char catalog cap

- The `Authoring check` over-bar line now states the mechanism precisely instead of asserting deployment specifics: "exceeds the 60-char authoring bar (Hermes standard; the catalog truncates at the configured platform cap)" — true on both a 500-cap platform and one injected with 60 by the host bundle, and no longer claims truncation unconditionally (the P0 wording correction becomes deployment-neutral).
- New contract test for the "mount to inject, unmount to restore" semantics the host bundle already provides: `evolution-host/cordis.patch.yml` carries the `catalogDescriptionMaxLength: 60` as a TOP-LEVEL override of the base `tool-skill` row (never an inserted duplicate that would mount the tool twice). Installing the host bundle injects the 60-char cap automatically; removing it restores the platform default (500 on the validated anchors, or whatever a later profile overlay replaces it with). The test loads the real installed patch through the loader and asserts both the override value and the insert-free shape; a profile overlay may still replace the value later in the chain.
- (Background: the upstream dev HEAD has since changed the platform default to 60 itself — the bundle injection simply pins the Hermes behavior across platform versions.)

## Unreleased — rc.60: authoring feedback (P0) + curator scale adaptation + merge-chain auditability (P1)

The product-manager pass on the second-round review: the highest-value near-term items are the knowledge "first mile" (does a new skill's description get written well enough to route?) and making the merge channel — which has never fired — auditable and trusted.

- **P0 — authoring check in `skill_manage`**: new `authoringFeedback()` in core evaluates a frontmatter description against the 60-char bar WITHOUT changing platform validation semantics (the 60 rule was prompt-only while the implementation checked 1024 — the same standard-vs-implementation drift class as the F-1 README fix). `create`/`update` success messages now carry an `Authoring check:` block: `description N/60 characters` (or the exceeds-the-bar warning naming the Hermes authoring standard — the platform index cap stays a platform config, `tool-skill.catalogDescriptionMaxLength`, whose defaults differ across platform versions) plus the colon→double-quote rule when the description contains a colon. New `descriptionStrict` config (default **false** — advisory only) refuses an over-bar description up front when enabled. Tests cover the pure function (bar/colon/absent), the advisory message, and the strict refusal.
- **P1a — curator scale adaptation**: the CURATOR_PROMPT's "expect 10-25 clusters" (an original-library-size assumption) now scales with the library: a large collection may show 10-25 prefix clusters, a small one often has none, and a clean "nothing to consolidate" summary is the correct small-library outcome. Prompt bundle bumped to `dsh-evolution@5`.
- **P1b — merge-chain auditability + trust**: the end-to-end "LLM recommendation → gate → absorb → archive → report" chain was never covered — a fake-LLM test now proves the whole path (source archived, umbrella body absorbed, usage state folded, report recording the consolidation). The report shape gains `consolidated: CuratorConsolidation[]` (actual executed merges with from/into — previously only the raw nomination list was persisted, so executed merges were not auditable); `renderCuratorReportMarkdown` gains a line for it. Library-scale note: with a 2-skill library and `llmReview` off by default the channel stays dormant by design; it is now trusted when it fires.
- **P2 — already implemented, one fix**: `MEMORY_GUIDANCE` (Hermes dual-track for memory) turned out to already exist in `tool-memory` and to be mounted as a system-prompt section — the only warp was its `session_search` reference naming a Hermes-only tool; it now names the DSH session-query tool.

## Unreleased — rc.59: Hermes prompt alignment (operation/guidance parity, DSH-adapted)

The prompt bundle is rebuilt against the Hermes originals (`agent/background_review.py`, `agent/curator.py`, `agent/learn_prompt.py`) — the operational steps and instructions the model follows now mirror them structurally, with tool/platform differences DSH-adapted and DSH-only additions marked as such.

- `SKILL_REVIEW_PROMPT` rebuilt to the original's structure: "a pass that does nothing is a missed learning opportunity" posture, the expanded signal list (user frustration with concrete quoted signals is a FIRST-CLASS skill signal), the detailed 4-step preference order (loaded-skill first, support-file taxonomy with `references/`/`templates/`/`scripts/` per-kind guidance and the SKILL.md pointer rule, class-level naming ban for PR-number/error-string/session-artifact names), and user-preference embedding ("memory = who the user is and current state; skills = how to do this class of task for this user"). Pinned semantics keep the DSH guard (read-only within the background review pass — foreground and delegated-subagent writes stay allowed), NOT the Hermes "pin only blocks the curator" wording.
- `COMBINED_REVIEW_PROMPT` mirrors the same guidance; both prompts carry a new DSH addition — the two-tier deposition discipline (PATTERN → SKILL.md body / LOG → references/, body density IS reuse rate, 2-8 physical lines, prefer current-state pointer over history) — the operationalization of this repo's skill-library governance rules.
- `CURATOR_PROMPT` gains the original's load-bearing sections: umbrella-building posture ("not a passive audit"), the protected-directives detail (scheduled-task-referenced may be consolidated only because references get rewritten, never pruned), the never-used-skill 30-day + obsolete bar, package integrity (inspect the skill as a complete directory package; never flatten SKILL.md alone when support files exist; re-home or archive whole packages, never leave dangling relative links), narrow-name flagging, the real toolset list (`ask/consolidate/restore`), the "keep is legitimate only when already an umbrella" bar, iteration ("don't stop after 3 merges"), and the exact `consolidations`/`prunings` YAML block contract (every archive in exactly one list, block AFTER the human summary).
- `DSH_AUTHORING_STANDARDS` gains the colon-double-quote rule, the privacy motive for the literal `author: Hermes` (an environment-derived name is a leak — skills get shared), and the refined platforms guidance (OS-bound primitives ⇒ matching OS; fix cross-platform first).
- New `SKILLS_GUIDANCE` (Hermes `SKILLS_GUIDANCE` analogue): save skills after complex tasks (5+ tool calls) / tricky errors / non-trivial workflows, and patch outdated skills immediately ("skills that aren't maintained become liabilities"). Registered as a system-prompt section by `tool-skill-manage` exactly when it mounts — the DSH analogue of Hermes' `if "skill_manage" in agent.valid_tool_names` condition, so the guidance never names a tool the model lacks.
- Prompt bundle bumped to `dsh-evolution@4` (PROMPT_BUNDLE_ID/PROMPT_BUNDLE_VERSION). Alignment-contract tests: prompts.spec pins the load-bearing instruction points of every prompt (signal list, naming ban, pinned semantics, two-tier rule, package integrity, output block, colon-quote/privacy standards, guidance presence) and tool-skill-manage.spec pins the section mounting through a real systemPrompt assembly.

## Unreleased — rc.58: sidecar transactions (N-4) + preset collision guard (N-5) + CI purity (N-7) + docs batch (F-1/F-3/D-5)

- `evolution-activity` now folds each plan outcome inside `io.transact` (through `transactIo` and the evolution IO adapter): the read→fold→write runs under the backend's cross-process lock, so a second process sharing DSH_HOME can no longer interleave between the read and the write. The single-process chain stays as the second layer; the local `ActivityIoLike` interface is gone (core `EvolutionIoLike` is the one IO surface), and `parseActivityContent` is extracted as the pure parser. `EvolutionIo` (registry interface) now declares the optional `transact`/`isSymlink` probes, mirroring core — the node provider already implemented them at runtime; the type now matches. Regression tests: concurrent folds through a locked in-memory backend keep both records; the no-transact fallback path behaves as before. (N-4)
- The generated agent preset composition rejects row-id collisions: a delta row whose `- id:` also exists in the runtime `standard` composition would mount twice (and could shadow the platform row). `install-layered.mjs` parses both fragments (lightweight line parse, no YAML library) and fails loudly with the colliding ids; `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1` escapes with a warning for upstreams absorbing a delta row. `DSH_EVOLUTION_DELTA_PATH` lets tests inject a delta fragment. Regression tests cover both directions. (N-5)
- CI purity (N-7): the released-upstream compat job no longer overwrites the released tree's `tsconfig.base.json` with a mirror copy (the mirror base serves the pinned baseline and had actually drifted from the released tree — missing `dsh-attachment/types`, `dsh-authorization/types` and more path entries). It now injects ONLY the evolution alias path lines via `inject-evolution-paths.mjs` (single source: the mirror base's evolution lines) and fails loudly if the released tree already declares an evolution alias key. Regression tests cover injection and the loud conflict.
- Docs batch: README claims about the default review tool allowlist corrected (default is `[skill]`; `skill_search`/`skill_load` are opt-in where the platform exposes them), the static "45 files / 90 tests" gate numbers replaced with a CI-validated statement, the retired `dsh-evolution` facade row and `id` example removed from `packages/README.md`, and the dual-layout path note (dev tree `packages/evolution/scripts/` vs mirror `packages/scripts/`) added. `docs/release/decisions.md` records the second-round decisions: publish consumes only baseline artifacts (compat is a pure interception gate), the root-config policy (baseline overlays mirror configs, released injects aliases only), and the sidecar transaction list (usage / mutations / suppressed / activity / feedback — every new RMW sidecar must join it). (N-7 + F-1/F-3/D-5)

## Unreleased — rc.57: L0 data hygiene (N-3 timestamps + N-6 archive snapshots)

- `normalizeUsageRecord` now validates timestamps by `Date.parse` finiteness, not just `typeof string`: a corrupted sidecar carrying `"not-a-date"` / `"2026-13-99"` used to survive as Invalid Date and propagate NaN into the quality-score math and every lifecycle `daysSince` comparison. Garbage activity stamps now fall back to null (treated as "never"), and a garbage `created_at` anchors the age clock at now — matching the semantics the comment already claimed. `last_used_at` / `last_viewed_at` / `last_patched_at` / `archived_at` share the same guard. (N-3)
- Regression tests on all three consuming faces, failing on the pre-fix code (verified by temporarily reverting the guard): `usage.spec` pins the fallback values, `quality.spec` pins a finite score + boolean warn through `normalizeUsageRecord → computeQualityScores`, `curator.spec` pins a garbage-activity record still transitioning on its valid `created_at` instead of vanishing from every decision via NaN. (N-3)
- `SkillLibrary.archive` collision guard: two re-archives of one skill within the same second used to share one stamped destination and overwrite each other; the stamp probe now keeps appending a random suffix while the destination exists, mirroring the `snapshotAll` guard. Regression test archives the same skill three times in one second and asserts three distinct, complete destinations. (N-6)
- `retainSnapshots` comment now states the actual behavior (older snapshots removed outright) instead of claiming a `.backups history` fold that never existed. (N-6)

## Unreleased — rc.56: platform-version reconciliation (N-2) + CI range guard

The v2 audit's second P1: publish metadata declared `@deepseek-ai/dsh-*` peer ranges as `^0.1.0-rc.6` (`UPSTREAM_VERSION`) while the compat gate validated the release against `dsh-v0.1.1-rc.2` — under semver prerelease rules `^0.1.0-rc.6` does not match `0.1.1-rc.2`, so the declared support range silently diverged from the platform actually validated.

- Single version definition point: the release workflow now carries one `PLATFORM_VERSION`; the compat gate's `upstream_ref` derives as `dsh-v${PLATFORM_VERSION}` and the pack step rewrites every platform `@deepseek-ai/dsh-*` range to `^${PLATFORM_VERSION}`. The dev baseline (`UPSTREAM_SHA`) stays a validate-only anchor and no longer feeds release metadata.
- `prepare-release.mjs` takes `--platform-version` (renamed from `--upstream-version`) and the composite action passes the input through both jobs.
- New mechanical CI guard: `verify-platform-ranges.mjs` walks every staged manifest after packing and asserts each `@deepseek-ai/dsh-*` platform range equals `^${PLATFORM_VERSION}`, failing loudly with the offenders (family-scoped `@lmzhen/dsh-*` packages are exempt — they range against the family's own release version). Runs in both the baseline and released-upstream validate jobs, before the publish dry-run.
- Guard regression tests (subprocess over fixture manifests): correct ranges pass, a drifted `^0.1.0-rc.6` fails with the package and expected range named, malformed/missing manifests are tolerated.

## Unreleased — rc.55: report-surface regression fix (N-1) + report-surface contract tests

The v2 audit (`AUDIT_REPORT_v2.md`) found the rc.49 P2-6 optimization ("one directory listing replaces per-marker exists() probes") introduced a real regression: `SkillLibrary.list()` matched marker entries WITHOUT the dot prefix, so every `protectedBy`/`managed` report was poisoned (null/false) — the `skill_manage review` text lost its `[pinned]` markers and the curator's `protectedNameMap` went blind (its `scopeView().protected` stayed correct only through the `seedBaseline` `isPinned` mirror as a second layer).

- `SkillLibrary.list()` now matches directory entries through the single `markerEntryName()` helper shared with `markerPath()` — the dot-prefixed marker name can never drift between the `exists()` probes and the directory scan (N-1). The two previously carried independent literals, which is exactly how the rc.49 convergence dropped the dot.
- Report-surface contract tests (the N-1 anti-regression sample of the v2 plan §8): `skill-store.spec` pins `.pinned` → `protectedBy: 'pinned'`, `.hermes-managed` → `managed: true`, and bundled > hub-installed > pinned precedence on a triple-clash; `curator.spec` pins a dot-marker pinned skill appearing in `scopeView().protected` and a plain skill not; `tool-skill-manage.spec` pins the `[pinned]` marker in the review text. All three fail on the pre-fix code.
- D-7 (moved up from the rc.59 batch): the mirror `tsdown.package.config.ts` entry glob dropped its phantom `startup` — the dev-tree config lost it in rc.51 but the publishing carrier kept it, so published bundles referenced a `lib/types/startup.js` that no build produces.

## 补记 — rc.49–rc.54 (backfilled entries; findings for this span: `AUDIT_REPORT_v2.md` §2)

- rc.49: decision C — mutation events sink into `SkillLibrary` (one emission point; catalog invalidation covers every write path) + P2-6 list N+1 convergence (one directory listing replaces per-marker probes; snapshot parallel copy; catalog get shares the list) + G6 report keep-20 retention with markdown digests.
- rc.50: seam hardening — `io.transact` atomic RMW (usage/mutations/suppressed via `mutateUsage` et al.), list ENOENT-vs-EACCES distinction, `dshHomePath` helper, feedback awaitable dispose + serialized queue, snapshot restore residue clearing, G7 symlink guard on archive/restore-from-archive.
- rc.51: M4 engineering closeout — decision D2 declarations, dead-code removal (JsonState, `MemoryStore.replace`/remove), capability retired from host/preset rows (D-9), version single-source, published-upstream compat job, docs (F-2/4/6/7, G8 superseded markers, rc39 2.9 re-anchor).
- rc.52: curator suppression save resurrected a concurrently deleted name — the suppression save is now a delta-only union (only this run's additions), plus P2-14 comment truth and usage regression tests.
- rc.53: evolution-agent becomes delta-only — the agent preset composition is generated at install time by `install-layered.mjs` from the RUNTIME platform's standard rows (the compat byte-for-byte alert retired; compat job full chain green).
- rc.54: compat-check promoted from watching to a hard publish gate — publish now `needs: [validate, compat-check]`; a released-upstream incompatibility blocks releases.

## Unreleased — rc.48: fail-closed fix for the rc.47 approval pre-check

A regression review of rc.46-47 found one behavioral defect, shipped with an updated regression test.

- The rc.47 P1-9 pre-check ("approval enabled but no replay runner registered") chose to EXECUTE the write through the review's trusted direct path. That silently bypasses an explicit operator control: enabled approval means autonomous writes must pass human review, and a host-only deployment has no approval path — so the correct behavior is to refuse the write (fail closed), not stage it and not execute it. The review now skips the op with a visible warn and an explanatory result message; the pending queue stays clean and the gate holds. Writes become answerable again as soon as a tool that registers the runner mounts, or the operator disables approval. (fixes the rc.47 change; the pre-rc.47 behavior — accumulating unanswerable pendings — was the original defect)

## Unreleased — rc.47: orchestration closeout (M2/M3) + memory error surface (G5)

- P1-9: the review pipeline pre-checks `EvolutionApproval.hasRunner(kind)` before requesting approval — with approval ENABLED but no registered runner (host-only compositions mount no tool runners), the write now executes through the trusted direct path instead of staging a pending record that no approver could ever replay. The approval service exposes `hasRunner` and warns when staging an un-replayable kind; `capability` records are exempt (they are answerable without a runner). Covered by an end-to-end test asserting the write lands and the pending queue stays empty.
- P2-9: the three review subagent contract points are verified against the dsh-v0.1.1-rc.2 source and pinned by smoke assertions — `toolFilter: { allow: [...] }` matches `ToolRestriction`, `outputSchema.items: { type: 'json' }` is the DSL's lossless JSON node, and `maxDepth: 0` is a legal non-negative safe integer that blocks further spawns.
- G5: failed memory mutations now echo the current entries so the model can self-recover without a separate read (Hermes `memory_tool.py` recoverable-error parity): missing `old_text`, missed matches, ambiguous multi-matches and budget failures append a bounded `Current entries (preview)` block — at most 5 entries of 80 characters each, long entries truncated.
- P1-5 / decision C adjudicated (documentation only, implementation next batch): skill write-event emission sinks into `SkillLibrary` as the final state; this batch deliberately does not implement it to avoid rework against the next batch's refactor. The acceptance criterion is recorded: any write path leaves the native `ctx.skills` catalog immediately consistent.

## Unreleased — rc.46: control-plane decisions (M2) + model-text v3 (G4)

- Decision B landed: `EvolutionGateSet` in core is the single source for the name-set protections (excluded / referenced / suppressed / protected builtins), reporting a `blockReason` so surfaces can explain refusals. All four former gate implementations — the lifecycle engine, the scope view, the LLM nomination gate and the control-plane consolidate — now read one instance; `gateConsolidations` additionally blocks protected builtins (e.g. `plan`) that the name-set check missed. (P1-8)
- Control-plane `/evolution consolidate` enforces the full gate set: the manual path used to check only `excludeSkillNames`, bypassing the referenced/suppressed/protected protections the automated nomination gate enforces. (P1-8)
- P1-12 resolved as documentation (per the Hermes-alignment audit: the behavior is ✅ aligned): foreground-created skills stay outside the deterministic lifecycle because only the review pipeline marks agent authorship; `manageUnmanaged: true` opts them in. Documented in the README.
- P2-11 resolved by deletion: the `policy.json` path defense (`protectedPaths`, `isProtectedPath`, the file-tool arm of the policy guard) defended an artifact nothing in the product ever reads or writes. The real defense — governance-key refusal on the evolution tools — is untouched and now covered directly in the policy spec.
- Origin mapping single-sourced: `resolveOrigins(headerOrigin, isReview)` in core is the one table mapping a session onto the approval surface (delegated subagent = review channel) and the library surface (review fork = `background_review`, other subagent = `subagent`, foreground = `foreground`). `tool-memory`, `tool-skill-manage` and the review executor read it instead of re-deriving the mapping inline. (A-line M2-2.3)
- Skill creation is no longer counted as a patch: `skill_manage create` leaves `patch_count` at zero so mutation maturity is not inflated by mere authorship. (A-line M3-3.3)
  The usage record itself is now created at authorship (`SkillUsageRegistry.ensureRecord`): the record must exist from birth (created_at anchor, quality surfaces read it) — the pre-fix change dropped the record entirely, which CI caught because the local vitest config never included the tool packages. The local config and the registry now cover them. (A-line M3-3.3)
- Prompt bundle v3 (`dsh-evolution@3`): the pinned-skill wording now matches the implementation ("pinned skills are read-only to the background review", replacing the contradictory "may be patched"), and the memory-review prompts carry the explicit read-before-write constraint for the inject fallback path. Mixed-version deployments fail closed by design — upgrade all evolution packages together. (B-line G4, rc.39 audit §4-D/E)

## Unreleased — rc.45: regression fixes from the rc.42-44 review

A focused re-review of the three previous releases found three defects; each ships with a regression test that fails on the pre-fix code.

- `EvolutionCurator.run` no longer clears an operator pause: the end-of-run state write hardcoded `paused: false`, so a manual run (allowed while paused by design) — or a pause arriving while a pass was in flight, including the dry-run preview — silently un-paused the curator. The current flag is re-read at save time and preserved. (introduced in rc.43)
- `applyActivityEvent` clamps a non-positive `maxItems` to at least one record: `slice(-0)` keeps everything, so a zero cap disabled the activity sidecar's bounding entirely. (introduced in rc.42)
- `/evolution curator status` survives a corrupt `lastRunAt`: `new Date(NaN).toISOString()` threw a RangeError out of the command handler; non-finite/non-positive values now render as `lastRun=unknown`. (introduced in rc.43)

The review also verified the rest of the rc.42-44 surface: no `session.append('evolution/*')` remains in live code (only the gitignored `.release-staging` mirror), both process-event consumers (activity, replay) are migrated, and the paused gate / first-run defer / manual-override interactions are pinned by the new tests.

## Unreleased — rc.44: store/medium hardening (M1 media) + graph semantic edges (G3)

- `MemoryStore.detectDrift` adopts empty and whitespace-only files as "never written" instead of flagging drift: they parse to zero entries, so the canonical form could never byte-match and every write path was permanently refused — including the repairs the model would make. (P1-6)
- The consolidation-failure backoff counter decays over a rolling window (10 minutes, package-private): failures older than the window stop counting, so three failures yesterday no longer make today's first refusal say "stop retrying". The store cannot observe turn boundaries, so the model-facing "this turn" phrasing is a documented approximation. (P2-1)
- Usage-sidecar records are field-normalized on load (`normalizeUsageRecord`, pure and unit-tested): mistyped counters/timestamps/flags fall back to their `emptyRecord` baseline instead of propagating `NaN` into quality math and lifecycle comparisons; an invalid `created_at` anchors the age clock at now. `.mutations.json` loading drops records without a string `at` (it feeds `.slice()` in command surfaces). (P2-3)
- `SkillLibrary` routes every directory path through a single `dirOf` choke point and trims the skill name at each method entry, so a name that passes validation can no longer mint a whitespace-padded ghost directory; `consolidate` and `restoreFromArchive` normalize their names before validating. (P2-5)
- Shared defaults are single-sourced: `memory-files` reads `DEFAULT_MEMORY_CHAR_LIMIT` / `DEFAULT_USER_CHAR_LIMIT` / `DEFAULT_CONSOLIDATION_FAILURES` from core (new constant); `tool-memory` and the curator keep their package-private tunables (`entryPreviewChars`, `qualityWarnStaleAfterDays`) as single within-package constants. (P2-8)
- `evolution-state-domain` retries a failing `open()` with bounded exponential backoff and clears the shared opening promise on rejection: one transient backend failure (lock, busy) no longer takes the provider down until restart. (P1-4)
- Learning-graph skill-skill edges are semantic (B-line G3): `relatedSkillNames(content, exclude?)` in core is the single `related_skills` parser (deduplicated, self-excluding) feeding both the quality references factor and `/evolution graph`; the former alphabet-order edge chain between unrelated neighbors is gone, edges only connect skills that exist, and the graph output gained a density line (edges per node, isolated percentage). (B-line §4-C)

## Unreleased — rc.43: control-plane hardening (M1 core + curator pause)

- `SkillLibrary.consolidate` two-phase rollback now covers mid-loop archive failures: a refused/failed archive after earlier sources were already archived previously bypassed the rollback (`return` inside the loop), leaving the tree half-consolidated. The failure now routes through the catch, which restores the target body and un-archives every already-moved source. A regression test simulates the media failure with a throwing IO proxy.
- `EvolutionCurator.run` scores quality BEFORE the lifecycle transitions: the transition engine reads this run's freshly computed `quality_warn` for the shorter quality-warn stale window, instead of the previous run's persisted state (the quality-warn path used to lag a full curator cycle).
- `EvolutionCurator` normalizes "no state service" onto "no persisted state": with `evolutionState` unmounted the first-run defer never fired and the interval gate compared NaN, so a fresh install ran immediately. State-less compositions now defer first sight like every other composition (manual `/evolution curator run` is unaffected).
- Curator pause (Hermes `set_paused` parity): `paused: true` on the persisted state skips automatic passes (gate sits before interval, matching `should_run_now` order); `setPaused(bool)` persists it (seeding `lastRunAt: now` when state is empty so a resume re-enters through the interval gate); `/evolution curator pause|resume|status` expose it. Manual runs bypass the pause by design.
- Review subagent runs are disposed on EVERY exit path: a timed-out/aborted run (result rejecting via the start signal) previously skipped `dispose()` and leaked the child session.
- Review per-session counters (`turnStarts` / `cumulativeToolCalls` / `completionInjected`) now sweep entries whose agent is gone under size pressure (threshold 128) — the platform has no in-process session-end hook, so the maps previously grew unbounded on a long-lived host.
- `SkillLibrary.snapshotAll` guards against same-millisecond destination collisions: two snapshots in one ms (restore's pre-rollback snapshot racing the snapshot it restores from) shared one directory and the later copy overwrote the earlier manifest, so a restore could read the wrong tree.

## Unreleased — P0-1: evolution events leave the session log (resume safety)

- `evolution/review-scheduled` and `evolution/plan-applied` are no longer session events: a persisted session log carrying a type outside the host's `KNOWN_SESSION_EVENT_TYPES` is refused wholesale at resume (`assertEventsSupported`) and `Session.append` offers no `ignorable` channel, so any review trigger made the session unresumable. Both payloads (v2, now carrying `sessionId`) moved to the cordis event bus; the session log stays native-only.
- `evolution-activity` retires its session projection (the dual-contract registration goes with it) and replaces it with a durable store: every plan outcome persists to `$DSH_HOME/evolution/activity.json` via the evolution IO seam (versioned shape, bounded, merge-on-restart) — the read path that survives host restarts without a session.
- `evolution-replay` subscribes to the process event directly; its leaderboard stays in-memory by design (durability is the activity store's job).
- New acceptance test: a persisted resume e2e over the real JSONL backend (write → dispose/flush → fresh-context reload), plus a regression guard proving the pre-change behavior (a direct `evolution/*` append) is still refused by the upstream gate.
- Sessions written before this change that contain `evolution/*` types remain unresumable on 0.1.1-rc.2 hosts; export from the old process first if their content matters.

## Unreleased — DSH 0.1.1 projection-contract adaptation

- `evolution-activity` now registers its projection with BOTH contract generations: `stateSchema` + `wire.viewSchema` (the 0.1.1+ session-projection contract, where cold reads call `stateSchema.parse` on checkpointed rows) and the legacy `schema` + `view` fields (0.1.0-rc.6 era). Each registry ignores the fields it does not know, so one build serves both host lines. The new half is load-bearing: without `stateSchema` a 0.1.1+ cold read throws.
- The projection regression test now asserts both contract shapes are parse-callable.

## Unreleased — Hermes-alignment: review hardening and curator consolidation

- `evolution-review`: review subagents no longer hardcode `deepseek-official`; the new `reviewProvider` config selects the provider and, when omitted, the subagent inherits the deployment default route (model routing stays on the policy).
- `evolution-review`: review request text is redacted for credential-shaped patterns (API keys, tokens, JWTs, bearer headers, inline `token=`/`secret=` assignments) before it reaches the review subagent.
- `evolution-core` (`SkillLibrary`): added `consolidate(target, sources)` — merge source bodies into a target with absorbed-from markers, archive the sources with `.archive-reason`, never hard-delete.
- `evolution-core` (`SkillLibrary`): added `restoreFromArchive(name)` — bring one archived skill back to the active root.
- `evolution-curator`: `consolidate()` / `restore()` control-plane methods with snapshot-first mutation and usage-state folding; excluded skill names stay refused.
- `evolution-commands`: `/evolution consolidate <target> <source...>` and `/evolution skill restore <name>`.

## Unreleased — legacy facade retired from publishing

- `prepare-release.mjs` now skips `dsh-evolution` (`PUBLISH_EXCLUDE`): the legacy facade stays in the tree as source of record and keeps its tests, but new releases no longer publish it — every published version on npm is deprecated and must not be revived.
- Dropped the unused `@deepseek-ai/dsh-evolution` devDependency from `evolution-feedback`.

## Unreleased — projection schema contract fix

- `evolution-activity` now builds its session-projection schema with zod instead of schemastery: `dsh-session-projection` reads every projection through `def.schema.parse(...)`, and schemastery schemas expose `resolve()` rather than `parse()`, breaking session-history loads at runtime.
- Plugin `Config` stays schemastery; only the projection schema moved to zod (`^4.4.3`, matching `dsh-session-projection`).
- Added a regression test that captures the registered projection definition and asserts its schema is callable through `.parse` and rejects invalid rows.

## Unreleased — publish-shape alignment

- Bundle/preset packages now carry the same runtime package shape as dsh-base: `src/index.ts`, root/invariant exports, main/types, and publish files.
- Root README gained a contents table, quick start, install warning, and a Chinese translation.

## Unreleased — DSH package compliance

- Every evolution package now owns `./invariant`, `src/invariant.ts`, tsconfig invariant reference, and `lib/invariant.js` publication entries.
- Every package README now carries the required Model Experience and Known Limitations sections; all DSH doc gates pass.

## Unreleased — Phase 5 and final hardening

- Added `@deepseek-ai/dsh-evolution-capability`: validates Creator-mode capability packages and stages them through the existing approval audit without executing code.
- Approval of `capability` records records human intent for manual Creator-mode activation instead of failing on a missing runner.
- Added uninstall support to the layered installer, preserving user data.
- Added profile-override composition test.
- Agent preset test now enforces byte-for-byte synchronization with the upstream standard preset.

## Unreleased — Phase 4 installer and docs

- Added `scripts/install-layered.mjs` with host/agent/layered/oneclick modes and dry-run support.
- Added `packages/INSTALL.md` with local, production, and profile-override workflows.
- Added installer regression tests covering clean DSH_HOME install, one-click install, and dry-run.

## Unreleased — Phase 3 Anchored Standard smoke

- Host patch now pins `evolution-review.reviewToolAllow` to `skill`, `skill_search`, and `skill_load`.
- Added an end-to-end review smoke against the real anchored `tool-bootstrap.mjs`: a session turn triggers a review subagent request whose `toolFilter` contains the anchored discovery pair.

## Unreleased — Phase 2 row and installation contracts

- Added a shared `row-contract.ts` pinning host/agent/compat row ids and package names.
- Added row-contract and dependency-contract suites for `evolution-host` and `evolution-agent`.
- Added a runtime installation matrix: host-only services have no model tools; host+agent exposes them.
- Compatibility preset test now verifies containment of every contracted layer row.

## Unreleased — Phase 1 layered installation

- Added `@deepseek-ai/dsh-evolution-host`: host-plane infrastructure bundle with registries, providers, policy, approval, review, curator, and observability — no model-facing tools.
- Added `@deepseek-ai/dsh-evolution-agent-preset`: standard agent preset plus `memory`, `skill_manage`, and the native skill-catalog bridge.
- Kept `@deepseek-ai/dsh-evolution-preset` as the one-click compatibility bundle, with composition tests asserting the three layers stay synchronized.

## Unreleased — Anchored Standard compatibility

- Review subagent `toolFilter` now defaults to `skill`, `skill_search`, and
  `skill_load`, so review children can discover/load skills under anchored
  presets that hide the plain `skill` tool.
- Added an anchored-standard compatibility suite using the actual vendored
  `tool-bootstrap.mjs`/`compaction-epoch.mjs` plugins: evolution tools stay
  hidden during bootstrap, remain hidden after promotion, and appear only
  after `dev_tool_search` unlocks them.

## Unreleased — optimization groups

- Added `evolution-skill-catalog`: native `ctx.skills` provider with explicit invalidation on `evolution/skill-mutated`.
- Approval resolve is now atomic (`tryResolvePending`) across JSON and storage-domain providers, with in-process dedupe.
- Feedback is durable through the IO seam and feeds `quality_score`/`quality_warn` into skill usage and curator thresholds.
- Curator runs persist a JSON report; `/evolution curator report` reads it; optional `minIdleHours` skips runs during active sessions.

## Unreleased — seams and host-plane alignment

- Added `evolution-io` registry + `evolution-io-node` atomic provider; native
  packages no longer import node:fs directly.
- Split durable state into `evolution-state-storage` (seam),
  `evolution-state-domain` (storage-domain KV), and `evolution-state-json`
  (portable fallback with a serialized write queue).
- Migrated approval history onto `evolutionState`; resolved records stay in
  the audit trail.
- Native `memory` and `skill_manage` tools now pass through staged approval
  and register replay runners.
- `evolution-policy` now installs a monotonic DSH `tools.guard`; review reads
  thresholds and model routes from policy.
- Removed manual delegation-depth checks in favor of DSH subagent origin
  scoping; review uses subagent structured output and deterministic plan IDs.
- Added sha256-pinned prompt bundle, Hermes authoring standards, curator LLM
  advisory pass, and replay session-event driver.
- Preset now treats the storage stack as host-plane (patch overlay) while the
  standalone composition still ships a complete JSON-backed stack.
- Hardened no-op `expect(actual, message)` tests into real assertions.

## 0.2.0 — Phase 6 release

- Added evolution-activity session projection.
- Added evolution-feedback quality scoring.
- Added `/evolution graph` command.
- Preset now includes activity and feedback.
- Full plugin family: memory, skills, review, policy, validator, state,
  approval, threat, curator, commands, graph, replay.
