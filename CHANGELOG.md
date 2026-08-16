# Changelog

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
