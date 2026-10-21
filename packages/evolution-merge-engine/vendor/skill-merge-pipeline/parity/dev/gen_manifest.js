// G8.1：生成 golden MANIFEST（sha256/bytes/生成来源），用于治理与可复现校验。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(__dirname, "..", "golden");

function walk(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    const rel = path.relative(base, p).split(path.sep).join("/");
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(rel);
  }
  return out;
}

function generatedBy(rel) {
  if (rel.startsWith("prompts/")) return "parity/gen/gen_judge_prompts.py";
  if (rel === "ref_rng.json") return "parity/gen/gen_rng_ref.py";
  if (rel === "ref_stage4.json") return "parity/gen/gen_ref4.py";
  return "parity/gen/gen_ref.py";
}

export function buildManifest() {
  const files = {};
  for (const rel of walk(GOLDEN, GOLDEN)) {
    if (rel === "MANIFEST.json") continue;
    const buf = fs.readFileSync(path.join(GOLDEN, rel));
    files[rel] = { sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length, generated_by: generatedBy(rel) };
  }
  return {
    schemaVersion: 1,
    note: "Python pipeline/ 是 oracle；golden 由 parity/gen/*.py 生成，禁止手改。变更流程见 parity/README.md。",
    generatedBy: "node parity/dev/gen_manifest.js",
    files: files
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = buildManifest();
  fs.writeFileSync(path.join(GOLDEN, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("MANIFEST.json 写入：" + Object.keys(manifest.files).length + " 个 golden 文件");
}