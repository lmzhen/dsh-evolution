// G8.1：golden 治理校验——hash 稳定、case 引用的 golden 存在、runner 可绿可红。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildManifest } from "./gen_manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const GOLDEN = path.join(ROOT, "parity", "golden");
const CASES = path.join(ROOT, "parity", "cases");

function check() {
  const problems = [];
  const manifest = JSON.parse(fs.readFileSync(path.join(GOLDEN, "MANIFEST.json"), "utf8"));
  const actual = buildManifest();
  const want = Object.keys(manifest.files).sort();
  const have = Object.keys(actual.files).sort();
  if (JSON.stringify(want) !== JSON.stringify(have)) problems.push("manifest 文件集与磁盘不一致: " + JSON.stringify({ want: want.length, have: have.length }));
  for (const rel of want) {
    const a = manifest.files[rel];
    const b = actual.files[rel];
    if (!b) { problems.push("missing: " + rel); continue; }
    if (a.sha256 !== b.sha256 || a.bytes !== b.bytes) problems.push("hash/bytes 漂移: " + rel);
  }
  const refs = new Set();
  for (const f of fs.readdirSync(CASES).filter(x => x.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(CASES, f), "utf8");
    for (const m of src.matchAll(/golden\(\s*"([^"]+)"/g)) refs.add(m[1]);
  }
  for (const name of refs) if (!manifest.files[name]) problems.push("case 引用了未登记 golden: " + name);
  if (problems.length) { console.log("[FAIL] golden 治理: " + JSON.stringify(problems, null, 1)); return 1; }
  console.log("[OK] golden 治理: " + want.length + " 文件 hash/bytes 与 manifest 一致；case 引用 " + refs.size + " 个 golden 均已登记");
  return 0;
}

function runRunner(env) {
  return spawnSync(process.execPath, [path.join(ROOT, "parity", "run.js")], { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, env || {}) });
}

function green() {
  const r = runRunner({});
  const ok = r.status === 0 && /7 pass \/ 0 fail/.test(r.stdout);
  console.log((ok ? "[OK] " : "[FAIL] ") + "runner 绿灯: " + String(r.stdout || r.stderr).split("\n").filter(Boolean).slice(-1)[0]);
  return ok ? 0 : 1;
}

function red() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-golden-"));
  try {
    fs.cpSync(GOLDEN, tmp, { recursive: true });
    const p = path.join(tmp, "ref_rng.json");
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    doc[0].bits[0] = (doc[0].bits[0] + 1) >>> 0;
    fs.writeFileSync(p, JSON.stringify(doc));
    const r = runRunner({ PARITY_GOLDEN_DIR: tmp });
    const ok = r.status === 1 && /\[FAIL\]/.test(r.stdout);
    console.log((ok ? "[OK] " : "[FAIL] ") + "runner 红灯可检出（篡改 golden ⇒ exit 1）");
    return ok ? 0 : 1;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

let code = 0;
code = Math.max(code, check());
code = Math.max(code, green());
code = Math.max(code, red());
process.exitCode = code;