#!/usr/bin/env node
// gen-test-lines.mjs (G3): write the platform-coupling registry FROM THE VERIFIER OUTPUT.
// It owns no scan of its own: the candidate set has exactly one implementation
// (verify-test-lines.mjs --full), so the two sides cannot drift apart again.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib-env.mjs";

const ROOT = process.argv[2] ?? REPO_ROOT;
const raw = execFileSync("node", [join(ROOT, "packages", "scripts", "verify-test-lines.mjs"), ROOT, "--full"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const reading = JSON.parse(raw.slice(raw.indexOf("{")));
const EXPIRY = "G2/M5: assign each spec its expected platform line (or drop the coupling) before the registry turns enforcing";
const rows = [];
const seen = new Set();
for (const c of reading.fullCandidates ?? []) {
  const key = c.file + "::" + c.id;
  if (seen.has(key)) continue;
  seen.add(key);
  const owner = (c.file.match(/packages\/([^/]+)\//) ?? [])[1] ?? "scripts";
  rows.push({ spec: c.file, id: c.id, kind: c.kind, expectLine: "unknown", status: "pending", reasonRef: c.file + ":1", expiry: EXPIRY, owner });
}
const payload = { generatedBy: "gen-test-lines.mjs", measuredAt: reading.measuredAt, tree: reading.tree, testLines: rows };
writeFileSync(join(ROOT, "packages", "scripts", "family-test-lines.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ wrote: "packages/scripts/family-test-lines.json", candidates: reading.candidates, entries: rows.length, tree: reading.tree }));
