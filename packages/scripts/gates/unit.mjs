/**
 * The build-backed unit lane entries (suite et al.).
 *
 * Data only: ids are FROZEN (see W10 §16.3) — never renumber, never derive from position.
 * `title` is the human Command column text; `argv` is the executable form (null = registered cannot-decide).
 */
import { gate } from './model.mjs'

export const unit = [
  gate("gate-03", {
    kind: "toolchain",
    tree: "overlay",
    title: "`node node_modules/vitest/vitest.mjs run packages/evolution --maxWorkers=2 --testTimeout=30000`",
    argv: ["node","node_modules/vitest/vitest.mjs","run","packages/evolution","--maxWorkers=2","--testTimeout=30000"],
    // CI writes the probe baseline next to the suite result (W10 M2); the lane call is the only suite.
    ci: { argv: ["node","node_modules/vitest/vitest.mjs","run","packages/evolution","--maxWorkers=2","--testTimeout=30000","--reporter=default","--reporter=json","--outputFile.json=${RUNNER_TEMP}/probe-baseline.json"], timeoutMs: 480000 },
    lanes: ["ci-unit"],
    // The full suite is a build-line/CI check: the local overlay cannot finish it inside any sane
    // budget, and a registered cannot-decide on a single-row lane still exits 2 (the audit's
    // "registration cannot save pass=0" defect). Local runs use targeted specs; CI owns the suite.
    localSafe: false,
    localSafeReason: "the full family suite runs on the build line/CI; local runs use targeted specs",
  }),
]
