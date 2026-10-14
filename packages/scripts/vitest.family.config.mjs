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
// The adapter is NOT decoration: it is the one place that knows the resolution order
// (mono -> profile -> closure -> upstream -> store), so the config consumes its ALIAS LIST.
// The previous revision printed platformLine= and adapter=<sha8> while resolving nothing through
// it, which is exactly why every platform-coupled spec died on
// "Failed to resolve entry for package @deepseek-ai/cordis" and why 87 files were re-laned by a
// measurement of the CONFIG rather than of the specs.
let aliasList = [];
if (existsSync(ADAPTER)) {
  try {
    const adapter = await import("file:///" + ADAPTER);
    if (typeof adapter.resolveAliases === "function") aliasList = adapter.resolveAliases();
  } catch (error) {
    aliasList = [];
    if (process.env.FAMILY_ALLOW_ABSENT_ADAPTER !== "1") {
      console.error("vitest.family.config: CANNOT DECIDE - the adapter at " + ADAPTER + " could not be loaded (" + (error instanceof Error ? error.message : String(error)) + ")");
      process.exit(2);
    }
  }
}
// A replacement that does not exist on THIS machine cannot be aliased: pointing the bed at a
// missing tree makes vitest fail to start its forks ("Failed to start forks worker") instead of
// failing the spec that needed it. The dropped entries are PRINTED - an alias silently skipped
// would be a resolution nobody can see.
const aliasesAll = aliasList;
aliasList = aliasList.filter((entry) => typeof entry?.replacement === "string" && existsSync(entry.replacement));
console.log("vitest.family.config: alias=" + String(aliasList.length) + "/" + String(aliasesAll.length) + " (live/total from the adapter; the pin above is the sha of the file that produced them)"
  + (aliasesAll.length === aliasList.length ? "" : " dropped=" + aliasesAll.filter((entry) => !aliasList.includes(entry)).map((entry) => entry.find).slice(0, 8).join(",")));
console.log("vitest.family.config: root=" + familyTree + " tier=" + tier + " lane=" + tier + "(ci=" + (process.env.CI ? "on" : "off") + ") platformLine=" + platformLine + " adapter=" + adapterSha);
if (adapterSha === "absent" && process.env.FAMILY_ALLOW_ABSENT_ADAPTER !== "1") {
  console.error("vitest.family.config: CANNOT DECIDE - no pinned line resolver at " + ADAPTER + " (set FAMILY_ALLOW_ABSENT_ADAPTER=1 to run anyway)");
  process.exit(2);
}

// C1/C2 membership: the taxonomy view is the projection (gen-check-taxonomy; R22' - a view owns
// no policy). A spec WITH a marker belongs to its tier's lanes; a spec WITHOUT one runs in the
// full lane only until the contract's requiredFrom makes the marker mandatory (R28).
const viewPath = resolve(here, "reports", "check-taxonomy.json");
let lanes = null;
try { lanes = JSON.parse(readFileSync(viewPath, "utf8")).lanes ?? null; } catch { lanes = null; }
if (lanes === null) {
  console.error("vitest.family.config: CANNOT DECIDE - the taxonomy view is missing (" + viewPath + "); run gen-check-taxonomy.mjs");
  process.exit(2);
}
const census = (() => { try { return JSON.parse(readFileSync(viewPath, "utf8")).specs ?? { total: 0 } } catch { return { total: 0 } } })();
const laneKey = tier === "full" ? (process.env.CI ? "full(ci=on)" : "full(ci=off)") : tier;
const lane = lanes[laneKey];
if (lane === undefined) {
  console.error("vitest.family.config: CANNOT DECIDE - the view has no lane " + laneKey + " (lanes: " + Object.keys(lanes).join(", ") + ")");
  process.exit(2);
}
const marked = new Set(Object.values(lanes).flatMap((entry) => entry.specs));
const members = new Set(lane.specs);
// A lane narrower than full must run EXACTLY its members: an exclude-list cannot express that,
// because the specs WITHOUT a marker are not in any list to exclude (the first version let an
// untagged spec run in the pre-tag lane and looked right while doing it). full keeps the
// layout-agnostic glob and only drops the specs that a marker sends to another lane.
const laneIsFull = laneKey.startsWith("full");
const memberGlobs = [...members].map((key) => key.split("::").join("/"));
const excluded = laneIsFull ? [...marked].filter((key) => !members.has(key)).map((key) => key.split("::").join("/")) : [];
console.log("vitest.family.config: lane=" + laneKey + " members=" + String(members.size) + " excluded=" + String(excluded.length) + " marked=" + String(marked.size) + "/" + String(census.total));
if (members.size === 0) {
  console.error("vitest.family.config: CANNOT DECIDE - tier " + tier + " has no spec member yet (an empty REQUIRED lane is not a green run; tag the specs with @tier or run lane=full)");
  process.exit(2);
}

export default {
  resolve: { alias: aliasList },
  test: {
    root: familyTree,
    include: laneIsFull ? ["*/tests/**/*.spec.ts"] : memberGlobs,
    exclude: ["**/node_modules/**", ...excluded],
  },
};
