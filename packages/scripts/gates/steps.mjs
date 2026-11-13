/**
 * Mutating/helper steps: build, setup, pack, publish and install commands. Registered, not run by run-gates before M3b.
 *
 * Data only: ids are FROZEN (see W10 §16.3) — never renumber, never derive from position.
 * `title` is the human Command column text; `argv` is the executable form (null = registered cannot-decide).
 */
import { gate } from './helpers.mjs'

export const steps = [
  gate("gate-04", {
    kind: "step",
    tree: "overlay",
    title: "`node packages/evolution/scripts/build-lib.mjs`",
    argv: ["node","packages/evolution/scripts/build-lib.mjs"],
    lanes: ["local","ci-unit","ci-release","ci-windows"],
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
  }),

  gate("gate-67", {
    kind: "step",
    tree: "mirror",
    title: "node packages/scripts/inject-evolution-paths.mjs upstream/tsconfig.base.json tsconfig.base.json",
    argv: null,
    lanes: ["ci-setup"],
    argvProblem: "no-command-in-cell",
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-68", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/install-layered.mjs --home \"$HOME_DIR\" --profile web --mode layered",
    argv: null,
    lanes: ["ci-windows"],
    argvProblem: "no-command-in-cell",
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-69", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/lib-line-header.mjs --ci --policy packages/evolution/scripts/line-policy.json",
    argv: null,
    lanes: ["ci-setup"],
    argvProblem: "no-command-in-cell",
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-70", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/prepare-release.mjs \"${ARGS[@]}\"",
    argv: null,
    lanes: ["ci-release"],
    argvProblem: "no-command-in-cell",
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-71", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/publish-scoped.mjs --no-provenance --dry-run",
    argv: null,
    lanes: ["ci-release"],
    argvProblem: "no-command-in-cell",
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("gate-73", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/run-load-sensitive.mjs .",
    argv: null,
    lanes: ["ci-unit"],
    argvProblem: "no-command-in-cell",
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
    registration: {"reason":"the gate table cell states the step in prose or carries a placeholder the runner cannot resolve","owner":"scripts/gate-manifest","expiry":"0.47.0","plan":"split each prose cell into a real argv row (or give the row an args source); rows that stay unresolvable keep the registration","renewal":"Renewed at 0.46.0 (expiry 0.47.0): the row is a prose table cell with no single argv; splitting the table into executable rows is one mechanical pass over CONTRIBUTING that this release did not include. The count is unchanged; the reduction is the split, not a per-row fix. Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the axis rows' reduction lands with the gate-table split / probe-baseline work tracked in W9-gates §4, scheduled before 0.47."},
  }),

  gate("ci-only-10", {
    kind: "step",
    tree: "mirror",
    title: "node packages/scripts/inject-evolution-paths.mjs upstream/tsconfig.base.json tsconfig.base.json",
    argv: ["node","packages/scripts/inject-evolution-paths.mjs","upstream/tsconfig.base.json","tsconfig.base.json"],
    lanes: ["ci-setup"],
    reason: "workflow plumbing: injects the mirror alias paths into the released upstream tsconfig (overlay setup, not a family check)",
    owner: "ci",
  }),

  gate("ci-only-11", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/install-layered.mjs --home \"$HOME_DIR\" --profile web --mode layered",
    argv: ["node","packages/evolution/scripts/install-layered.mjs","--home","\"$HOME_DIR\"","--profile","web","--mode","layered"],
    lanes: ["ci-windows"],
    reason: "Windows install smoke — needs a throwaway DSH_HOME and the packed staging tarballs",
    owner: "ci",
  }),

  gate("ci-only-12", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/lib-line-header.mjs --ci --policy packages/evolution/scripts/line-policy.json",
    argv: ["node","packages/evolution/scripts/lib-line-header.mjs","--ci","--policy","packages/evolution/scripts/line-policy.json"],
    lanes: ["ci-setup"],
    reason: "line-header policy check (--ci form) over the overlay tree",
    owner: "ci",
  }),

  gate("ci-only-13", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/prepare-packed-platform.mjs packages/evolution/dist \"$PLATFORM_VERSION\" | tail -n 1)\"",
    argv: ["node","packages/evolution/scripts/prepare-packed-platform.mjs","packages/evolution/dist","\"$PLATFORM_VERSION\"","|","tail","-n","1)"],
    lanes: ["ci-release","ci-windows"],
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
    expiry: "0.46.0",
  }),

  gate("ci-only-14", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/prepare-release.mjs \"${ARGS[@]}\"",
    argv: ["node","packages/evolution/scripts/prepare-release.mjs","\"${ARGS[@]}\""],
    lanes: ["ci-release"],
    reason: "the pack step itself (a build product, not a check)",
    owner: "ci",
  }),

  gate("ci-only-15", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/publish-scoped.mjs --no-provenance --dry-run",
    argv: ["node","packages/evolution/scripts/publish-scoped.mjs","--no-provenance","--dry-run"],
    lanes: ["ci-release"],
    reason: "publish dry-run of the staged tarballs",
    owner: "ci",
  }),

  gate("ci-only-16", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/requirements.selftest.mjs",
    argv: ["node","packages/evolution/scripts/requirements.selftest.mjs"],
    lanes: ["ci-static"],
    reason: "requirements registry self-test (a CI-only contract fixture)",
    owner: "ci",
  }),

  gate("ci-only-17", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/run-load-sensitive.mjs .",
    argv: ["node","packages/evolution/scripts/run-load-sensitive.mjs","."],
    lanes: ["ci-unit"],
    reason: "load-sensitive lock group runner (local-runner registered; the action runs it at pinned concurrency)",
    owner: "ci",
  }),

  gate("ci-only-18", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/smoke-packed-install.mjs packages/evolution/dist --platform-node-modules \"$PLATFORM_DIR\"",
    argv: ["node","packages/evolution/scripts/smoke-packed-install.mjs","packages/evolution/dist","--platform-node-modules","\"$PLATFORM_DIR\""],
    lanes: ["ci-release","ci-windows"],
    reason: "P2-33 packed-tarball consumer smoke: unpacks dist tarballs and imports every declared entry",
    owner: "ci",
  }),
]
