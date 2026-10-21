// G8.2：bench runner；--update 写 baseline，回归超预算（默认 +20%）exit 1。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measure, FIXED } from "./fixed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = process.env.BENCH_BASELINE ? path.resolve(process.env.BENCH_BASELINE) : path.join(__dirname, "baseline.json");
const args = process.argv.slice(2);
const update = args.includes("--update");
const wantJson = args.includes("--json");
const tolArg = args.find(a => a.startsWith("--tolerance="));
const tolerance = tolArg ? Number(tolArg.split("=")[1]) : 0.2;

// 门禁取 5 次测量的最小值：本机被并行会话占用（实测可用内存 2.8/15.4GB）时单次测量会假红。
// 前置条件：可用物理内存 ≥4GB、无并行重负载；否则读数只反映机器环境（2026-10-20 同代码实测 0.84–1.51×）。
const RUNS = 5;
const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(await measure());
const result = runs.reduce((best, r) => (r.total_ms < best.total_ms ? r : best), runs[0]);
const metrics = { load_ms: result.load_ms, encode_ms: result.encode_ms, total_ms: result.total_ms };
let baseline = null;
if (fs.existsSync(BASELINE)) baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const regressions = [];
if (baseline && !update) {
  // 预算门禁守总耗时（load 为小 I/O 量、在并行测试下噪声大；encode 为 CPU 量、随机器负载波动）
  const base = baseline.metrics.total_ms;
  if (Number.isFinite(base) && metrics.total_ms > base * (1 + tolerance)) regressions.push({ metric: "total_ms", base: base, now: metrics.total_ms, ratio: Math.round((metrics.total_ms / base) * 100) / 100 });
}
if (wantJson) {
  console.log(JSON.stringify({ result: result, baseline: baseline, regressions: regressions, tolerance: tolerance }, null, 2));
} else {
  console.log("固定口径：" + FIXED.skills + " 技能 / " + FIXED.texts + " 文本（fixture corpus，" + result.model + "）");
  console.log("载入=" + result.load_ms + "ms 编码=" + result.encode_ms + "ms 合计=" + result.total_ms + "ms RSS=" + result.rss_mb + "MB");
  if (baseline) console.log("baseline: 载入=" + baseline.metrics.load_ms + "ms 编码=" + baseline.metrics.encode_ms + "ms 合计=" + baseline.metrics.total_ms + "ms（容差 " + Math.round(tolerance * 100) + "%）");
  if (regressions.length) console.log("回归: " + JSON.stringify(regressions));
}
if (update) {
  const doc = { schemaVersion: 1, updatedAt: new Date().toISOString(), node: process.version, corpus: "parity/fixtures/corpus", model: result.model, metrics: metrics };
  fs.writeFileSync(BASELINE, JSON.stringify(doc, null, 2) + "\n");
  console.log("baseline.json 已更新");
} else if (regressions.length) {
  console.error("[FAIL] bench 回归超预算（" + Math.round(tolerance * 100) + "%）");
  process.exitCode = 1;
} else if (baseline && !wantJson) {
  console.log("[OK] bench 在预算内");
}