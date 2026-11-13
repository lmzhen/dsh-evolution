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
    lanes: ["local","ci-unit"],
    registration: {"reason":"the full family vitest suite does not return on this machine within the 180 s budget","owner":"scripts/gates","expiry":"0.47.0","plan":"CI owns the full suite; local runs use targeted specs","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row judges the build line/CI tree (platform typecheck, full suite, built entries, coverage records, health corpora) and the local overlay cannot supply those inputs; the CI action executes the same check. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),
]
