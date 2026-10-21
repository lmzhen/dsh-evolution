"use strict";
import fs from "node:fs";
import path from "node:path";
const keyOf = r => [r.a_path, r.b_path, r.verdict_id].join("|");
export default {
  id: "e2e_int8", layer: "integration", description: "端到端 int8：与改前跑法对比（历史产出；G8 改自包含）",
  run(ctx) {
    const aPath = path.join(ctx.root, "out", "node_natural", "report.json");
    const bPath = path.join(ctx.root, "out", "cli_e2e", "report.json");
    if (!fs.existsSync(aPath) || !fs.existsSync(bPath)) ctx.skip("缺少历史产出（out/node_natural 或 out/cli_e2e）");
    const a = JSON.parse(fs.readFileSync(aPath, "utf8"));
    const b = JSON.parse(fs.readFileSync(bPath, "utf8"));
    ctx.assert(a.stage3_lexical.passed_lexical === b.stage3_lexical.passed_lexical, "③ 不一致");
    ctx.assert(a.stage4_semantic.selected === b.stage4_semantic.selected, "④ 不一致");
    const ka = a.pairs_final.map(keyOf).sort().join(";");
    const kb = b.pairs_final.map(keyOf).sort().join(";");
    ctx.assert(ka === kb, "⑤ 名单/判决不一致");
    ctx.assert(JSON.stringify(a.stage5_judge.cascade.verdicts) === JSON.stringify(b.stage5_judge.cascade.verdicts), "⑤ 判决分布不一致");
    return { pairs: b.pairs_final.length };
  }
};