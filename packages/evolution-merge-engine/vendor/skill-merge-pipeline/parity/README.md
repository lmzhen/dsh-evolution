# parity 治理（Python oracle 对照）

`pipeline/`（Python）是**参考 oracle，不随 Node 版改动**；`parity/` 用固定语料/输入把 Node 输出与 Python golden 逐值或逐字节对照。

## 结构

- `cases/*.js`：7 个用例（tokenizer/rng/stages123/stage4/judge_prompts/judge_stage5/e2e_int8）；每个导出 `{id, layer, description, run(ctx)}`。
- `golden/`：Python oracle 生成的 golden（ref_*.json + `prompts/` 27 个 CRLF 字节文件）+ `MANIFEST.json`（sha256/bytes/生成脚本）。
- `gen/*.py`：生成器（`gen_ref.py`/`gen_ref4.py`/`gen_rng_ref.py`/`gen_judge_prompts.py`/`gen_build_fixture.py`/`dump_corpus.py`），只允许在这里调用 Python。
- `fixtures/corpus`：冻结语料（45 skills / 134 对 ③ / ④=17，pca64 档 ④=26）。

## 命令

```bash
node parity/run.js                 # 全量 parity（7 pass / 0 fail；失败 exit 1）
node parity/run.js --list          # case 与断言层级
node parity/run.js --case tokenizer
npm run golden:manifest            # 重算 MANIFEST.json
npm run parity:verify              # 治理三连：manifest hash 一致 + runner 可绿 + 篡改 golden 可红
```

## golden 变更流程

1. 只有**契约/实现语义**改变才更新 golden；更新前先在设计文档写明原因与影响面。
2. 修改 `pipeline/` 侧输入或用例 → 跑对应 `parity/gen/*.py` 重新生成 golden（Python 环境见 `parity/gen` 脚本头）。
3. `git diff` 审查 golden 变化（逐值解释），确认是预期变化；**禁止手改 golden 文件**。
4. 重算 MANIFEST：`npm run golden:manifest`。
5. `npm run parity` 与 `npm run parity:verify` 全绿（含篡改红测）后才可提交。

## 字节与数值口径

- 值对照：`align.js` 提供深度比较；字节对照（prompt/方言）见 `prompts/` 与 `ref_crlf_impact.json`。
- runner 支持 `PARITY_GOLDEN_DIR` 环境变量指向 golden 副本（治理红测用，不要在生产流程依赖）。