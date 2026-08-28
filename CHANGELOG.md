# Changelog

## Unreleased — rc.43: control-plane hardening (M1 core + curator pause)

- `SkillLibrary.consolidate` two-phase rollback now covers mid-loop archive failures: a refused/failed archive after earlier sources were already archived previously bypassed the rollback (`return` inside the loop), leaving the tree half-consolidated. The failure now routes through the catch, which restores the target body and un-archives every already-moved source. A regression test simulates the media failure with a throwing IO proxy.
- `EvolutionCurator.run` scores quality BEFORE the lifecycle transitions: the transition engine reads this run's freshly computed `quality_warn` for the shorter quality-warn stale window, instead of the previous run's persisted state (the quality-warn path used to lag a full curator cycle).
- `EvolutionCurator` normalizes "no state service" onto "no persisted state": with `evolutionState` unmounted the first-run defer never fired and the interval gate compared NaN, so a fresh install ran immediately. State-less compositions now defer first sight like every other composition (manual `/evolution curator run` is unaffected).
- Curator pause (Hermes `set_paused` parity): `paused: true` on the persisted state skips automatic passes (gate sits before interval, matching `should_run_now` order); `setPaused(bool)` persists it (seeding `lastRunAt: now` when state is empty so a resume re-enters through the interval gate); `/evolution curator pause|resume|status` expose it. Manual runs bypass the pause by design.
- Review subagent runs are disposed on EVERY exit path: a timed-out/aborted run (result rejecting via the start signal) previously skipped `dispose()` and leaked the child session.
- Review per-session counters (`turnStarts` / `cumulativeToolCalls` / `completionInjected`) now sweep entries whose agent is gone under size pressure (threshold 128) — the platform has no in-process session-end hook, so the maps previously grew unbounded on a long-lived host.
- `SkillLibrary.snapshotAll` guards against same-millisecond destination collisions: two snapshots in one ms (restore's pre-rollback snapshot racing the snapshot it restores from) shared one directory and the later copy overwrote the earlier manifest, so a restore could read the wrong tree.

## Unreleased — P0-1: evolution events leave the session log (resume safety)

- `evolution/review-scheduled` and `evolution/plan-applied` are no longer session events: a persisted session log carrying a type outside the host's `KNOWN_SESSION_EVENT_TYPES` is refused wholesale at resume (`assertEventsSupported`) and `Session.append` offers no `ignorable` channel, so any review trigger made the session unresumable. Both payloads (v2, now carrying `sessionId`) moved to the cordis event bus; the session log stays native-only.
- `evolution-activity` retires its session projection (the dual-contract registration goes with it) and replaces it with a durable store: every plan outcome persists to `$DSH_HOME/evolution/activity.json` via the evolution IO seam (versioned shape, bounded, merge-on-restart) — the read path that survives host restarts without a session.
- `evolution-replay` subscribes to the process event directly; its leaderboard stays in-memory by design (durability is the activity store's job).
- New acceptance test: a persisted resume e2e over the real JSONL backend (write → dispose/flush → fresh-context reload), plus a regression guard proving the pre-change behavior (a direct `evolution/*` append) is still refused by the upstream gate.
- Sessions written before this change that contain `evolution/*` types remain unresumable on 0.1.1-rc.2 hosts; export from the old process first if their content matters.

## Unreleased — DSH 0.1.1 projection-contract adaptation

- `evolution-activity` now registers its projection with BOTH contract generations: `stateSchema` + `wire.viewSchema` (the 0.1.1+ session-projection contract, where cold reads call `stateSchema.parse` on checkpointed rows) and the legacy `schema` + `view` fields (0.1.0-rc.6 era). Each registry ignores the fields it does not know, so one build serves both host lines. The new half is load-bearing: without `stateSchema` a 0.1.1+ cold read throws.
- The projection regression test now asserts both contract shapes are parse-callable.

## Unreleased — Hermes-alignment: review hardening and curator consolidation

- `evolution-review`: review subagents no longer hardcode `deepseek-official`; the new `reviewProvider` config selects the provider and, when omitted, the subagent inherits the deployment default route (model routing stays on the policy).
- `evolution-review`: review request text is redacted for credential-shaped patterns (API keys, tokens, JWTs, bearer headers, inline `token=`/`secret=` assignments) before it reaches the review subagent.
- `evolution-core` (`SkillLibrary`): added `consolidate(target, sources)` — merge source bodies into a target with absorbed-from markers, archive the sources with `.archive-reason`, never hard-delete.
- `evolution-core` (`SkillLibrary`): added `restoreFromArchive(name)` — bring one archived skill back to the active root.
- `evolution-curator`: `consolidate()` / `restore()` control-plane methods with snapshot-first mutation and usage-state folding; excluded skill names stay refused.
- `evolution-commands`: `/evolution consolidate <target> <source...>` and `/evolution skill restore <name>`.

## Unreleased — legacy facade retired from publishing

- `prepare-release.mjs` now skips `dsh-evolution` (`PUBLISH_EXCLUDE`): the legacy facade stays in the tree as source of record and keeps its tests, but new releases no longer publish it — every published version on npm is deprecated and must not be revived.
- Dropped the unused `@deepseek-ai/dsh-evolution` devDependency from `evolution-feedback`.

## Unreleased — projection schema contract fix

- `evolution-activity` now builds its session-projection schema with zod instead of schemastery: `dsh-session-projection` reads every projection through `def.schema.parse(...)`, and schemastery schemas expose `resolve()` rather than `parse()`, breaking session-history loads at runtime.
- Plugin `Config` stays schemastery; only the projection schema moved to zod (`^4.4.3`, matching `dsh-session-projection`).
- Added a regression test that captures the registered projection definition and asserts its schema is callable through `.parse` and rejects invalid rows.

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
