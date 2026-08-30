# Changelog

## Unreleased — rc.69: audit-followup fixes (migration merge race, empty-log self-heal)

The post-rc.68 audit found two real defects in the event-log layer; both fixed with regression tests.

- **B-1 (P2, migration merge race)**: the rc.68 migration was first-writer-wins — a concurrent first append that created the log between `restore()`'s read and the migration transact made the migration silently skip, losing the legacy aggregate entirely. `migrateFeedbackEvents` now APPENDS the expected legacy sequence (seq-shifted) whenever the log does not already contain it as a contiguous semantic run (type/kind/target/rating/note; `seq`/`at` excluded — merged logs carry shifted seqs and re-synthesis stamps a new `at`). Idempotent and race-safe (the search runs inside the same transact); already-migrated rc.68 logs never re-append (their sequence is present), so no double-count. Regression test: concurrent-first-event log + legacy aggregate → 4 events, second migration no-op, restore sees both sides.
- **B-2 (P3, empty-log brick)**: a whitespace-only `events.json` (crash residue) was treated as malformed — every future append refused, bricking the loop's data plane until manual deletion. Whitespace-only content now reads as EMPTY (rebuildable) and the next append writes a fresh log; genuinely corrupt bodies still refuse (rc.65 posture). Tests: empty read + append rebuild, feedback record after an empty log.
- **B-3 (CI-only, lock budget)**: the write-lock retry budget (10 × 50ms = 500ms) was too tight for 8-writer contention bursts on a loaded CI runner — a legitimate serialization surfaced as a fail-loud throw (rc.65 behavior, correct integrity, wrong budget). Budget raised to 40 × 50ms (~2s); fail-loud is preserved, bursts serialize.
- **Minor**: the `Config.path` doc no longer claims the event log is the cache file's sibling (events always derive from `home`, never from the override).

## Unreleased — rc.68: feedback event log — single source of truth (K-6 absorbed, /learn events)

The rc.66 hangover's real fix (append-only event log) landed per the reviewed design (`docs/design-review/006-feedback-events-single-source.md`).

- **Event log is the truth** (`$DSH_HOME/evolution/events.json`): new `evolution-core/evolution-events.ts` primitives (`eventsFile`/`appendEvolutionEvent`/`readEvolutionEvents`) — every feedback increment appends one `{ seq, at, type: 'feedback', kind, target, rating, note? }` event under the write lock (seq = max+1 inside the transact, cross-process unique; malformed logs refuse the append, rc.65 posture). `feedback.json` becomes a **rebuildable boot cache** `{ version: 2, lastSeq, skills, sessions }`, written only from the event-fold truth (never from the optimistic memory state — no phantom double-count at later boots); the in-memory state stays the optimistic aggregate with the rc.66 memory-wins restore semantics.
- **Migration (idempotent)**: no event log yet → the existing aggregate (legacy v1 or v2 cache) is folded into synthetic events once (first process wins the transact, later boots see the log and skip), then the cache is rebuilt from the log. Tests: migration counts/notes, idempotence across two boots, cache-incremental fold never double-counts after an append, concurrent appends keep unique seq, malformed log bytes preserved.
- **K-6 absorbed**: `record(target, rating, note?, kind?)` dropped the per-call `io` parameter — both paths derive from the constructor surface only (io backend + home), so path/backend mismatch is structurally impossible.
- **/learn events**: the learn branch appends `{ type: 'learn', source: 'manual', request }` to the same timeline (soft-probed `evolutionIo` registry; the inject is never blocked). Feedback and learn now share one ordered log, so the self-improvement loop ("feedback before/after learning X") is answerable.
- **Sidecar inventory**: 7th row — `evolution-core/src/evolution-events.ts` (`appendEvolutionEvent`) joins the transact list; the lockstep test floor moved to 7.

## Unreleased — rc.67: audit-v4 batch (curator write-path convergence, merge-heuristic input, read-before-write, /learn injection)

The four AUDIT_REPORT_v4.md findings that belong to this batch landed together with the previously-accepted merge-heuristic input and the /learn delivery fix.

- **K-1 (P2, control-plane usage write escaped the transact migration)**: `consolidate()`/`restore()` no longer load→modify→`saveUsage` (a bare whole-file write). Both now fold through `mutateUsage` — the same transact-backed RMW as the automated path. This also closes the data-loss the audit did not list: the old path parsed a malformed usage sidecar as empty and rewrote an empty map over the corrupt bytes; the RMW refuses to touch a malformed sidecar. Regression test: counters survive a control-plane consolidate, and a corrupt sidecar survives a restore byte-for-byte.
- **K-2 (P2, record-granularity fold clobbered window bumps)**: new `applyCuratorFields`/`foldCuratorFields` in core define the curator's OWNED field set exactly (`state`, `archived_at`, `quality_score`, `quality_warn`, `pinned`) and project the run-start snapshot onto the disk map at field granularity — a concurrent tool-side counter bump between run start and save survives. All three curator writes (lifecycle fold, consolidate, restore) go through it. Unit tests pin the exact field set and the preserve-under-stale-snapshot behavior.
- **Merge heuristic input (rc.67)**: `computePrefixClusters` (core, next to `computeDedupGroups`) deterministically indexes candidate names by their first alphanumeric run; `recommend()` hands the model a "Prefix clusters observed" orientation section (groups ≥2, largest first) instead of making it infer clusters from the raw list. Orientation-only: the candidate pool, gates, and LLM-nomination authority are untouched, so the M-1 executability boundary is unchanged. Tests: pure cluster function + prompt-capture assertion.
- **K-3 (P3, read-before-write wording)**: SKILL_REVIEW and COMBINED now carry the explicit enforced rule — only skills loaded or read this session may be updated/patched/deleted/support-filed; `CREATE` of a brand-new umbrella is the sole exception (mirrors `filterUnreadSkillOps`'s READ_REQUIRED set and its create exemption). Prompt bundle bumped to `dsh-evolution@7`; the plan variants inherit the sentence verbatim (template concat) and the contract test pins it.
- **/learn injection (was echo-only)**: command results never enter model history, so the old `return ok(buildLearnPrompt(...))` echo could never reach the agent. The learn branch now injects the prompt as a first-class user message into the invoking agent (same shape as the auto-review inject path) and returns a short UI-only status. Spec updated to assert the injected message (content + plugin source) instead of the echo.
- **Windows lock-create race (found during this batch)**: `withWriteLock` threw on `EPERM` from the `wx` lock-file create — Windows surfaces the concurrent-create/delete race as `EPERM` instead of `EEXIST`, so a peer's holder-lock delete racing our create aborted the whole write. `EPERM` is now treated as the same retryable contention as `EEXIST`; the retry budget still fails loud.
- **Cleanup**: the audit's K-4/K-5 (stale `before dispose` comment, squeezed line in the curator-report command), plus four misplaced audit-number labels in code comments (`review` "M-4", `curator` "M-5"/"M-4", `state-domain` "M-9") — the v4 audit verified those fixes as self-check items but did not flag the labels; they now read `v3-round self-check`.
- K-6 (feedback `record` io/path mismatch) and the feedback event-log redesign are deliberately NOT in this batch: K-6's fix would be thrown away by the rc.68 single-source-of-truth redesign that absorbs it.

## Unreleased — rc.66: hanging-limit closeout (feedback transactional counts + lock liveness probe)

The four documented hangover items analysis concluded two were real and solvable with existing platform interfaces; both now landed.

- **feedback counts are transactional (was P3-①)**: `EvolutionFeedback.record` no longer accumulates in memory and flushes an overwrite — each increment runs INSIDE the transact (locked read → +1 → write), the same pattern as memory/activity/state-json. The in-memory state is now a read snapshot (settling to the on-disk truth after each locked write) with a synchronous optimistic update so `score()`/`setQuality` stays immediately consistent; malformed sidecars are still never overwritten; the old `flush` merge path is retired (each record is already durable) and unload now awaits the record task chain (`waitIdle`). The cross-process same-target lost-increment limitation is gone — regression test: two instances recording the same skill concurrently end with the exact sum on disk.
- **write-lock liveness probe (was P3-②)**: the >5s stale-lock takeover now reads the holder pid from the lock file and probes it with `process.kill(pid, 0)` — a LIVE holder is never stolen (a slow writer keeps its lock across the 5s mark), a GONE pid is taken over. The only remaining best-effort surface is pid-reuse-level; the retry budget still fails loud (rc.65). Tests: live-holder refusal, gone-pid takeover, plus the updated stale test.
- **reviewProvider note (was audit misreport)**: the schemastery field is documented as optional-by-default, matching the interface and the "Omit to inherit" doc.

## Unreleased — rc.65: v3-audit P3 batch (dead code, data boundaries, interface/doc hardening)

- **Dead-code privatized (5, test-free)**: `EVOLUTION_SKILL_RANK`, `CAPABILITY_NAME_RE`, `scorePlan`, `collectReadSkillNames`, `COUNTER_SWEEP_THRESHOLD` lost their exports (module-private helpers). Test-consumed exports (`gateConsolidations`, `shouldCompletionReview`, `filterUnreadSkillOps`, `sweepDeadSessionEntries`, `graphDensity`) were verified against the audit's own rule and left exported — test infrastructure, not dead code.
- **Data boundaries**: `mutateUsage` / `recordMutation` / `updateSuppressedNames` now refuse to rewrite a malformed sidecar (the swallow→empty→persist path would destroy recoverable telemetry; regression test pins byte preservation); a failed-archive rollback also clears `archived_at` (the pre-transition record read as 'active' with a stale archive timestamp); `plan-validator` accepts `event_seq` only as a real integer or a numeric string — `Number(null)` no longer mints seq 0; `signals.ts` documents that `turnsSinceSkill` is an activity-weighted counter (field kept for on-disk compatibility).
- **Feedback merge reverted with rationale**: the additive cross-process merge was rejected after the restore+flush double-count surfaced — a stateless JSON sidecar cannot distinguish two processes incrementing the same target from one record seen twice. The union-by-target overwrite stays, with the limitation documented (an append-only event log is the real fix).
- **Interface/docs**: the stale untracked `evolution-io/src/index.d.ts` artifact (missing transact/isSymlink) is deleted; `tool-skill-manage`'s `ApprovalLike` mirror narrows `origin` to the real 2-value contract; capability submission states the required `stageForeground=true` explicitly; `approval.registerRunner` throws on a duplicate kind instead of silently shadowing the first runner.
- Local harness include gained the `evolution-plan-validator` spec tree (another CI-only coverage gap closed).

## Unreleased — rc.64: v3-audit P2 batch (all eleven findings)

- **Tool layer**: `action=edit` now gets the same authoring/strict gate as create/update (the enum alias bypassed it — regression test added); staged approval args carry BOTH the approval origin and the library origin, so replay of a delegated-subagent write keeps the `subagent` library semantic and the pinned guard stays consistent; the tool description now states the enforced pin rule precisely (foreground and delegated subagents may; never from a background review).
- **Orchestration**: `latestReport()` reads each report's own `startedAt` instead of sorting UUID filenames (regression test: name-"a" newer beats name-"z" older); the curator's usage fold persists through `mutateUsage` (transact-backed) so a concurrent usage bump between run start and save is not clobbered; the review subagent's skill reads are collected AFTER `await run.result` so read-before-write sees them.
- **IO/state**: the memory oversized-file read-guard runs BEFORE the transact entry (inside, the backend has already loaded the whole file — "never loaded" only holds pre-lock; the in-flight refusal path that rewrote full bytes verbatim is gone); `evolution-state-json` state mutations (review/curator/pending claim, release, resolve, save) run through `transactIo` with the process chain as the second layer — the JSON provider was the last cross-process unsynchronized RMW; `evolution-state-domain` catches only `DomainError('missing-key')` and lets closed/backend failures propagate instead of masquerading as "already resolved" (both providers' tryResolvePending semantics aligned).
- **Architecture**: the curator prompt no longer promises scheduled-task reference rewriting that the engine never performs (referenced skills are stated as fully protected); `evolution-learning-graph` binds its command registration to the fiber via `ctx.effect` so HMR/reload cannot duplicate `/evolution graph`.
- Local harness gained the two previously-uncovered spec trees (state-json/state-domain tests) and the `dsh-storage-json` alias — the local full-suite coverage now matches CI's include surface for these packages.

## Unreleased — rc.63: v3-audit round (M-1…M-7) — prompt-channel separation, candidate-pool integrity, guard hardening

All seven findings of AUDIT_REPORT_v3.md landed in one round.

- **M-1 (P1, nomination channel vs execution reality)**: `CURATOR_PROMPT` is now an explicit NOMINATOR view — the operative "Your toolset:" section (skill_manage actions the channel never had) is gone, replaced by a "no tools, single deliverable = the YAML block" statement plus a "Return ONLY the YAML block" hard output constraint. Two hard backstops make the boundary mechanical: the recommendation parser now filters `consolidations` by the candidate pool (symmetric with prunings), and `applyMutations` refuses (visibly, into report `failed`) any consolidation whose source is outside the exact pool this run presented to the model — a model narrating actions it did not take can never land a real tree change.
- **M-2 (P2, review persona vs subagent tool filter)**: new `SKILL_REVIEW_PLAN_PROMPT` / `COMBINED_REVIEW_PLAN_PROMPT` channel variants — the full review policy with a channel-limited deliverable note ("only the read-only `skill` tool; deliverable = the structured plan; never narrate actions you took"). The subagent path uses the plan variant (`reviewPrompt(kind, 'plan')`); the inject path keeps the operative wording. Prompt bundle bumped to `dsh-evolution@6` (both variants in the digest).
- **M-3 (P2, my rc.62 regression)**: prunings nominations are filtered back to the deterministic stale pool only — dedup members join the recommendation pool for CONSOLIDATION inputs, never for pruning; an active non-stale skill is not archivable via LLM nomination. Regression test: a dedup member nominated into `prunings` stays in the tree.
- **M-4 (P3)**: memory transact wrappers return `null` on failure-with-missing-file (DELETE is a no-op when nothing exists) instead of fabricating an empty MEMORY.md/USER.md. Test: failed batch on a missing file leaves it missing.
- **M-5 (P3)**: `verify-layout-sync.mjs` dropped hardcoded `--auto` machine paths — both layout paths are required arguments.
- **M-6 (P3)**: the layout-sync header now states the actual coverage (scripts/ trees only; `packages/` is the normalize-mirror release surface, `--deep` deferred).
- **M-7 (P3)**: `verify-platform-ranges.mjs` fails loud when `--our-scope @deepseek-ai` would make family/platform deps indistinguishable (`--family-prefixes` required); feedback `parseState` excludes array shapes; tool-skill-manage documents why `systemPrompt` uses the soft `ctx.get` probe (optional service) vs `approval`'s hard `inject` (deliberate per dependency strength).

## Unreleased — rc.62: engineering-debt closeout (P1 ①②③ + P2 ④⑤⑥)

All six items from the formalization-readiness inventory landed in one batch (no release formalization yet — the 0.1.0 move stays a separate operator decision).

- **P1-① memory files transactional**: `MemoryStore.add`/`applyBatch` now run their read-modify-write inside `transactIo` — the last RMW media outside the sidecar inventory. A locked-view drift check replaces the second read (`driftFromRaw`, same formula as `detectDrift`), and every failure/no-op returns the current content unchanged (IMPORTANT: `null` means DELETE in the transact contract — returning null on a no-op wiped the file, caught by the existing regression suite during this batch). Regression tests: concurrent batches through a locking backend keep both records, concurrent adds too.
- **P1-② layout-sync guard**: `verify-layout-sync.mjs` compares the dev-tree and mirror `scripts/` trees with line-ending normalization — any real drift fails loudly (D-7 class). The batch also discovered and fixed a LIVE drift: the mirror `build-lib.mjs` carried CRLF while dev was LF. Subprocess tests cover identical/modulo-endings, content drift, and one-sided files.
- **P1-③ sidecar inventory enforced**: the inventory test reads the actual sources and asserts every RMW sidecar (usage / mutations / suppressed / activity / feedback / memory media) implements its write through `transactIo` — the documented list is now a mechanically enforced door. The inventory itself caught `evolution-feedback`: it was in the documented list but still did a plain full overwrite; `flush` now merges with the disk state inside a transact (union by target, in-memory values win) instead of clobbering another process's records. The local vitest harness also gained the missing `evolution-feedback` include.
- **P2-④ Learn workflow**: `DSH_AUTHORING_STANDARDS` ends with the 4-step learn operation chain (gather sources → apply requirements → author exactly ONE SKILL.md → report name/category/summary), the Hermes `learn_prompt.py` flow adapted to DSH tools.
- **P2-⑤ merge heuristic input**: curator recommendation candidates now include near-duplicate group members (via `computeDedupGroups` on the tree) in addition to the deterministic scanner's stale names — the LLM sees overlap even when the deterministic side sees nothing. Fake-LLM test asserts both members appear in the recommendation prompt.
- **P2-⑥ installer local false alarms**: the three slow installer tests gained explicit 60s timeouts (they were eating the vitest 5s default on slow local pnpm cold starts while CI stayed green) — the local full suite is now green for the first time (222/222).

## Unreleased — rc.61: authoring wording precision + mount/restore contract for the 60-char catalog cap

- The `Authoring check` over-bar line now states the mechanism precisely instead of asserting deployment specifics: "exceeds the 60-char authoring bar (Hermes standard; the catalog truncates at the configured platform cap)" — true on both a 500-cap platform and one injected with 60 by the host bundle, and no longer claims truncation unconditionally (the P0 wording correction becomes deployment-neutral).
- New contract test for the "mount to inject, unmount to restore" semantics the host bundle already provides: `evolution-host/cordis.patch.yml` carries the `catalogDescriptionMaxLength: 60` as a TOP-LEVEL override of the base `tool-skill` row (never an inserted duplicate that would mount the tool twice). Installing the host bundle injects the 60-char cap automatically; removing it restores the platform default (500 on the validated anchors, or whatever a later profile overlay replaces it with). The test loads the real installed patch through the loader and asserts both the override value and the insert-free shape; a profile overlay may still replace the value later in the chain.
- (Background: the upstream dev HEAD has since changed the platform default to 60 itself — the bundle injection simply pins the Hermes behavior across platform versions.)

## Unreleased — rc.60: authoring feedback (P0) + curator scale adaptation + merge-chain auditability (P1)

The product-manager pass on the second-round review: the highest-value near-term items are the knowledge "first mile" (does a new skill's description get written well enough to route?) and making the merge channel — which has never fired — auditable and trusted.

- **P0 — authoring check in `skill_manage`**: new `authoringFeedback()` in core evaluates a frontmatter description against the 60-char bar WITHOUT changing platform validation semantics (the 60 rule was prompt-only while the implementation checked 1024 — the same standard-vs-implementation drift class as the F-1 README fix). `create`/`update` success messages now carry an `Authoring check:` block: `description N/60 characters` (or the exceeds-the-bar warning naming the Hermes authoring standard — the platform index cap stays a platform config, `tool-skill.catalogDescriptionMaxLength`, whose defaults differ across platform versions) plus the colon→double-quote rule when the description contains a colon. New `descriptionStrict` config (default **false** — advisory only) refuses an over-bar description up front when enabled. Tests cover the pure function (bar/colon/absent), the advisory message, and the strict refusal.
- **P1a — curator scale adaptation**: the CURATOR_PROMPT's "expect 10-25 clusters" (an original-library-size assumption) now scales with the library: a large collection may show 10-25 prefix clusters, a small one often has none, and a clean "nothing to consolidate" summary is the correct small-library outcome. Prompt bundle bumped to `dsh-evolution@5`.
- **P1b — merge-chain auditability + trust**: the end-to-end "LLM recommendation → gate → absorb → archive → report" chain was never covered — a fake-LLM test now proves the whole path (source archived, umbrella body absorbed, usage state folded, report recording the consolidation). The report shape gains `consolidated: CuratorConsolidation[]` (actual executed merges with from/into — previously only the raw nomination list was persisted, so executed merges were not auditable); `renderCuratorReportMarkdown` gains a line for it. Library-scale note: with a 2-skill library and `llmReview` off by default the channel stays dormant by design; it is now trusted when it fires.
- **P2 — already implemented, one fix**: `MEMORY_GUIDANCE` (Hermes dual-track for memory) turned out to already exist in `tool-memory` and to be mounted as a system-prompt section — the only warp was its `session_search` reference naming a Hermes-only tool; it now names the DSH session-query tool.

## Unreleased — rc.59: Hermes prompt alignment (operation/guidance parity, DSH-adapted)

The prompt bundle is rebuilt against the Hermes originals (`agent/background_review.py`, `agent/curator.py`, `agent/learn_prompt.py`) — the operational steps and instructions the model follows now mirror them structurally, with tool/platform differences DSH-adapted and DSH-only additions marked as such.

- `SKILL_REVIEW_PROMPT` rebuilt to the original's structure: "a pass that does nothing is a missed learning opportunity" posture, the expanded signal list (user frustration with concrete quoted signals is a FIRST-CLASS skill signal), the detailed 4-step preference order (loaded-skill first, support-file taxonomy with `references/`/`templates/`/`scripts/` per-kind guidance and the SKILL.md pointer rule, class-level naming ban for PR-number/error-string/session-artifact names), and user-preference embedding ("memory = who the user is and current state; skills = how to do this class of task for this user"). Pinned semantics keep the DSH guard (read-only within the background review pass — foreground and delegated-subagent writes stay allowed), NOT the Hermes "pin only blocks the curator" wording.
- `COMBINED_REVIEW_PROMPT` mirrors the same guidance; both prompts carry a new DSH addition — the two-tier deposition discipline (PATTERN → SKILL.md body / LOG → references/, body density IS reuse rate, 2-8 physical lines, prefer current-state pointer over history) — the operationalization of this repo's skill-library governance rules.
- `CURATOR_PROMPT` gains the original's load-bearing sections: umbrella-building posture ("not a passive audit"), the protected-directives detail (scheduled-task-referenced may be consolidated only because references get rewritten, never pruned), the never-used-skill 30-day + obsolete bar, package integrity (inspect the skill as a complete directory package; never flatten SKILL.md alone when support files exist; re-home or archive whole packages, never leave dangling relative links), narrow-name flagging, the real toolset list (`ask/consolidate/restore`), the "keep is legitimate only when already an umbrella" bar, iteration ("don't stop after 3 merges"), and the exact `consolidations`/`prunings` YAML block contract (every archive in exactly one list, block AFTER the human summary).
- `DSH_AUTHORING_STANDARDS` gains the colon-double-quote rule, the privacy motive for the literal `author: Hermes` (an environment-derived name is a leak — skills get shared), and the refined platforms guidance (OS-bound primitives ⇒ matching OS; fix cross-platform first).
- New `SKILLS_GUIDANCE` (Hermes `SKILLS_GUIDANCE` analogue): save skills after complex tasks (5+ tool calls) / tricky errors / non-trivial workflows, and patch outdated skills immediately ("skills that aren't maintained become liabilities"). Registered as a system-prompt section by `tool-skill-manage` exactly when it mounts — the DSH analogue of Hermes' `if "skill_manage" in agent.valid_tool_names` condition, so the guidance never names a tool the model lacks.
- Prompt bundle bumped to `dsh-evolution@4` (PROMPT_BUNDLE_ID/PROMPT_BUNDLE_VERSION). Alignment-contract tests: prompts.spec pins the load-bearing instruction points of every prompt (signal list, naming ban, pinned semantics, two-tier rule, package integrity, output block, colon-quote/privacy standards, guidance presence) and tool-skill-manage.spec pins the section mounting through a real systemPrompt assembly.

## Unreleased — rc.58: sidecar transactions (N-4) + preset collision guard (N-5) + CI purity (N-7) + docs batch (F-1/F-3/D-5)

- `evolution-activity` now folds each plan outcome inside `io.transact` (through `transactIo` and the evolution IO adapter): the read→fold→write runs under the backend's cross-process lock, so a second process sharing DSH_HOME can no longer interleave between the read and the write. The single-process chain stays as the second layer; the local `ActivityIoLike` interface is gone (core `EvolutionIoLike` is the one IO surface), and `parseActivityContent` is extracted as the pure parser. `EvolutionIo` (registry interface) now declares the optional `transact`/`isSymlink` probes, mirroring core — the node provider already implemented them at runtime; the type now matches. Regression tests: concurrent folds through a locked in-memory backend keep both records; the no-transact fallback path behaves as before. (N-4)
- The generated agent preset composition rejects row-id collisions: a delta row whose `- id:` also exists in the runtime `standard` composition would mount twice (and could shadow the platform row). `install-layered.mjs` parses both fragments (lightweight line parse, no YAML library) and fails loudly with the colliding ids; `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1` escapes with a warning for upstreams absorbing a delta row. `DSH_EVOLUTION_DELTA_PATH` lets tests inject a delta fragment. Regression tests cover both directions. (N-5)
- CI purity (N-7): the released-upstream compat job no longer overwrites the released tree's `tsconfig.base.json` with a mirror copy (the mirror base serves the pinned baseline and had actually drifted from the released tree — missing `dsh-attachment/types`, `dsh-authorization/types` and more path entries). It now injects ONLY the evolution alias path lines via `inject-evolution-paths.mjs` (single source: the mirror base's evolution lines) and fails loudly if the released tree already declares an evolution alias key. Regression tests cover injection and the loud conflict.
- Docs batch: README claims about the default review tool allowlist corrected (default is `[skill]`; `skill_search`/`skill_load` are opt-in where the platform exposes them), the static "45 files / 90 tests" gate numbers replaced with a CI-validated statement, the retired `dsh-evolution` facade row and `id` example removed from `packages/README.md`, and the dual-layout path note (dev tree `packages/evolution/scripts/` vs mirror `packages/scripts/`) added. `docs/release/decisions.md` records the second-round decisions: publish consumes only baseline artifacts (compat is a pure interception gate), the root-config policy (baseline overlays mirror configs, released injects aliases only), and the sidecar transaction list (usage / mutations / suppressed / activity / feedback — every new RMW sidecar must join it). (N-7 + F-1/F-3/D-5)

## Unreleased — rc.57: L0 data hygiene (N-3 timestamps + N-6 archive snapshots)

- `normalizeUsageRecord` now validates timestamps by `Date.parse` finiteness, not just `typeof string`: a corrupted sidecar carrying `"not-a-date"` / `"2026-13-99"` used to survive as Invalid Date and propagate NaN into the quality-score math and every lifecycle `daysSince` comparison. Garbage activity stamps now fall back to null (treated as "never"), and a garbage `created_at` anchors the age clock at now — matching the semantics the comment already claimed. `last_used_at` / `last_viewed_at` / `last_patched_at` / `archived_at` share the same guard. (N-3)
- Regression tests on all three consuming faces, failing on the pre-fix code (verified by temporarily reverting the guard): `usage.spec` pins the fallback values, `quality.spec` pins a finite score + boolean warn through `normalizeUsageRecord → computeQualityScores`, `curator.spec` pins a garbage-activity record still transitioning on its valid `created_at` instead of vanishing from every decision via NaN. (N-3)
- `SkillLibrary.archive` collision guard: two re-archives of one skill within the same second used to share one stamped destination and overwrite each other; the stamp probe now keeps appending a random suffix while the destination exists, mirroring the `snapshotAll` guard. Regression test archives the same skill three times in one second and asserts three distinct, complete destinations. (N-6)
- `retainSnapshots` comment now states the actual behavior (older snapshots removed outright) instead of claiming a `.backups history` fold that never existed. (N-6)

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
