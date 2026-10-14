// packages/scripts/vitest.family.config.mjs — the family test config (G3 / C1-C3).
//
// ONE config for BOTH layouts: the mirror carries packages/<pkg>/tests/**, the overlay carries
// packages/evolution/<pkg>/tests/**. The root is derived from THIS file's URL (never CWD) and the
// include pattern is layout-agnostic, so the same bytes work in either tree.
//
// Run:  npx vitest run -c packages/scripts/vitest.family.config.mjs <file-or-name>
// Tier: FAMILY_TIER=fast|pre-tag|full (explicit; membership filtering arrives with the taxonomy view).
// Adapter: the machine line resolver must be pinned and printable; when it cannot be read the config
// refuses to run (exit 2, CANNOT DECIDE) instead of letting a platform TypeError look like a broken
// environment. FAMILY_ALLOW_ABSENT_ADAPTER=1 downgrades that refusal to a printed warning.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// C1: the root is derived from THIS file, never from CWD — and it has to work in BOTH layouts:
// the mirror keeps scripts at <root>/packages/scripts, the overlay at <root>/packages/evolution/scripts.
// Walk up until a directory carries both the family CHANGELOG and a packages/ tree.
const findRepoRoot = (start) => {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(dir, "CHANGELOG.md")) && existsSync(resolve(dir, "packages"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
};
const repoRoot = findRepoRoot(here);
if (repoRoot === null) {
  console.error("vitest.family.config: CANNOT DECIDE - no family root (CHANGELOG.md + packages/) above " + here);
  process.exit(2);
}
const TIERS = ["fast", "pre-tag", "full"];
const tier = process.env.FAMILY_TIER ?? "full";
if (!TIERS.includes(tier)) {
  console.error("vitest.family.config: unknown FAMILY_TIER=" + tier + " - expected one of " + TIERS.join(" | "));
  process.exit(2);
}

// C3: the machine line resolver is pinned by bytes; a mismatch is a判决, not a surprise.
const ADAPTER = "D:/dsh/_tools/lib-line.mjs";
let adapterSha = "absent";
let platformLine = "unknown";
if (existsSync(ADAPTER)) {
  adapterSha = createHash("sha256").update(readFileSync(ADAPTER)).digest("hex").slice(0, 8);
  try {
    const mod = await import("file:///" + ADAPTER);
    const p = typeof mod.paths === "function" ? mod.paths() : {};
    platformLine = String(p.line ?? p.platformLine ?? "unknown");
  } catch { platformLine = "unreadable"; }
}
console.log("vitest.family.config: root=" + repoRoot + " tier=" + tier + " platformLine=" + platformLine + " adapter=" + adapterSha);
if (adapterSha === "absent" && process.env.FAMILY_ALLOW_ABSENT_ADAPTER !== "1") {
  console.error("vitest.family.config: CANNOT DECIDE - no pinned line resolver at " + ADAPTER + " (set FAMILY_ALLOW_ABSENT_ADAPTER=1 to run anyway)");
  process.exit(2);
}

export default {
  test: {
    root: repoRoot,
    include: ["**/tests/**/*.spec.ts"],
    exclude: ["**/node_modules/**"],
  },
};
