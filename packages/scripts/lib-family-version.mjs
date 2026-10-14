#!/usr/bin/env node
/**
 * The family version reader (G0/S0.4): ONE place reads a version out of a tree.
 *
 * Why it exists: the expiry evaluator, the pre-tag three-way check and the install path all
 * used to read package.json versions by hand; a second reader is how "the same number" drifts.
 * This module owns three readers plus the family version resolution that install-layered used
 * to define locally. It never normalises anything it reads (the bytes go into pins as they are).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+/;

/** Read the root package.json version. Returns null when absent or shapeless. */
export function readRootVersion(root) {
  try {
    const v = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
    return typeof v === "string" && SEMVER.test(v) ? v : null;
  } catch { return null; }
}

/** Map package dir name -> version, for every packages/<dir>/package.json that exists. */
export function readPackageVersions(root) {
  const out = new Map();
  let dirs = [];
  try { dirs = readdirSync(join(root, "packages")); } catch { return out; }
  for (const dir of dirs) {
    const p = join(root, "packages", dir, "package.json");
    if (!existsSync(p)) continue;
    try {
      const v = JSON.parse(readFileSync(p, "utf8")).version;
      if (typeof v === "string") out.set(dir, v);
    } catch { /* an unreadable package.json is reported by its own gate, not invented here */ }
  }
  return out;
}

/** The version the CHANGELOG headline states (the first "## " heading), or null. */
export function readChangelogHeadVersion(root) {
  try {
    const line = readFileSync(join(root, "CHANGELOG.md"), "utf8").split("\n").find((l) => l.startsWith("## "));
    return line === undefined ? null : (line.match(/^##\s+(\S+)/) || [])[1] ?? null;
  } catch { return null; }
}

/** The family version: the install tile under evolution-host wins, else the root package.json. */
export function familyVersion(sourceRoot, root = sourceRoot) {
  try {
    const v = JSON.parse(readFileSync(join(sourceRoot, "evolution-host", "package.json"), "utf8")).version;
    if (typeof v === "string" && SEMVER.test(v)) return v;
  } catch { /* fall through to the root package.json */ }
  return readRootVersion(root) ?? undefined;
}
