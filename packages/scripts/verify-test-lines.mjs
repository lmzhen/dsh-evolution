#!/usr/bin/env node
// verify-test-lines.mjs (G3): the ORACLE for platform coupling in family specs.
//
// The candidate set is produced by scanning spec imports, never by a hand list (R68). Two-way
// reconciliation against family-test-lines.json:
//   actualOnly   = scanned but not registered  -> red in enforcing mode
//   declaredOnly = registered but not scanned  -> red in enforcing mode (zombie registration)
// Default is --report (observation): it prints the counts and exits 0. --strict enforces.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.argv[2] ?? "D:/dsh/dsh-evolution-mirror";
const STRICT = process.argv.includes("--strict");
const FAMILY = /^@deepseek-ai\/dsh-evolution-/;
const PLATFORM = /^@deepseek-ai\/dsh-(?!evolution-)/;
const TESTKIT = /^@deepseek-ai\/dsh-[\w-]*testkit/;

const specFiles = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".spec.ts")) specFiles.push(p);
  }
};
walk(join(ROOT, "packages"));

const candidates = [];
for (const f of specFiles) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/from\s+["\']([^"\']+)["\']/g)) {
    const id = m[1];
    if (FAMILY.test(id)) continue;
    const kind = TESTKIT.test(id) ? "testkit" : PLATFORM.test(id) ? "platform" : null;
    if (kind === null) continue;
    candidates.push({ file: relative(ROOT, f).split("\\").join("/"), id, kind });
  }
}

let tree = "unknown";
try { tree = execFileSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch {}
const registryPath = join(ROOT, "packages", "scripts", "family-test-lines.json");
const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : { testLines: [] };
const declared = new Set((registry.testLines ?? []).map((e) => e.spec + "::" + e.id));
const seen = new Set(candidates.map((c) => c.file + "::" + c.id));
const actualOnly = candidates.filter((c) => !declared.has(c.file + "::" + c.id));
const declaredOnly = [...declared].filter((k) => !seen.has(k));
const byKind = candidates.reduce((a, c) => ({ ...a, [c.kind]: (a[c.kind] ?? 0) + 1 }), {});

console.log(JSON.stringify({
  measuredAt: new Date().toISOString(),
  tree,
  command: "node packages/scripts/verify-test-lines.mjs " + ROOT + (STRICT ? " --strict" : ""),
  specsScanned: specFiles.length,
  candidates: candidates.length,
  byKind,
  registered: declared.size,
  actualOnly: actualOnly.length,
  declaredOnly: declaredOnly.length,
  mode: STRICT ? "strict" : "report",
  sampleActualOnly: actualOnly.slice(0, 5),
  sampleDeclaredOnly: declaredOnly.slice(0, 5),
}, null, 2));
if (STRICT && (actualOnly.length > 0 || declaredOnly.length > 0)) process.exit(1);
