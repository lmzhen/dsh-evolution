#!/usr/bin/env node
// gen-test-lines.mjs (G3): write the platform-coupling registry FROM THE VERIFIER OUTPUT.
// It owns no scan of its own: the candidate set has exactly one implementation
// (verify-test-lines.mjs --full), so the two sides cannot drift apart again.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib-env.mjs";

const ROOT = process.argv[2] ?? REPO_ROOT;
const raw = execFileSync("node", [join(ROOT, "packages", "scripts", "verify-test-lines.mjs"), ROOT, "--full"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const reading = JSON.parse(raw.slice(raw.indexOf("{")));
// The registry is a debt with a due version: the first minor after the family
// version that produced it. A literal from the last release expired the whole
// registry the moment the version was bumped.
const familyVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const [familyMajor, familyMinor] = familyVersion.split(".");
const expiry = familyMajor + "." + String(Number(familyMinor) + 1) + ".0";
const rows = [];
const seen = new Set();
for (const c of reading.fullCandidates ?? []) {
  const key = c.file + "::" + c.id;
  if (seen.has(key)) continue;
  seen.add(key);
  const owner = (c.file.match(/packages\/([^/]+)\//) ?? [])[1] ?? "scripts";
  const expectLine = c.kind === "platform" || c.kind === "testkit" ? "both" : "local";
  rows.push({ spec: c.file, id: c.id, kind: c.kind, expectLine, status: "expected", reasonRef: c.file + ":1", expiry, owner });
}
const payload = { generatedBy: "gen-test-lines.mjs", measuredAt: reading.measuredAt, tree: reading.tree, specDigest: reading.specDigest, testLines: rows };
writeFileSync(join(ROOT, "packages", "scripts", "family-test-lines.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ wrote: "packages/scripts/family-test-lines.json", candidates: reading.candidates, entries: rows.length, tree: reading.tree }));
