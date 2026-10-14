// packages/scripts/vitest.family.config.mjs — the family test config (G3 / C1-C3).
//
// ONE config for BOTH layouts: the mirror carries packages/<pkg>/tests/**, the overlay carries
// packages/evolution/<pkg>/tests/**. The root is derived from THIS file's URL (never CWD) and the
// include pattern is layout-agnostic, so the same bytes work in either tree.
//
// Run:  npx vitest run -c packages/scripts/vitest.family.config.mjs <file-or-name>
// Lane: FAMILY_TIER=<lane> (explicit). The lane list is NOT a constant here: it is the
// testing-policy fact's cumulative chain (R71: full is the execution lane, ci-only joins it
// when ci=on). Membership filtering arrives with the taxonomy view.
// Adapter: the machine line resolver must be pinned and printable; when it cannot be read the config
// refuses to run (exit 2, CANNOT DECIDE) instead of letting a platform TypeError look like a broken
// environment. FAMILY_ALLOW_ABSENT_ADAPTER=1 downgrades that refusal to a printed warning.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// C1/C2: the run root is the FAMILY TREE that holds this file (mirror: <root>/packages,
// overlay: <root>/packages/evolution) — derived from this file, never from CWD. Because the
// include pattern is relative to that tree, the same bytes scope the run to family specs only
// and can never pick up the upstream packages/ the overlay also carries.
const familyTree = resolve(here, "..");
if (!existsSync(resolve(here, "..", ".."))) {
  console.error("vitest.family.config: CANNOT DECIDE - the tree above " + here + " does not exist");
  process.exit(2);
}
// R84/R71: the lanes are policy, not a constant here - the chain lives in the testing-policy fact.
const policyPath = resolve(here, "family-facts.json");
let policyFact = null;
try {
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  policyFact = (policy.facts ?? []).find((entry) => entry?.machine?.kind === "testing-policy") ?? null;
} catch { policyFact = null; }
const LANES = Array.isArray(policyFact?.machine?.cumulative) ? policyFact.machine.cumulative : [];
if (LANES.length === 0) {
  console.error("vitest.family.config: CANNOT DECIDE - the testing-policy fact states no cumulative lane chain (" + policyPath + ")");
  process.exit(2);
}
const tier = process.env.FAMILY_TIER ?? LANES[LANES.length - 1];
if (!LANES.includes(tier)) {
  console.error("vitest.family.config: unknown FAMILY_TIER=" + tier + " - the policy's lanes are " + LANES.join(" | "));
  process.exit(2);
}

// C3 (R31 / L294): a reading carries BOTH the expected platform line - the machine value the
// policy fact owns (adapter.expectedLine), never a human sentence - and the resolver pin (sha8).
// A missing expected line is CANNOT DECIDE: "unknown" cannot be compared, and a reading nobody
// can compare is not a pass. The comparison itself is verify-line-identity's判决, not this line.
const ADAPTER = "D:/dsh/_tools/lib-line.mjs";
const platformLine = policyFact?.machine?.adapter?.expectedLine;
if (typeof platformLine !== "string" || platformLine.trim() === "") {
  console.error("vitest.family.config: CANNOT DECIDE - the testing-policy fact states no adapter.expectedLine (" + policyPath + ")");
  process.exit(2);
}
let adapterSha = "absent";
if (existsSync(ADAPTER)) adapterSha = createHash("sha256").update(readFileSync(ADAPTER)).digest("hex").slice(0, 8);
console.log("vitest.family.config: root=" + familyTree + " tier=" + tier + " lane=" + tier + "(ci=" + (process.env.CI ? "on" : "off") + ") platformLine=" + platformLine + " adapter=" + adapterSha);
if (adapterSha === "absent" && process.env.FAMILY_ALLOW_ABSENT_ADAPTER !== "1") {
  console.error("vitest.family.config: CANNOT DECIDE - no pinned line resolver at " + ADAPTER + " (set FAMILY_ALLOW_ABSENT_ADAPTER=1 to run anyway)");
  process.exit(2);
}

export default {
  test: {
    root: familyTree,
    include: ["*/tests/**/*.spec.ts"],
    exclude: ["**/node_modules/**"],
  },
};
