/**
 * Mutating/helper steps: build, setup, pack, publish and install commands. Registered, not run by run-gates before M3b.
 *
 * Data only: ids are FROZEN (see W10 §16.3) — never renumber, never derive from position.
 * `title` is the human Command column text; `argv` is the executable form (null = registered cannot-decide).
 */
import { gate } from './model.mjs'

export const steps = [
  gate("gate-04", {
    kind: "step",
    tree: "overlay",
    title: "`node packages/evolution/scripts/build-lib.mjs`",
    command: "node packages/evolution/scripts/build-lib.mjs",
    lanes: ["local","ci-unit","ci-release","ci-windows"],
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
  }),

  gate("gate-67", {
    kind: "step",
    tree: "mirror",
    title: "node packages/scripts/inject-evolution-paths.mjs upstream/tsconfig.base.json tsconfig.base.json",
    command: "node packages/scripts/inject-evolution-paths.mjs upstream/tsconfig.base.json tsconfig.base.json",
    lanes: ["ci-setup"],
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
  }),

  gate("gate-68", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/install-layered.mjs --home \"$HOME_DIR\" --profile web --mode layered",
    command: "node packages/evolution/scripts/install-layered.mjs --home \"$HOME_DIR\" --profile web --mode layered",
    lanes: ["ci-windows"],
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
  }),

  gate("gate-69", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/lib-line-header.mjs --ci --policy packages/evolution/scripts/line-policy.json",
    command: "node packages/evolution/scripts/lib-line-header.mjs --ci --policy packages/evolution/scripts/line-policy.json",
    lanes: ["ci-setup"],
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
  }),

  gate("gate-70", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/prepare-release.mjs \"${ARGS[@]}\"",
    command: "node packages/evolution/scripts/prepare-release.mjs \"${ARGS[@]}\"",
    lanes: ["ci-release"],
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
  }),

  gate("gate-71", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/publish-scoped.mjs --no-provenance --dry-run",
    command: "node packages/evolution/scripts/publish-scoped.mjs --no-provenance --dry-run",
    lanes: ["ci-release"],
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
  }),

  gate("gate-73", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/run-load-sensitive.mjs .",
    command: "node packages/evolution/scripts/run-load-sensitive.mjs .",
    lanes: ["ci-unit"],
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
  }),

  gate("ci-only-13", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/prepare-packed-platform.mjs packages/evolution/dist \"$PLATFORM_VERSION\" | tail -n 1)\"",
    command: "node packages/evolution/scripts/prepare-packed-platform.mjs packages/evolution/dist \"$PLATFORM_VERSION\" | tail -n 1)\"",
    lanes: ["ci-release","ci-windows"],
    reason: "mutating/helper step — registered, not run by run-gates (contract 5c)",
    expiry: "0.47.0",

    renewal: "Renewed at 0.46.0 (expiry 0.47.0). Renewed at 0.46.0 (expiry 0.47.0) with NO row reduction: this release is the W10 CI control-plane refactor; the local-slot/table split that closes these rows is tracked in W9-gates §4, before 0.47.",
  }),

  gate("ci-only-18", {
    kind: "step",
    tree: "overlay",
    title: "node packages/evolution/scripts/smoke-packed-install.mjs packages/evolution/dist --platform-node-modules \"$PLATFORM_DIR\"",
    command: "node packages/evolution/scripts/smoke-packed-install.mjs packages/evolution/dist --platform-node-modules \"$PLATFORM_DIR\"",
    lanes: ["ci-release","ci-windows"],
    reason: "P2-33 packed-tarball consumer smoke: unpacks dist tarballs and imports every declared entry",
    owner: "ci",
  }),
]
