"use strict";
// G4.5：离线校准工具——语料 → quantile+margin → registry.calibrated.json（运行时只读）。
import path from "node:path";
import { loadRegistry } from "../src/models/registry.js";
import { calibrateCorpus } from "../src/embed/calibrate.js";
import { makeConfig } from "../src/config.js";
import { exists } from "../src/io/read.js";
import { atomicWrite } from "../src/io/write.js";
import { formatError } from "../src/errors.js";

function parseArgs(argv) {
  const o = { corpus: [], overrides: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--corpus") { for (const x of String(argv[++i] || "").split(",")) if (x) o.corpus.push(x); }
    else if (a === "--tier") o.tiers = String(argv[++i] || "").split(",").filter(Boolean);
    else if (a === "--quantile") o.quantile = Number(argv[++i]);
    else if (a === "--margin") o.margin = Number(argv[++i]);
    else if (a === "--min-pairs") o.minPairs = Number(argv[++i]);
    else if (a === "--models-dir") o.overrides.models_dir = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--force") o.force = true;
    else if (a === "--dry-run") o.dryRun = true;
    else { console.error("未知参数: " + a); process.exit(2); }
  }
  return o;
}

(async () => {
  const o = parseArgs(process.argv.slice(2));
  if (!o.corpus.length) {
    console.error("用法: node tools/calibrate.js --corpus <dir>[,dir] [--tier id] [--quantile 0.95] [--margin 0] [--min-pairs 10] [--models-dir <dir>] [--out <file>] [--force] [--dry-run]");
    process.exit(2);
  }
  const cfg = makeConfig(Object.assign({}, o.overrides, { seed_mode: "fixed", round_count: 1 }));
  const loaded = loadRegistry();
  const out = o.out || path.join(path.dirname(loaded.file), "registry.calibrated.json");
  if (!o.dryRun && exists(out) && !o.force) { console.error("产物已存在: " + out + "（用 --force 覆盖，或 --dry-run 只预览）"); process.exit(2); }
  try {
    const res = await calibrateCorpus({
      corpus: o.corpus, registry: loaded.registry, registryFile: loaded.file,
      rootDir: o.overrides.models_dir || undefined, tiers: o.tiers,
      quantile: o.quantile, margin: o.margin, minPairs: o.minPairs, cfg
    });
    if (o.dryRun) { process.stdout.write(res.canonical); return; }
    atomicWrite(out, res.canonical);
    const c = res.artifact.calibration;
    console.log("校准产物: " + out + "（" + Buffer.byteLength(res.canonical) + " B）");
    console.log("samplesSha=" + c.samplesSha);
    console.log("n=" + c.n + " quantile=" + c.quantile + " margin=" + c.margin + " tiers=" + Object.keys(res.floors).length);
    for (const [tier, f] of Object.entries(res.floors)) console.log("  " + tier + ": body=" + f.body + " summary=" + f.summary);
  } catch (err) { console.error(formatError(err)); process.exit(2); }
})();