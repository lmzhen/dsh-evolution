# 跨组契约（v1 · 冻结于 2026-10-17）

> 属主与变更流程：任何契约变更必须升版本（v1→v2）、在 §0 记录、由改动方与消费方各补一条消费方契约测试、并跑对方组 gate。禁止先改代码后补契约。
> 使用规则：跨组只依赖本文件定义的契约；禁止 import 对方内部模块、禁止修改对方私有文件。

## 0. 元信息

| 项 | 值 |
| --- | --- |
| 版本 | v1 |
| 冻结里程碑 | M1（G1 退出） |
| 属主 | G1（Lead 批准变更） |
| 状态 | 冻结（可增字段，不可改语义；语义变更需 v2） |
| 变更记录 | v1.1 2026-10-17：DiagnosticCode 增 INTERNAL（未知错误兜底，additive）；v1.2 2026-10-19：C1 未知配置键拒绝；C3 Diagnostic 四键收紧；v1.3 2026-10-19：C2 ReportModel 顶层 generatedAt/command/degraded/pairs_final 与 assertReportModel；v1.4 2026-10-19：C3 StageResult 五键与 PipelineContext state/signal 形状冻结；v1.5 2026-10-19：C9 MergePlan/MergeDecision 形状与路径约束冻结；v1.6 2026-10-19：C10 包入口/exports/files/public API 冻结；v1.7 2026-10-19：C3 ctx.cfg 冻结、ctx.state 运行时迁移（G2.2）；v1.8 2026-10-19：C3 signal 从 CLI→stage→请求层传播（G2.3）；v1.9 2026-10-19：report 组装收口到 buildScanReport（G2.4）；v1.10 2026-10-19：IO ensureDir 唯一/writeFileBytes 原子写（G3.1）；v1.11 2026-10-19：默认模型目录改为 registry artifactDir 解析（G3.2）；v1.12 2026-10-19：auto_provision 默认 false + models ensure 显式供给（G3.3）；v1.13 2026-10-19：doctor 结构化报告 + 包内 CLI 渲染（G3.4）；v1.14 2026-10-19：screening 四算法迁入 src/screening 纯入口（G4.1）；v1.15 2026-10-19：embedder provider 统一 encode + 未知 backend 点名（G4.2）；v1.16 2026-10-19：floors 来源可解释 + 校准只读（G4.3）；v1.17 2026-10-19：筛选输出 via/arm/score 契约（G4.4）；v1.18 2026-10-19：Ranker provider 统一 score/scoreRange + API 部分回退（G5.1）；v1.19 2026-10-19：rerank 重试/取消/checkpoint key 契约（G5.2）；v1.20 2026-10-19：Judge provider + evidence 四键 + stub heuristic（G5.3）；v1.21 2026-10-19：降级诚实状态机 + --strict（G5.4）；v1.22 2026-10-19：MergeDecision 统一校验 + plan 路径归一（G6.1）；v1.23 2026-10-19：merge 消费 ReportModel + corpus caller 边界（G6.2）；v1.24 2026-10-19：确定性 fallback 卡级校验（G6.3）；v1.25 2026-10-19：plan JSON + 人读摘要（G6.4）；v1.26 2026-10-19：单入口 CLI verbs（G7.1）；v1.27 2026-10-19：帮助/错误两行制 + --debug（G7.2）；v1.28 2026-10-19：成功三行输出 + prompts 默认不写（G7.3）；v1.29 2026-10-19：report 视图 run.meta/banner/CSV 派生（G7.4）；v1.30 2026-10-19：发布面 screening export + 安装后全链路（G7.5）；v1.31 2026-10-19：契约/架构门禁 R10/R11（G8.1）；v1.32 2026-10-19：parity/bench 可红门禁（G8.2）；v1.33 2026-10-19：独立包 E2E（G8.3）；v1.34 2026-10-19：release gate 回滚演练（G8.4）；v1.35 2026-10-20：models ensure dry-run 计划区分 `origin=derived/repo`，修正伪下载 URL 并增 kind/origin/recipe/base |

## C1 Config 与 CLI 契约

- **目的**：所有可调参数只有一处声明；CLI/校验/help/README 表全部派生。
- **字段描述**：`{key, type: "string"|"int"|"float"|"bool"|"enum"|"json", default, choices?, min?, max?, cli?: boolean, doc, derived?}`。
- **优先级**：命令行显式传入 > schema 默认值。当前没有环境变量字段；将来若增加 env，必须先在 schema 声明 `env` 并升契约版本，不允许隐式读取。
- **入口校验**：CLI 未知参数 exit 2；程序入口 `makeConfig(overrides)` 对未声明 key 抛 `ConfigError`（exit 2），不静默写入 cfg。运行时派生字段（如 `stub2_floors`）在 `makeConfig` 之后由 stage 写入，不属于 schema 字段。
- **CLI 规则**：支持 `--arg value` 与 `--arg=value`；布尔支持 `--flag`/`--no-flag`；`--corpus` 可多次；必填缺失与非法值均 exit 2 并点名参数；`--help` 由 schema 生成。
- **离线优先（G3.3）**：`auto_provision` 默认 `false`；显式 `--auto-provision` 才允许 scan 自动下载/构建；用户主路径是 `skill-merge models ensure`，缺模型 exit 2 且提示该命令。
- **属主/消费方**：G1 属主；全部组消费。
- **验收**：新增配置只改 schema 一处；`--judge bogus`/`--rounds abc` ⇒ exit 2；`--help` 可用。

## C2 IO 读写契约

- **读**：`readText(path) -> string`（UTF-8；CRLF/CR → LF；不剥 BOM，与 Python 一致）；所有文本读取必须经此入口。
- **写**：`writeText(path, s, {eol})`、`writeJson(path, v, {sortKeys, eol})`、`writeCsv(path, rows, {dialect})`；全部 tmp+rename 原子写；默认 LF；`eol: "crlf"` 与 `dialect: "python"` 用于字节级 parity。
- **二进制/目录原语**：`ensureDir(dir)` 唯一实现在 `io/bytes.js`；`writeFileBytes(target, buffer)` 同样 tmp+rename 原子写；`io/write.js` 不得再本地实现 ensureDir。
- **方言开关**：`--io-dialect native|python`（默认 native）；`--parity-bytes` 等价于 python 方言 + 可复现格式。
- **属主/消费方**：G1 属主；G2/G5/G6 消费。
- **验收**：原子写可断言；CRLF 夹具 body 与 Python 等长；27 prompt 在 parity-bytes 下逐字节一致。

## C3 Diagnostic 与退出码契约

- **Diagnostic**：稳定四键 `{code, where, detail, retryable}`；`toDiagnostic` 对任何错误都补齐四键；`code` 枚举见 `src/contracts.js`（USAGE/CONFIG/MODEL_MISSING/UNREADABLE/INVALID/UNAVAILABLE/BUDGET/PARTIAL/ALL_DOWN/INTERNAL）。
- **退出码**：`0` 成功（空结果允许但 stderr 警告）；`2` 用法/配置错误（不写产物）；`1` 运行期失败（可续跑，打印 stage 与对象路径，不向用户打印栈）。
- **禁止**：空 catch；捕获后必须 rethrow 或记录 Diagnostic。
- **属主/消费方**：G1 属主；全部组消费。
- **验收**：ARCH 测试扫描 0 空 catch；错误→退出码映射单测。

## C4 Stage 与 ctx 契约（C3 v1，G1.3 冻结形状）

- **StageSpec**：`{id, requires:string[], run(ctx, input) -> StageResult}`；`defineStage` 返回冻结对象；stage 为纯函数（除 load/artifacts 外不进行 I/O）。
- **StageResult**：`{data, stats:object, warnings:Diagnostic[], counters:object, degraded:boolean}`；runStage 归一后必须过 `src/contracts/stage.js::assertStageResult`。
- **PipelineContext**：`{cfg, state, signal, out, env, log, clock, timings, cleanup, diagnostics, addTiming, onCleanup, record, recordError, dispose}`；`state` 放运行时派生值（stub2_floors/checkpoint 等），不得写 `cfg`；`cleanup` LIFO（含异常路径）；`report.stages[]` 记录 `{id,ms,counters,degraded}`。
- **实施进度**：G1.3 冻结形状/校验器；G2.2 已实现 `cfg` 冻结、`state` 初始化与 modelDirs/semanticTopN/judgeMode 迁移；G2.3 已实现 CLI AbortController → stage 边界 → mapLimit/fetch withTimeout 的 signal 链。
- **属主/消费方**：G1 属主；G3–G6 消费。
- **验收**：run 后无 open fd；timing 进 report；三类降级各产一条 diagnostics；契约 fixture/校验器可红可绿。
- **实现（G6.1）**：`src/pipeline/index.js::runPipeline` 返回 `{ok,exitCode,data,stages,timings,diagnostics,diagnosticsSummary,cleanup,cfg[,error,diagnostic]}`；`provision` hook 在首个 stage 前调用（G6.2 接 ensureArtifacts）；`onProgress` 事件 start/provision/stage-start/stage-done/done|failed。run.js 切换归 G6.2/G6.3。

## C5 Evidence 契约

- **构造**：`buildEvidence(row) -> {jaccard_summary, jaccard_body, body_cosine, summary_cosine}`；缺失一律 `null`（禁止 `undefined` 丢键）。
- **消费**：judge prompt 与判决缓存只消费 Evidence；canonical JSON 仅用于 sha/缓存键，prompt 正文按 Python 插入序序列化。
- **属主/消费方**：G1 属主；G5 消费。
- **验收**：27 prompt 逐字节一致；evidence 形状断言。
- **Screening 纯入口（G4.1）**：`src/screening/index.js` 导出 `prefilter/generateCandidates/lexicalGate/semanticSelect`；输入 `Skill[]`/`Pair[]`，输出纯数据，不直接写文件；stage 适配器只调用该入口。
- **筛选输出（G4.4）**：每对被选中的 pair 至少含 `a,b,a_path,b_path,via("summary"|"body"|"both"),arm(string[]),score(有限数值)`；stage 归一结果为 `{data,stats,warnings}`；算法层不得拼 report/markdown 文案。

## C6 Attempt/Degrade 契约

- **接口**：`attempt(steps, policy) -> {value, tier, attempts[], degraded, reasonCode, cost{ms,tokens}}`；steps 分 build/run 两相。
- **策略**：`sequence`（四档 embedding 链）、`partial`（精排逐对补位）、`route`（判决级联）。
- **reasonCode 枚举**：`no-key/http-error/timeout/invalid-response/all-down/partial-fill/unknown`（实现时可扩展，但不改既有语义）。
- **属主/消费方**：G1 属主（引擎）；G4/G5 消费。
- **验收**：三类降级均产 reasonCode 与 attempts[]，report.diagnostics 可计数。

## C7 parity 契约

- **结构**：`parity/cases/*.json`（小语料+cfg+期望层级）、`parity/golden/*`（Python 侧 gen 脚本产出，只生成不判定）、`parity/run.js`（比较并 exit 1，输出差异摘要）。
- **断言分层**：名单/判决级（默认，1e-3 容差）→ 位级（`--parity-bytes`/`--numeric=f32`，可选）。
- **属主/消费方**：G1 属主（骨架）；G8 治理（golden/用例）。
- **验收**：runner 失败可红；现有 5 个 parity 用例迁移后全绿。

## C8 模型注册表 schema 契约（骨架）

- **文件**：`models/registry.json`，分区：`artifacts`（G2 属主）、`models`/`tiers`/`calibration`（G4 属主）；G1 定 schema 与校验。
- **artifacts 条目**：`{id, kind:"source"|"derived", origin?, repo?, target, files[{path,sha256,bytes,lfs?}], recipe?, base?, proj?, manifest{...}}`。
- **实现约定（G2.1，v1）**：`schemaVersion=1`；`modelsRoot` 为相对 node/ 包根的路径（默认 `"models"`，env `SKILL_MERGE_MODELS_ROOT` 可覆盖）；`target`/`files[].path` 必须是相对路径且禁 `..`（解析后不得越出 modelsRoot）；`recipes` 表定义构建算法（`fp16-cast`/`int8-per-row`/`pca-project-int8`，各带 `builderVer` 与 params）；derived 必须带 `manifest{dtype,dim,rows,tokenizerSha,builderVer,scalesDtype?,projSha?,reproducibility?}`（`reproducibility:"bytes"|"numeric"`：numeric 表示 Node 构建与 Python 参考非字节一致，校验只查存在+尺寸，sha 仅作 Python 参考；默认 bytes）；source 的 `origin` 为 `hf`（需 repo）或 `repo`（随仓库分发，如 PCA proj.f32）；校验/路径/verify API 在 `src/models/registry.js`（严格 schema，未知字段拒绝）。
- **models 条目（G4.1 实现约定）**：`{id, provider, compute:"api"|"local-static", overrideField, floors{body,summary}, transport?{kind:"openai-embeddings",model}, artifactRef?, tokenizerRef?, limits?, price?}`；api 档必须带 transport.model；local-static 的 artifactRef 必须指向 artifacts 中的 id；tiers 中 modelRef 必须存在。
- **解析入口**：`src/embed/registry.js::resolveChain(cfg,registry)`（档位顺序/kind/effectiveModel）、`floorsFor`/`resolveFloorPreset` 与 `resolveConfiguredDir`；换档/换模型只改 registry 数据。
- **floors 优先级（G4.3）**：cfg tier preset > cfg floorPreset > calibration > registry model floors > cfg local preset > cfg semantic 默认；`resolveFloorPreset` 返回 `source` 说明来源；运行时只读挂载 calibrated，禁止自动校准/写 registry。
- **默认模型目录（G3.2）**：`cfg.embedder_model/embedder_model_last` 默认空；空＝按 registry model.overrideField → artifactRef → artifactDir(cfg.models_dir) 解析；schema 禁止写作者机绝对路径。
- **显式供给（G3.3）**：`run.js models ensure [--all|--include ...] [--dry-run] [--json]`；默认只处理非 optional artifact；dry-run 输出 `target/kind/origin/sha/bytes`，**只有 `origin=hf` 的文件带 `url`**，derived 行带 `recipe/base`、repo 行标随包分发（不得输出 `undefined` 伪下载地址）；实际供给走 `ensureModels` 下载+构建。
- **doctor（G3.4）**：`src/models/doctor.js::runDoctor` 返回结构化 `{schemaVersion,ok,exitCode,checks[],summary}`，每项 `status` 仅 pass/skip/fail 且 fail 带 hint；`src/models/doctor-cli.js` 只做参数解析/文本或 JSON 渲染，`skill-merge doctor` 退出码由 report.exitCode 决定。
- **Embedder provider（G4.2）**：local/remote/ONNX/chain provider 统一暴露 `encode(texts)->number[][]`；backend 白名单 `chain/local/remote/onnx`，未知 `embed_backend`/`embedder` 启动即抛 `InvalidDataError` 并点名，不得静默回退；模型事实只从 registry 解析。
- **Ranker provider（G5.1）**：`{id,modelId,scoreRange:[0,1],score(rows)->{scored,failures,reason}}`；API/Q8/Q4/vec 同契约，链可注入 fake；API 部分失败只回退失败行，不丢成功行；每档声明 modelId/scoreRange。
- **重试/checkpoint（G5.2）**：`rank_retries`/`rank_retry_backoff_ms` 控制 429/5xx/超时重试，外部 signal 可取消 backoff；checkpoint key=`rankerId|cap|promptSha|a_path|b_path`，换 ranker/cap/prompt 不复用旧分，flush 仍原子写。
- **Judge provider（G5.3）**：`{id,promptSha,heuristic,judge(rows)}`；stub/stub2 必须 `heuristic=true`，deepseek `heuristic=false`；cascade 用 `buildEvidence`（四键齐全，缺失 null），行/记录/`stats.judge_provider` 暴露 provider 元数据；prompt 字节不变。
- **tiers**：`[{id, modelRef, floorPreset}]`；**calibration**：`{version, samplesSha, n, quantile, margin, floors{tier:{body,summary}}}`。
- **校准产物（G4.5）**：`tools/calibrate.js` 在 registry 同目录生成 `registry.calibrated.json` = `{schemaVersion:1, calibration:{...}}`；`samplesSha=sha256(canonical(样本 skills+pairs))`；同 samplesSha 产物逐字节可复现（键排序/LF/不含时间戳）；运行时**只读**挂载（不写 registry.json）。
- **变更规则**：分区单属主；G4 只读 artifacts；schema 变更走本契约升版。
- **验收**：schema 校验可跑；G2/G4 各自 region 可独立写。

## C9 MergePlan v1（C7 实现，G1.4 冻结）

- **MergeDecision**：`{relation,mode,executor,target,sources[],rationale,confidence}`；五值 mode、五值 relation、四值 executor、目标 kebab-case；`validateMergeDecision` 返回问题数组。
- **MergePlan**：`{schemaVersion:1,pair:{a,b},relation,mode,executor,nomination?,content,changelog[]}`；`validateMergePlanShape` 只做契约形状/枚举/路径校验，不读 MergeCard。
- **G9 卡级校验**：`src/merge/schema.js::validatePlan(plan,card)` 先跑 shape，再校验 U-ID 覆盖、budget、executor/support_files 关系；`emptyPlan`/常量/`NAME_RE` 唯一来源在 `src/contracts/merge.js`。
- **路径约束**：`content.atomic_pairs[].file` 必须是安全相对路径；拒绝绝对路径、`..`、`tmp/`/`temp/`。
- **属主/消费方**：G1 属主；G6 消费；draft 两轮 decision 后续只复用本契约，不再保留第二套 schema。
- **G6.1 统一实现**：`classifyMerge` 的 LLM decision 必须过 `validateMergeDecision`，非法即 `fallback-invalid`；deterministic decision 同形；`planMerges` artifact 的 `card.skills.*.path` 归一为相对语料根路径，plan 的 path/file 字段不得绝对路径。
- **G6.2 消费边界**：`mergePairsOf`/`planMerges` 入口先 `assertReportModel`，坏 report 抛 InvalidDataError；corpus 必须由 caller 传 `corpusRoots` 或 `corpusSkills` Map，merge 内部不再从 report 递归猜路径。
- **G6.3 卡级 fallback**：`validatePlan` 增加占位符扫描、target_sections id 唯一、merge/move 指向有效 section、全 drop 拒绝、atomic_pairs 的 link_section/support_files 成对校验、budget 正整数；deterministic fallback 必须两次深等可复现，LLM 不可用 `source=fallback*`。
- **G6.4 输出**：`planMerges` 同时写每对 plan JSON、`summary.json`、人读 `summary.md`（`src/merge/summary.js` 纯渲染、无时间戳、逐字节可复现）；不写真实 skill、不做 commit，源语料 hash 不得变化。
- **验收**：`test/g1-merge-plan.test.js` + `test/g6-merge-unified.test.js` + merge_planner 测试全绿。

## C10 Package entry / public API v1（G1.5 冻结）

- **package**：`main=./src/index.js`；`exports` 发布已实现的 `.`/`./merge`/`./pipeline`/`./cli`/`./screening`/`./contracts`/`./contracts/report`/`./contracts/stage`/`./contracts/merge`；`./plugin` 等未实现入口不得提前发布。
- **public API**：`src/index.js` 只再导出 `runPipeline/defaultStages/timingOf`、`planMerges`、`makeConfig/DEFAULTS`、`parseCli/formatHelp`、 contracts 校验器/版本；不得在执行时启动 CLI/读模型。
- **bin**：唯一 `skill-merge -> ./bin/skill-merge.js`；bin 只做入口壳，真实 CLI 在 `src/run.js`。
- **G7.1 单入口**：`skill-merge <scan|plan|doctor|models>`；`src/run.js` 只 dispatch，verb 解析在 `src/cli/**` 或 models 命令模块；tools 入口只做薄包装，不再独立 parse；无 verb 时兼容 scan。
- **G7.2 帮助/错误**：一级 help 列 verbs，二级 help 含必填/示例；`formatError` 固定两行 `[CODE] detail (where=)` + `下一步：…`，所有 code 有 HINTS；默认不输出 stack/作者路径，`--debug` 才追加 stack。
- **G7.3 成功输出**：scan 默认三行（结论/Top/下一步），`--verbose` 才出 stage 明细；`write_prompts` 默认 false，`--write-prompts` 才写 ⑤ prompt 文件；promptDigest/cache 语义不变。
- **G7.4 report 视图**：report.json 唯一契约；不再写 config.json，改 `run.meta.json`（含 config/command/generatedAt/degraded/authoritative + views 派生标记）；candidates.md 顶部降级 banner；CSV 均为 report 派生视图。
- **G7.5 发布面**：`files` 只含 bin/src/models/README；`release-check` 校验两次 pack 同 sha、内容白名单/必需入口、干净安装、bin --help，并跑安装后 scan/plan/models ensure/doctor 全链路。
- **G8.1 架构门禁**：`test/g8-contracts-arch.test.js` 覆盖 Report/Stage/Merge/Provider 四类 validator；ARCH R10 非 `src/plugin/**` 禁止 import plugin，R11 src 不得出现作者机绝对路径字面量；package exports 含 screening、不含 plugin。
- **G8.2 parity/bench 门禁**：篡改 golden ⇒ parity exit 1；bench 基线 `bench/baseline.json`（`BENCH_BASELINE` 可覆盖）按 total_ms +20% 超预算 exit 1；`--json` 输出必须是纯 JSON。
- **G8.3 独立包 E2E**：`test/g8-package-e2e.test.js` 在干净临时目录 pack+install，只调安装后的 bin；离线/默认 scan、plan、doctor、models dry-run 全链路，产物过 report/plan/doctor schema；坏 report ⇒ exit 1 + `[INVALID]` + 下一步。
- **G8.4 release gate**：release-check 覆盖 pack 两次同 sha、files 审计、干净安装、bin、安装后 scan/plan/models/doctor 全链路，以及删除安装包后重装 tarball 的回滚演练；全绿才允许发布。
- **files**：`bin/`、`src/`、`models/registry.json`、`models/pca64/`、`README.md`；tools/bench/docs/test/模型权重/llama-server 不进 tarball。
- **阻断**：exports 外部不可深引 `src/**`；内部相对 import 不受影响。
- **验收**：`test/g1-package-exports.test.js`；`npm pack --dry-run` 白名单；安装包 bin/E2E 绿。

## 附：与 Python 版的行为对齐边界

- 对齐：退出码语义、CLI choices/type 校验、prompt 内容（parity-bytes）、parity 名单/判决。
- 不对齐（有意）：默认输出 LF、action 列有值、缓存默认关、f64 累加（尾差 ≤3.2e-4）。详见 OPTIMIZATION_PLAN §3.3 与 REVIEW §5。

## C20 artifacts / report / CLI 终态（G6.3 冻结）

- **report 顶层（C2 ReportModel v1，编号沿用 C20）**：`{schemaVersion:1, generatedAt:string|null, command:string|null, meta{contractVersion,generator}, config（CONFIG_FIELDS 白名单，排除 rank_checkpoint/judge_cache_path/stub2_floors）, stages[{id,ms,counters,degraded}], timings{total_ms,by_stage}, diagnostics[], used_mode, degraded:boolean, pairs_final[], ...sections}`；sections 不得覆盖保留键；report 不含 undefined/NaN/function。
- **pairs_final 行**：必需 `a,b,action,verdict_id`；可选 `reason,level/levels,rank_score,rank_source,rank_tier`；`pairs_final` 必须由 sections 提升为顶层字段。
- **校验入口**：`src/contracts/report.js::assertReportModel`；消费方（merge/CLI）不得绕过；`generatedAt/command` 默认 null，未注入时不引入时间戳，保证可复现。
- **单一 builder**：scan 的 sections/used_mode/judge fallback/verdict 回填统一由 `src/report.js::buildScanReport` 产出；`scan.js` 只做编排与 `writeArtifacts`，不得再拼 sections。
- **降级状态机（G5.4）**：`src/degrade.js::assessDegradation` 统一汇总 embedder/rerank/judge/stage 降级与启发式路径，产 `{degraded,reason_code,reasons,attempts}`；report 写 `used_mode.degraded/reasons` 与 `sections.degradation`，stdout 打“降级/启发式”；`--strict` 时非空 reasons ⇒ exit 1（产物仍写）。
- **产物**：report.json、run.meta.json、candidates.md、candidates.csv、pairs.csv（G7.4 起不再写 config.json），全部经 io.write 原子写。
- **方言**：native（默认）LF/插入序/CSV 全引号；`--io-dialect python` 或 `--parity-bytes` ⇒ CRLF/递归键排序/CSV 最小引号。
- **timings**：实测毫秒，跨运行可变；字节回归断言应固定输入 fixture 或剔除 timings/动态路径。