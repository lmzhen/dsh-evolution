"use strict";
// C7 parity runner：发现 cases/*.js，执行并汇总；失败 exit 1；--list/--case/--layer。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeDir = path.join(__dirname, "..");
const casesDir = path.join(__dirname, "cases");
const goldenDir = process.env.PARITY_GOLDEN_DIR ? path.resolve(process.env.PARITY_GOLDEN_DIR) : path.join(__dirname, "golden");
import { DEFAULTS } from "../src/config.js";
import { resolveConfiguredDir } from "../src/embed/registry.js";

async function loadCases() {
  const files = fs.readdirSync(casesDir).filter(f => f.endsWith(".js")).sort();
  const out = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(casesDir, f)).href);
    const c = mod.default || mod;
    if (!c || typeof c.id !== "string" || typeof c.run !== "function") throw new Error("非法 case: " + f);
    out.push(c);
  }
  return out;
}

function parseArgs(argv) {
  const out = { list: false, caseId: null, layer: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--list") out.list = true;
    else if (a === "--case") out.caseId = argv[++i];
    else if (a === "--layer") out.layer = argv[++i];
    else { console.error("未知参数: " + a); process.exit(2); }
  }
  return out;
}

function makeCtx(c) {
  return {
    root: path.join(nodeDir, ".."),
    nodeDir,
    corpusRoot: process.env.SKILL_MERGE_CORPUS || path.join(__dirname, "fixtures", "corpus"),
    modelDir: process.env.SKILL_MERGE_MODELS_ROOT
      ? path.join(process.env.SKILL_MERGE_MODELS_ROOT, "potion-multilingual-128M-int8")
      : (DEFAULTS.embedder_model || (fs.existsSync(path.join(nodeDir, "..", "models", "potion-multilingual-128M-int8", "config.json"))
        ? path.join(nodeDir, "..", "models", "potion-multilingual-128M-int8")
        : resolveConfiguredDir(DEFAULTS, "embedder_model"))),
    golden(name) { return JSON.parse(fs.readFileSync(path.join(goldenDir, name), "utf8")); },
    assert(cond, msg) { if (!cond) throw new Error(msg || "断言失败"); },
    skip(reason) { const e = new Error(reason || "skip"); e.skipped = true; throw e; }
  };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  let cases = await loadCases();
  if (args.list) { for (const c of cases) console.log(c.id + " [" + c.layer + "] " + c.description); return; }
  if (args.caseId) cases = cases.filter(c => c.id === args.caseId);
  if (args.layer) cases = cases.filter(c => c.layer === args.layer);
  if (!cases.length) { console.error("没有匹配的 case"); process.exit(2); }
  let pass = 0, fail = 0, skip = 0;
  const failures = [];
  for (const c of cases) {
    const t0 = Date.now();
    try {
      const r = c.run(makeCtx(c));
      if (r && typeof r.then === "function") await r;
      pass += 1;
      console.log("[PASS] " + c.id + " (" + c.layer + ") " + (Date.now() - t0) + "ms");
    } catch (err) {
      if (err && err.skipped) { skip += 1; console.log("[SKIP] " + c.id + " (" + c.layer + ") " + err.message); }
      else { fail += 1; failures.push([c.id, String(err && err.message ? err.message : err).slice(0, 300)]); console.log("[FAIL] " + c.id + " (" + c.layer + ") " + failures[failures.length - 1][1]); }
    }
  }
  console.log("");
  console.log("parity: " + pass + " pass / " + fail + " fail / " + skip + " skip");
  if (fail) { console.log("失败明细: " + JSON.stringify(failures, null, 1)); process.exit(1); }
})();