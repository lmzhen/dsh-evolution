# Changelog

## Unreleased — rc.56: platform-version reconciliation (N-2) + CI range guard

The v2 audit's second P1: publish metadata declared `@deepseek-ai/dsh-*` peer ranges as `^0.1.0-rc.6` (`UPSTREAM_VERSION`) while the compat gate validated the release against `dsh-v0.1.1-rc.2` — under semver prerelease rules `^0.1.0-rc.6` does not match `0.1.1-rc.2`, so the declared support range silently diverged from the platform actually validated.

- Single version definition point: the release workflow now carries one `PLATFORM_VERSION`; the compat gate's `upstream_ref` derives as `dsh-v${PLATFORM_VERSION}` and the pack step rewrites every platform `@deepseek-ai/dsh-*` range to `^${PLATFORM_VERSION}`. The dev baseline (`UPSTREAM_SHA`) stays a validate-only anchor and no longer feeds release metadata.
- `prepare-release.mjs` takes `--platform-version` (renamed from `--upstream-version`) and the composite action passes the input through both jobs.
- New mechanical CI guard: `verify-platform-ranges.mjs` walks every staged manifest after packing and asserts each `@deepseek-ai/dsh-*` platform range equals `^${PLATFORM_VERSION}`, failing loudly with the offenders (family-scoped `@lmzhen/dsh-*` packages are exempt — they range against the family's own release version). Runs in both the baseline and released-upstream validate jobs, before the publish dry-run.
- Guard regression tests (subprocess over fixture manifests): correct ranges pass, a drifted `^0.1.0-rc.6` fails with the package and expected range named, malformed/missing manifests are tolerated.

## Unreleased — rc.55: report-surface regression fix (N-1) + report-surface contract tests

The v2 audit (`AUDIT_REPORT_v2.md`) found the rc.49 P2-6 optimization ("one directory listing replaces per-marker exists() probes") introduced a real regression: `SkillLibrary.list()` matched marker entries WITHOUT the dot prefix, so every `protectedBy`/`managed` report was poisoned (null/false) — the `skill_manage review` text lost its `[pinned]` markers and the curator's `protectedNameMap` went blind (its `scopeView().protected` stayed correct only through the `seedBaseline` `isPinned` mirror as a second layer).

- `SkillLibrary.list()` now matches directory entries through the single `markerEntryName()` helper shared with `markerPath()` — the dot-prefixed marker name can never drift between the `exists()` probes and the directory scan (N-1). The two previously carried independent literals, which is exactly how the rc.49 convergence dropped the dot.
- Report-surface contract tests (the N-1 anti-regression sample of the v2 plan §8): `skill-store.spec` pins `.pinned` → `protectedBy: 'pinned'`, `.hermes-managed` → `managed: true`, and bundled > hub-installed > pinned precedence on a triple-clash; `curator.spec` pins a dot-marker pinned skill appearing in `scopeView().protected` and a plain skill not; `tool-skill-manage.spec` pins the `[pinned]` marker in the review text. All three fail on the pre-fix code.
- D-7 (moved up from the rc.59 batch): the mirror `tsdown.package.config.ts` entry glob dropped its phantom `startup` — the dev-tree config lost it in rc.51 but the publishing carrier kept it, so published bundles referenced a `lib/types/startup.js` that no build produces.

## 补记 — rc.49–rc.54 (backfilled entries; findings for this span: `AUDIT_REPORT_v2.md` §2)

- rc.49: decision C — mutation events sink into `SkillLibrary` (one emission point; catalog invalidation covers every write path) + P2-6 list N+1 convergence (one directory listing replaces per-marker probes; snapshot parallel copy; catalog get shares the list) + G6 report keep-20 retention with markdown digests.
- rc.50: seam hardening — `io.transact` atomic RMW (usage/mutations/suppressed via `mutateUsage` et al.), list ENOENT-vs-EACCES distinction, `dshHomePath` helper, feedback awaitable dispose + serialized queue, snapshot restore residue clearing, G7 symlink guard on archive/restore-from-archive.
- rc.51: M4 engineering closeout — decision D2 declarations, dead-code removal (JsonState, `MemoryStore.replace`/remove), capability retired from host/preset rows (D-9), version single-source, published-upstream compat job, docs (F-2/4/6/7, G8 superseded markers, rc39 2.9 re-anchor).
- rc.52: curator suppression save resurrected a concurrently deleted name — the suppression save is now a delta-only union (only this run's additions), plus P2-14 comment truth and usage regression tests.
- rc.53: evolution-agent becomes delta-only — the agent preset composition is generated at install time by `install-layered.mjs` from the RUNTIME platform's standard rows (the compat byte-for-byte alert retired; compat job full chain green).
- rc.54: compat-check promoted from watching to a hard publish gate — publish now `needs: [validate, compat-check]`; a released-upstream incompatibility blocks releases.

## Unreleased — rc.48: fail-closed fix for the rc.47 approval pre-check

A regression review of rc.46-47 found one behavioral defect, shipped with an updated regression test.

- The rc.47 P1-9 pre-check ("approval enabled but no replay runner registered") chose to EXECUTE the write through the review's trusted direct path. That silently bypasses an explicit operator control: enabled approval means autonomous writes must pass human review, and a host-only deployment has no approval path — so the correct behavior is to refuse the write (fail closed), not stage it and not execute it. The review now skips the op with a visible warn and an explanatory result message; the pending queue stays clean and the gate holds. Writes become answerable again as soon as a tool that registers the runner mounts, or the operator disables approval. (fixes the rc.47 change; the pre-rc.47 behavior — accumulating unanswerable pendings — was the original defect)

## Unreleased — rc.47: orchestration closeout (M2/M3) + memory error surface (G5)

- P1-9: the review pipeline pre-checks `EvolutionApproval.hasRunner(kind)` before requesting approval — with approval ENABLED but no registered runner (host-only compositions mount no tool runners), the write now executes through the trusted direct path instead of staging a pending record that no approver could ever replay. The approval service exposes `hasRunner` and warns when staging an un-replayable kind; `capability` records are exempt (they are answerable without a runner). Covered by an end-to-end test asserting the write lands and the pending queue stays empty.
- P2-9: the three review subagent contract points are verified against the dsh-v0.1.1-rc.2 source and pinned by smoke assertions — `toolFilter: { allow: [...] }` matches `ToolRestriction`, `outputSchema.items: { type: 'json' }` is the DSL's lossless JSON node, and `maxDepth: 0` is a legal non-negative safe integer that blocks further spawns.
- G5: failed memory mutations now echo the current entries so the model can self-recover without a separate read (Hermes `memory_tool.py` recoverable-error parity): missing `old_text`, missed matches, ambiguous multi-matches and budget failures append a bounded `Current entries (preview)` block — at most 5 entries of 80 characters each, long entries truncated.
- P1-5 / decision C adjudicated (documentation only, implementation next batch): skill write-event emission sinks into `SkillLibrary` as the final state; this batch deliberately does not implement it to avoid rework against the next batch's refactor. The acceptance criterion is recorded: any write path leaves the native `ctx.skills` catalog immediately consistent.

## Unreleased — rc.46: control-plane decisions (M2) + model-text v3 (G4)

- Decision B landed: `EvolutionGateSet` in core is the single source for the name-set protections (excluded / referenced / suppressed / protected builtins), reporting a `blockReason` so surfaces can explain refusals. All four former gate implementations — the lifecycle engine, the scope view, the LLM nomination gate and the control-plane consolidate — now read one instance; `gateConsolidations` additionally blocks protected builtins (e.g. `plan`) that the name-set check missed. (P1-8)
- Control-plane `/evolution consolidate` enforces the full gate set: the manual path used to check only `excludeSkillNames`, bypassing the referenced/suppressed/protected protections the automated nomination gate enforces. (P1-8)
- P1-12 resolved as documentation (per the Hermes-alignment audit: the behavior is ✅ aligned): foreground-created skills stay outside the deterministic lifecycle because only the review pipeline marks agent authorship; `manageUnmanaged: true` opts them in. Documented in the README.
- P2-11 resolved by deletion: the `policy.json` path defense (`protectedPaths`, `isProtectedPath`, the file-tool arm of the policy guard) defended an artifact nothing in the product ever reads or writes. The real defense — governance-key refusal on the evolution tools — is untouched and now covered directly in the policy spec.
- Origin mapping single-sourced: `resolveOrigins(headerOrigin, isReview)` in core is the one table mapping a session onto the approval surface (delegated subagent = review channel) and the library surface (review fork = `background_review`, other subagent = `subagent`, foreground = `foreground`). `tool-memory`, `tool-skill-manage` and the review executor read it instead of re-deriving the mapping inline. (A-line M2-2.3)
- Skill creation is no longer counted as a patch: `skill_manage create` leaves `patch_count` at zero so mutation maturity is not inflated by mere authorship. (A-line M3-3.3)
  The usage record itself is now created at authorship (`SkillUsageRegistry.ensureRecord`): the record must exist from birth (created_at anchor, quality surfaces read it) — the pre-fix change dropped the record entirely, which CI caught because the local vitest config never included the tool packages. The local config and the registry now cover them. (A-line M3-3.3)
- Prompt bundle v3 (`dsh-evolution@3`): the pinned-skill wording now matches the implementation ("pinned skills are read-only to the background review", replacing the contradictory "may be patched"), and the memory-review prompts carry the explicit read-before-write constraint for the inject fallback path. Mixed-version deployments fail closed by design — upgrade all evolution packages together. (B-line G4, rc.39 audit §4-D/E)

## Unreleased — rc.45: regression fixes from the rc.42-44 review

A focused re-review of the three previous releases found three defects; each ships with a regression test that fails on the pre-fix code.

- `EvolutionCurator.run` no longer clears an operator pause: the end-of-run state write hardcoded `paused: false`, so a manual run (allowed while paused by design) — or a pause arriving while a pass was in flight, including the dry-run preview — silently un-paused the curator. The current flag is re-read at save time and preserved. (introduced in rc.43)
- `applyActivityEvent` clamps a non-positive `maxItems` to at least one record: `slice(-0)` keeps everything, so a zero cap disabled the activity sidecar's bounding entirely. (introduced in rc.42)
- `/evolution curator status` survives a corrupt `lastRunAt`: `new Date(NaN).toISOString()` threw a RangeError out of the command handler; non-finite/non-positive values now render as `lastRun=unknown`. (introduced in rc.43)

The review also verified the rest of the rc.42-44 surface: no `session.append('evolution/*')` remains in live code (only the gitignored `.release-staging` mirror), both process-event consumers (activity, replay) are migrated, and the paused gate / first-run defer / manual-override interactions are pinned by the new tests.

## Unreleased — rc.44: store/medium hardening (M1 media) + graph semantic edges (G3)

- `MemoryStore.detectDrift` adopts empty and whitespace-only files as "never written" instead of flagging drift: they parse to zero entries, so the canonical form could never byte-match and every write path was permanently refused — including the repairs the model would make. (P1-6)
- The consolidation-failure backoff counter decays over a rolling window (10 minutes, package-private): failures older than the window stop counting, so three failures yesterday no longer make today's first refusal say "stop retrying". The store cannot observe turn boundaries, so the model-facing "this turn" phrasing is a documented approximation. (P2-1)
- Usage-sidecar records are field-normalized on load (`normalizeUsageRecord`, pure and unit-tested): mistyped counters/timestamps/flags fall back to their `emptyRecord` baseline instead of propagating `NaN` into quality math and lifecycle comparisons; an invalid `created_at` anchors the age clock at now. `.mutations.json` loading drops records without a string `at` (it feeds `.slice()` in command surfaces). (P2-3)
- `SkillLibrary` routes every directory path through a single `dirOf` choke point and trims the skill name at each method entry, so a name that passes validation can no longer mint a whitespace-padded ghost directory; `consolidate` and `restoreFromArchive` normalize their names before validating. (P2-5)
- Shared defaults are single-sourced: `memory-files` reads `DEFAULT_MEMORY_CHAR_LIMIT` / `DEFAULT_USER_CHAR_LIMIT` / `DEFAULT_CONSOLIDATION_FAILURES` from core (new constant); `tool-memory` and the curator keep their package-private tunables (`entryPreviewChars`, `qualityWarnStaleAfterDays`) as single within-package constants. (P2-8)
- `evolution-state-domain` retries a failing `open()` with bounded exponential backoff and clears the shared opening promise on rejection: one transient backend failure (lock, busy) no longer takes the provider down until restart. (P1-4)
- Learning-graph skill-skill edges are semantic (B-line G3): `relatedSkillNames(content, exclude?)` in core is the single `related_skills` parser (deduplicated, self-excluding) feeding both the quality references factor and `/evolution graph`; the former alphabet-order edge chain between unrelated neighbors is gone, edges only connect skills that exist, and the graph output gained a density line (edges per node, isolated percentage). (B-line §4-C)

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
