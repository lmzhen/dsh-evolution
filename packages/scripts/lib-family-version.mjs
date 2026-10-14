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

/** Parse the numeric core of a version: [major, minor, patch], or null. A suffix (rc/beta) is
 * ignored on purpose: an exemption granted until 0.26.0 is due in 0.26.0-rc.1 too, because the
 * release it guards against is already being built. */
function parseVersion(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Compare two versions numerically: -1, 0, 1; null when either side is not a version. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) return null;
  for (let i = 0; i < 3; i += 1) {
    const delta = left[i] - right[i];
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

/** Has `current` reached the version an exemption was granted until? null when either side is
 * not a version (the caller reports that as unevaluable, never as not-due). */
export function versionReached(current, until) {
  const delta = compareVersions(current, until);
  return delta === null ? null : delta >= 0;
}

/** The family version: the install tile under evolution-host wins, else the root package.json. */
export function familyVersion(sourceRoot, root = sourceRoot) {
  try {
    const v = JSON.parse(readFileSync(join(sourceRoot, "evolution-host", "package.json"), "utf8")).version;
    if (typeof v === "string" && SEMVER.test(v)) return v;
  } catch { /* fall through to the root package.json */ }
  return readRootVersion(root) ?? undefined;
}
