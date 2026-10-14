#!/usr/bin/env node
// gen-test-lines.mjs (G3): write the platform-coupling registry FROM THE ORACLE, never by hand.
// Each entry carries the fields the verifier checks; the first version registers every candidate
// with an explicit pending status and an expiry, so the coupling is visible and dated (not guessed).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2] ?? "D:/dsh/dsh-evolution-mirror";
const raw = execFileSync("node", [join(ROOT, "packages", "scripts", "verify-test-lines.mjs"), ROOT], { encoding: "utf8" });
const reading = JSON.parse(raw.slice(raw.indexOf("{")));
const EXPIRY = "G2/M5: assign each spec its expected platform line (or drop the coupling) before the registry turns enforcing";
const entries = [];
for (const c of reading.sampleActualOnly ?? []) entries.push(c);
// the sample is only a preview: re-run the oracle in-process for the full set
const fs = await import("node:fs");
const { readdirSync } = fs;
const files = [];
const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { if (e.name === "node_modules") continue; const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".spec.ts")) files.push(p); } };
walk(join(ROOT, "packages"));
const FAMILY = /^@deepseek-ai\/dsh-evolution-/;
const PLATFORM = /^@deepseek-ai\/dsh-(?!evolution-)/;
const rows = [];
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const rel = relative(ROOT, f).split("\\").join("/");
  const owner = (rel.match(/packages\/([^/]+)\//) ?? [])[1] ?? "scripts";
  text.split("\n").forEach((line, i) => {
    const m = line.match(/from\s+["\'](@deepseek-ai\/[^"\']+)["\']/);
    if (!m) return;
    const id = m[1];
    if (FAMILY.test(id) || !PLATFORM.test(id)) return;
    rows.push({ spec: rel, id, expectLine: "unknown", status: "pending", reasonRef: rel + ":" + (i + 1), expiry: EXPIRY, owner });
  });
}
const seenKeys = new Set();
const deduped = rows.filter((r) => { const k = r.spec + "::" + r.id; if (seenKeys.has(k)) return false; seenKeys.add(k); return true; });
const payload = { generatedBy: "gen-test-lines.mjs", measuredAt: reading.measuredAt, tree: reading.tree, testLines: deduped };
writeFileSync(join(ROOT, "packages", "scripts", "family-test-lines.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ wrote: "packages/scripts/family-test-lines.json", rows: rows.length, entries: deduped.length, tree: reading.tree }));
