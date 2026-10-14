#!/usr/bin/env node
// scan-spec-budgets.mjs (G0/S0.5): the CANDIDATE SET for spec-level vi.setConfig knobs.
// The candidate set is produced by a scanner, never by a hand list (R68/R100).
// Prints JSON: { measuredAt, tree, command, count, candidates[] } — the measurement stamp is part of the output.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.argv[2] ?? "D:/dsh/dsh-evolution-mirror";
const KEYS = ["testTimeout", "hookTimeout", "maxConcurrency", "sequence", "retry", "teardownTimeout"];
const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".spec.ts")) files.push(p);
  }
};
walk(join(ROOT, "packages"));

const candidates = [];
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = line.match(/vi\.setConfig\s*\(([^)]*)\)?/);
    if (!m) return;
    const arg = m[1];
    const isObjectLiteral = /^\s*\{/.test(arg);
    const isTopLevel = /^\s*vi\.setConfig/.test(line);
    for (const key of KEYS) {
      const km = arg.match(new RegExp(key + "\\s*:\\s*([^,}]+)"));
      if (!km) continue;
      candidates.push({ file: relative(ROOT, f).split("\\").join("/"), line: i + 1, key, valueRaw: km[1].trim(), isObjectLiteral, isTopLevel });
    }
  });
}
let tree = "unknown";
try { tree = execFileSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch {}
const payload = {
  measuredAt: new Date().toISOString(),
  tree,
  command: "node packages/scripts/scan-spec-budgets.mjs " + ROOT,
  count: candidates.length,
  candidates,
};
console.log(JSON.stringify(payload, null, 2));