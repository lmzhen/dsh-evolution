# Changelog

## Unreleased — publish-shape alignment

- Bundle/preset packages now carry the same runtime package shape as dsh-base: `src/index.ts`, root/invariant exports, main/types, and publish files.
- Root README gained a contents table, quick start, install warning, and a Chinese translation.

## Unreleased — DSH package compliance

- Every evolution package now owns `./invariant`, `src/invariant.ts`, tsconfig invariant reference, and `lib/invariant.js` publication entries.
- Every package README now carries the required Model Experience and Known Limitations sections; all DSH doc gates pass.

## Unreleased — Phase 5 and final hardening

- Added `@deepseek-ai/dsh-evolution-capability`: validates Creator-mode capability packages and stages them through the existing approval audit without executing code.
- Approval of `capability` records records human intent for manual Creator-mode activation instead of failing on a missing runner.
- Added uninstall support to the layered installer, preserving user data.
- Added profile-override composition test.
- Agent preset test now enforces byte-for-byte synchronization with the upstream standard preset.

## Unreleased — Phase 4 installer and docs

- Added `scripts/install-layered.mjs` with host/agent/layered/oneclick modes and dry-run support.
- Added `packages/INSTALL.md` with local, production, and profile-override workflows.
- Added installer regression tests covering clean DSH_HOME install, one-click install, and dry-run.

## Unreleased — Phase 3 Anchored Standard smoke

- Host patch now pins `evolution-review.reviewToolAllow` to `skill`, `skill_search`, and `skill_load`.
- Added an end-to-end review smoke against the real anchored `tool-bootstrap.mjs`: a session turn triggers a review subagent request whose `toolFilter` contains the anchored discovery pair.

## Unreleased — Phase 2 row and installation contracts

- Added a shared `row-contract.ts` pinning host/agent/compat row ids and package names.
- Added row-contract and dependency-contract suites for `evolution-host` and `evolution-agent`.
- Added a runtime installation matrix: host-only services have no model tools; host+agent exposes them.
- Compatibility preset test now verifies containment of every contracted layer row.

## Unreleased — Phase 1 layered installation

- Added `@deepseek-ai/dsh-evolution-host`: host-plane infrastructure bundle with registries, providers, policy, approval, review, curator, and observability — no model-facing tools.
- Added `@deepseek-ai/dsh-evolution-agent-preset`: standard agent preset plus `memory`, `skill_manage`, and the native skill-catalog bridge.
- Kept `@deepseek-ai/dsh-evolution-preset` as the one-click compatibility bundle, with composition tests asserting the three layers stay synchronized.

## Unreleased — Anchored Standard compatibility

- Review subagent `toolFilter` now defaults to `skill`, `skill_search`, and
  `skill_load`, so review children can discover/load skills under anchored
  presets that hide the plain `skill` tool.
- Added an anchored-standard compatibility suite using the actual vendored
  `tool-bootstrap.mjs`/`compaction-epoch.mjs` plugins: evolution tools stay
  hidden during bootstrap, remain hidden after promotion, and appear only
  after `dev_tool_search` unlocks them.

## Unreleased — optimization groups

- Added `evolution-skill-catalog`: native `ctx.skills` provider with explicit invalidation on `evolution/skill-mutated`.
- Approval resolve is now atomic (`tryResolvePending`) across JSON and storage-domain providers, with in-process dedupe.
- Feedback is durable through the IO seam and feeds `quality_score`/`quality_warn` into skill usage and curator thresholds.
- Curator runs persist a JSON report; `/evolution curator report` reads it; optional `minIdleHours` skips runs during active sessions.

## Unreleased — seams and host-plane alignment

- Added `evolution-io` registry + `evolution-io-node` atomic provider; native
  packages no longer import node:fs directly.
- Split durable state into `evolution-state-storage` (seam),
  `evolution-state-domain` (storage-domain KV), and `evolution-state-json`
  (portable fallback with a serialized write queue).
- Migrated approval history onto `evolutionState`; resolved records stay in
  the audit trail.
- Native `memory` and `skill_manage` tools now pass through staged approval
  and register replay runners.
- `evolution-policy` now installs a monotonic DSH `tools.guard`; review reads
  thresholds and model routes from policy.
- Removed manual delegation-depth checks in favor of DSH subagent origin
  scoping; review uses subagent structured output and deterministic plan IDs.
- Added sha256-pinned prompt bundle, Hermes authoring standards, curator LLM
  advisory pass, and replay session-event driver.
- Preset now treats the storage stack as host-plane (patch overlay) while the
  standalone composition still ships a complete JSON-backed stack.
- Hardened no-op `expect(actual, message)` tests into real assertions.

## 0.2.0 — Phase 6 release

- Added evolution-activity session projection.
- Added evolution-feedback quality scoring.
- Added `/evolution graph` command.
- Preset now includes activity and feedback.
- Full plugin family: memory, skills, review, policy, validator, state,
  approval, threat, curator, commands, graph, replay.
