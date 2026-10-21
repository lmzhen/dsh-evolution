# skill-merge-pipeline

技能相似度合并流水线（Node 版）：① 预过滤 → ② MinHash/LSH 候选 → ③ 词面门限 → ④ 向量语义 → ④.5 精排 → ⑤ 三级判决 → G9 合并计划。与仓库根 `pipeline/` 的 **Python 版同口径**，Python 版是只读 oracle（不随 Node 改动）。

**不含**（后续阶段）：DSH 插件 `apply(ctx)`、真实 skill 写入/commit、两轮 merge coordinator。

- 运行时 **Node.js ≥ 20**（实测 v26.4.0），ESM，**零第三方运行时依赖**（fetch/crypto/fs 原生）。
- 模块：`src/pipeline`（编排）+ `src/screening`（①–④ 纯算法）+ `src/embed`/`src/rerank`/`src/judge`（provider）+ `src/merge`（G9）+ `src/cli`（verb）。契约见 `docs/contracts.md`（C1–C20，v1.35）。

## 安装

```bash
# 尚未发布 npm（2026-10-20）：先用仓库产物 tarball
npm pack                                  # 得到 skill-merge-pipeline-1.0.0.tgz
npm install -g ./skill-merge-pipeline-1.0.0.tgz
skill-merge --help                        # scan|plan|doctor|models

# 发布后：npm install -g skill-merge-pipeline
```

可选：`npm install onnxruntime-node` 才启用 ONNX 后端（默认路径不需要）。

## 模型：显式供给、离线优先

模型权重与派生表**不进 tarball**；默认模型根是包内 `models/`（`models/registry.json` 只存相对路径、sha256、bytes 与构建 recipe）。

```bash
skill-merge models ensure                 # 下载 512MB fp32 → 构建 fp16 / int8-256 / pca64-int8
skill-merge models ensure --dry-run --json  # 只出计划：target/kind/origin/sha/bytes
skill-merge models ensure --include ranker  # 可选本地精排 GGUF（默认不下载）
```

- 缺模型时 `scan` **直接 exit 2** 并给同一条 `models ensure` 命令；`auto_provision` 默认 false，不偷偷联网（`--auto-provision` 才自动下载/构建）。
- 镜像：`--hf-endpoint https://hf-mirror.com` 或 `HF_ENDPOINT`；模型根：`--models-dir <dir>` 或 `SKILL_MERGE_MODELS_ROOT`。
- 首启一键闭环实测约 84 s；之后 fast path 零网络约 1 s。衍生档 `int8-256`/`pca64-int8` 逐文件 sha256 校验。

## 快速开始

```bash
skill-merge models ensure
skill-merge scan --corpus C:/path/to/skills --out out/run
```

默认 stdout 三行：结论 / Top 建议 / 下一步；stage 明细只在 `--verbose`；⑤ prompt 默认不落盘（`--write-prompts` 才写）。

本仓库内开发跑（模型在仓库根的 `../models`，不在包内）：

```bash
node bin/skill-merge.js scan --corpus parity/fixtures/corpus --out ../out/run \
  --judge stub --rank vec --seed-mode fixed --embed-backend local \
  --embed-local ../models/potion-multilingual-128M-int8 \
  --embed-local-last ../models/potion-multilingual-128M-pca64-int8
# 2026-10-20 实测：46 技能 → ③ 134 对 → ④ 17 → ⑤ 17（MERGE 4 / KEEP 13）
```

## 命令

| verb | 用途 | 关键点 |
| --- | --- | --- |
| `scan` | 扫描语料、产报告与候选视图 | `--corpus`（可多次）`--out` 必填；默认就是 scan（无 verb 兼容旧用法） |
| `plan` | 在 report 的 MERGE 对上产合并计划 | `--report --corpus --out`；默认 LLM 决策，`--no-llm` 走确定性 fallback |
| `doctor` | 体检 node/模型/凭据/精排服务 | `--json` 结构化；`--offline` 不联网；exit 0/2 |
| `models` | 模型供给 | `models ensure`；`--dry-run/--json/--include/--all` |

- 退出码：`0` 成功 / `2` 用法或配置（不写产物）/ `1` 运行期失败。
- 错误固定两行：`[CODE] detail (where=...)` + `下一步：...`；栈只在 `--debug`。所有 verb 都吃 `--help`。
- 降级诚实：`rank=vec` / `judge=stub` 会在 stdout 标“降级/启发式”，`report.degraded=true`；`--strict` 时降级即 exit 1（产物仍写）。

### 常用参数

| 参数 | 说明 |
| --- | --- |
| `--judge stub\|stub2\|deepseek\|auto` | ⑤ 判决；stub 标 heuristic；deepseek 需 `DEEPSEEK_API_KEY`；auto 无 key 自动 stub |
| `--rank auto\|api\|local\|vec` | ④.5 精排；auto=有 `BAMBOO_API_KEY` 走 27B API，否则 Q8→Q4→vec |
| `--embed-backend chain\|local\|remote\|onnx` | ④ 编码后端；未知后端启动即错，不静默回退 |
| `--embed-local / --embed-local-last` | 档 3（int8-256）/ 档 4（pca64-int8）目录 |
| `--seed-mode fixed\|run` | fixed 可复现；run 随机多轮巡检 |
| `--rounds --floor-jitter --randomize` | ② 多轮 / 抖动 / 随机种子 |
| `--ledger <file> --only-new` | 跨运行台账（只报新增对） |
| `--offline` / `--auto-provision` / `--models-dir` / `--hf-endpoint` | 模型供给控制 |
| `--strict` / `--verbose` / `--write-prompts` | 降级变失败 / stage 明细 / ⑤ prompt 落盘 |
| `--parity-bytes` / `--io-dialect native\|python` | 字节方言（仅回归对照用） |
| `--stream-mode bulk\|stream` / `--max-table-mb` | ④ 表加载模式 / 内存预算 |
| `--worker-pool off\|auto` / `--worker-pool-size` | ④ 条件 worker 池（默认 off，N≥500 且编码 >1.5 s 才启用） |
| `--rank-server` / `--rank-local-chain` / `--rank-server-q8\|q4` | 本地精排地址与降级链（默认 `q8,q4`，Q8 复用 `--rank-server`，Q4 默认 `127.0.0.1:8094`） |
| `--rank-api-url\|model\|key-env` | API 精排（默认 Bamboo `/v1/decisions` + `BAMBOO_API_KEY`） |
| `--judge-cache` / `--no-tokenizer-cache` | 判决缓存（opt-in）/ 关闭 tokenizer 派生物缓存 |

## 产物

`--out` 目录：

| 文件 | 角色 |
| --- | --- |
| `report.json` | **唯一机器契约**（`schemaVersion:1`，`assertReportModel` 校验；sections/stages/timings/diagnostics/used_mode/degraded/pairs_final） |
| `run.meta.json` | 元信息：`command/generatedAt/config/degraded/authoritative:"report.json"/views`（`views` 标每个视图 derived） |
| `candidates.md` | 人读候选（降级时顶部 banner，与 report 同源） |
| `candidates.csv` / `pairs.csv` | 派生视图（report 为唯一事实源） |
| `prompts/` | 仅 `--write-prompts` 时写 ⑤ prompt |

不再写 `config.json`（配置进 `run.meta.json`，report 里是白名单快照）。字节方言：默认 native（LF/插入序/CSV 全引号）；`--parity-bytes` 为 CRLF/键排序/最小引号。

## 公共 API（C10）

```js
import { runPipeline, planMerges, makeConfig, parseCli, formatHelp } from "skill-merge-pipeline";
import { screening } from "skill-merge-pipeline/screening";
```

可发布 subpath：`./merge`、`./pipeline`、`./cli`、`./screening`、`./contracts`、`./contracts/report`、`./contracts/stage`、`./contracts/merge`。未实现的 `./plugin` 不发布；外部不得深引 `src/**`。

## 精排与判决

- `--rank auto`：有 `BAMBOO_API_KEY` 先走 27B API；API 失败按 `--rank-local-chain`（默认 q8,q4）探活 llama-server，最后降级 `vec`。API 只回退失败行，不丢整层成功。
- 本地服务：`npm run rank-server -- --port 8093 --gguf ../models/startlux/StartLux-Decision-0.8B-Q8_0.gguf`（工具在仓库内，不进 tarball）。
- 判决：`stub`/`stub2` 是 heuristic（`judge_provider.heuristic=true`）；`deepseek` 走 API；`auto` 无 key 自动 stub 并在 report 记 fallback。
- `--strict` 把降级/启发式路径变成 exit 1；降级原因统一进 `sections.degradation` 与 `used_mode.degraded/reasons`。

## 合并计划（G9，只产计划不写回）

```bash
skill-merge plan --report out/run/report.json --corpus C:/path/to/skills --out out/plans
# 无 key / CI：--no-llm 走确定性 fallback，产物仍可机械校验
```

产出 `merge_plans/<a>__<b>.json`（MergeCard + S1 决策 + MergePlan + 校验）与 `summary.json`/`summary.md`。五值 mode、路径禁绝对/..、卡级校验（U-ID 覆盖、budget、atomic pair 成对、占位符）。默认不进主流水线、不写回 skill、不做下游 A/B。

## 质量门禁

| 门禁 | 命令 | 判据 |
| --- | --- | --- |
| 单测/契约/ARCH/bench 合同 | `npm test` | 360 测试 0 fail；ARCH R1–R11 白名单空；bench 固定口径 45/90 技能文本 |
| parity | `npm run parity` | 7/7（Python oracle golden；`--parity-bytes` 逐字节） |
| parity 治理 | `npm run parity:verify` | manifest hash 一致 + 篡改 golden 可红 |
| bench 预算 | `npm run bench` | **5 次取最小**，total_ms ≤ baseline 644.9 ms×1.2；前置：可用内存 ≥4 GB、不与其他重负载并行（2026-10-20 终验 631.9 ms 通过；同日压力窗 720–976 ms，见 docs/reports/M3-standalone.md） |
| release gate | `npm run release:check` | pack 两次同 sha、files 白名单/必需入口、干净安装、安装后 scan/plan/doctor/models、tarball 回滚演练 |

实测（2026-10-20）：360/360、parity 7/7、release-check 全绿、安装包 ④=17 ⑤=17；E2E 墙钟 1.67–1.89 s（10-17 基线 1.04–1.10 s，约 1.6×），④ 固定口径 bench 542–976 ms。二者同倍数变慢、而名单/对数/parity 不变 ⇒ 判为机器整体算力环境，不是代码回归；发布前需在空闲机复核。

## 目录

```text
src/run.js            CLI 入口（verb dispatch）
src/cli/              scan/plan 参数、help、错误呈现
src/pipeline/         组合根、ctx/stage 生命周期、timings/diagnostics
src/screening/        ① 预过滤 / ② 候选 / ③ 词面 / ④ 语义（纯函数入口）
src/embed/            provider/static_table/remote/chain/calibrate/onnx(可选)
src/rerank/           ④.5 provider 链
src/judge/            prompt/stub/deepseek/cascade/cache
src/merge/            G9 card/decide/plan/schema/summary
src/models/           registry/provision/build/firstrun/supply/doctor
src/text/ src/minhash/ src/workers/ src/io/ src/net/
tools/                doctor / fetch-models / calibrate / rank-server / merge-plan（薄包装）
bench/ parity/        固定口径基准 + Python golden（不进包）
```

## 文档

- `docs/contracts.md`：C1–C20 跨组契约（冻结；变更升版本）。
- `docs/gates.md`：常设门禁与本轮门禁（命令 + 判据）。
- `docs/migration.md`：从 Python 版迁移与有意差异。
- `docs/oracle.md`：Python oracle 角色与 golden 再生成。
- `docs/design/G*.md`：分组详细设计（10-19 轮 G0–G8；10-17 轮 43 步见 `G1.1`–`G7.5`）；`docs/reports/M*.md`：里程碑验收。
- `docs/reports/M3-standalone.md`：2026-10-19 独立包重构轮验收（当前轮）。

## 边界与已知限制

- 模型、llama-server、Python oracle、`test/parity/bench/docs/team` 不进 npm tarball；`files` 白名单只有 `bin/src/models/registry.json/models/pca64/README`。
- 插件面（`src/plugin`）、两轮 coordinator、staging/journal/commit 未实现（计划阶段 2/3，见 `docs/design/standalone-groups-plan.md` §8）。
- 尚未发布 npm（license 待定 + registry 凭据未闭环）；当前只保证 tarball 安装后可跑。
- 性能门禁在共享机器上对环境敏感：可用内存 <4 GB 或并行重负载时先重跑，不要按单次读数判定回归。
