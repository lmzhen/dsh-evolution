---
name: codebase-defect-audit
description: Audit a codebase read-only and grade findings P0-P2.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Code Audit, Defects, Reporting, Review]
    related_skills: [platform-plugin-port-verification, capability-replication-audit, capability-claim-audit]
---

# Codebase Defect Audit

Sweep a whole codebase read-only, grade what you find on a stated severity rubric,
and deliver one report document that another engineer can act on without
re-deriving anything. It does **not** fix anything: the deliverable is the report. When the ask continues
into remediation ("design the landing plan", "fix them in batches", "check this plan
against the real code"), the second half applies — see
`references/remediation-plan-design.md` for the design and
`references/remediation-execution.md` for landing the batches (gate pair, plan/apply shape,
independent-review closure, long-run hygiene).
Recurring defect classes and measured baselines live in
`references/agent-plugin-defect-classes.md`; when ONE discovered defect raises the question "does this class exist
elsewhere?", run the same-class sweep of `references/lifecycle-debt-sweep.md` — it also carries the four checks that
answer "did the previous audit MISS this?" without counting findings.
When the ask is to integrate every finding into one framework (first principles, systems thinking, precise locations), including the over-fit trap and how to read a corpus larger than the context: `references/finding-framework-synthesis.md`.

For **running** a lane batch - the per-lane prompt contract, write-as-you-go so a crash costs the tail not the run, and the adversarial spot checks that decide which findings may be published as confirmed - see `references/lane-batch-operations.md`.

When the audit fans out into many lanes and must end in a framework document, the synthesis
layer (per-source A/B/C extraction, id-level coverage diff, self-audit of the audit's own
report set) is `references/multi-track-audit-synthesis.md`, and the reusable coverage check is
`scripts/doc-id-coverage-check.mjs`.

## When to Use

- "审计这个项目的全量代码，找出 bug / 隐患 / 死代码 / 技术债" (typically with a severity floor, e.g. P0–P2 only).
- A follow-up axis is requested on the same target ("再看时间/空间复杂度", "再看并发", "再看权限") — append to the **same** report, same rubric.
- Before a release: an independent, evidence-backed pass over a codebase you did not write.
- A single module looks suspicious and you want the surrounding surface checked with it.
- The docs themselves are the target ("文档里有没有过时/失实/未覆盖的内容", "安装说明对不对") — a
  documentation sweep is its own lane set: `references/documentation-audit.md`.
- "Did this capability actually fire in the evaluation runs, and how much work was it doing?" — read the
  per-run config and the session transcripts, not the summary JSON: `references/eval-run-history-evidence.md`.

## Prerequisites

- The target tree is readable and (ideally) `git status` is clean, so "the audit touched nothing" is provable at the end.
- A runnable toolchain for that tree (typecheck/tests, or at least `node --import tsx`-style direct imports) — claims you can measure should be measured here.
- For a plugin/extension target: the **installed** host platform (bundled code + docs) as the truth baseline, not upstream's source tree.
- A place for probe scripts **outside** the audited repo (temp dir), deleted when done.

## How to Run

1. Enumerate the surface first (every source file + line count) and split it into cohesive lanes of ~2–3k lines.
2. Write the severity rubric down before reading (P0/P1/P2 with trigger conditions).
3. Fan out one read-only subagent per lane with a single shared brief (see Procedure step 3).
4. Do the parent's own sweep in parallel: mechanical scans, manifest↔code diffs, real-data measurements.
5. Re-verify every P0/P1 at the cited line yourself; adjust the lane's severity and say so.
6. Measure every performance claim at the real scale; publish the dismissed measurements too.
7. Write one report: rubric → summary + top-N → items by severity → dismissed → unverified → coverage.

## Quick Reference

| Need | Method |
|---|---|
| Surface inventory | a node walker printing `lines  path` sorted desc (glob tools truncate and time out on big trees) |
| Shared lane brief | read-only mandate + rubric + fixed item format + evidence labels + coverage statement + do-not-report list |
| Recurring defect classes | state-outlives-artifact, read-failure-as-empty, swallowed write failure, two owners for one responsibility, unbounded growth × per-turn full rewrite (see references) |
| Manifest↔code consistency | diff the declared config keys / tool names / hook names / contracts against what the code actually reads and registers |
| Performance claim | import the **real** module by absolute `file:///` URL from a script in the temp dir and time it at production scale |
| Real-data measurement | read the live sidecar/artifacts of a working instance (sizes, counts, mtimes) instead of synthesising |
| Plugin deployment on an offline host | plugin roots are `<configDir>/extensions` (configDir = `$OPENCLAW_STATE_DIR` → `dirname($OPENCLAW_CONFIG_PATH)` → `~/.openclaw`), so a copy parked in `~/.openclaw/extensions` can be inert; transport, completeness and the on-box diagnostic order: `references/plugin-deployment-ops.md` |
| Long lane | send a wrap-up instruction: deadline + "only verified items" + explicit exclusion list |
| Plan self-check | list the plan's load-bearing assumptions, verify each at the **construction site** in both codebases, classify correction / contradiction / confirmed |
| Artifact enumeration | one read-only subagent inventorying every read/write/delete/rename/cp site per artifact (report dirs, marker files, backups included) — owner tables written from memory are always short |
| Test feasibility | check the harness's import graph and dependency resolution before designing the test |
| Gate/CI-script surface | four mechanical sweeps before reading bodies: (1) reference-count every script against the manifest / CI config / contributing table / other code to find orphans, (2) census which generators support a drift check and who invokes it, (3) matrix of CI invocations vs strict/warn capability (a gate listed in CI that only fails under a flag CI omits cannot go red), (4) trace every exemption register to its expiry evaluator (a register keyed by one axis name while the escalator is called with another never fires). Validate any shared comment/string lexer against a real parser (e.g. TypeScript createScanner) on the whole corpus before trusting the gates built on it. |
| Live spot check | run the change on an isolated host instance and read the host's own log; the playbook (real port discovery, shell-free CLI invocation, permanent per-hook diagnostics) is in `references/live-instance-spot-check.md` |
| Upgrade path without the old build | fabricate the legacy record through the host CLI (old name, no ownership marker, payload in the legacy field, disabled) -> restart -> adoption log + row shape + a counter-example that must stay untouched (`references/live-instance-spot-check.md` §8) |
| Config-gated projection | write the gate into every config copy the host and CLI read, observe both the CLI's filtered list and the model's own prompt block, then restore and re-verify (§9) |
| "Does hook X fire for Y?" | read the dispatch helper's callers; with no registered hook nothing fires, so a negative from the source is the result (§10) |
| Landing a batch | gate pair (tsc + behavior suite) → commit → in-place status note on the audit item; move and behavior steps in separate commits (`references/remediation-execution.md`) |
| Auditing documentation | one lane per document family; enumerate every checkable fact (commands, keys, paths, counts, line refs) and verify against code/platform — doc-to-doc agreement is not evidence (`references/documentation-audit.md`) |
| Id-level coverage proof | extract every id from the ledger/index document and diff it against the framework document (`scripts/doc-id-coverage-check.mjs`) — 「all items covered」 is a mechanical 0-gap diff, never a prose claim |
| Per-source extraction shape | for each source document write three blocks: **A** fixtures (the action to run + a `current → after fix` assertion), **B** already-verified baselines (「do not re-open」), **C** unread surfaces with substitute criteria plus open decisions |
| Self-audit of your own report set | after the last write: id contiguity and uniqueness, cross-document reference validity, mechanically countable sentences, section numbering without gaps — self-produced docs rot exactly like code |
| Gate/guard repair | rule registry carries `{incident, canonicalForm, vacuity, sample}`; every gate change needs a live bite test (break → non-zero exit → restore → exit 0); unclosable checks become registered debt with an expiry; generated artifacts get form checks plus a parse when a parser resolves — `references/guard-and-gate-repair.md` |
| Plan systematicity / self-consistency | treat the integrated plan as a system: traceability diff, implementation-batch uniqueness, decision gates, per-batch exit criteria, one state vocabulary, in-doc do-not-do register — eight checks, the S/C finding classes and the write-back procedure are in `references/plan-systems-review.md` |

## Procedure

1. **Inventory before reading.** A file you did not enumerate cannot be audited. Print counts, sort descending, and use that list to size lanes.
2. **Fix the rubric in the report's first section.** Suggested: **P0** = normal path reproduces silent data loss/overwrite, behaviour contradicting the documented switch, crash, or boundary failure; **P1** = needs a precondition (concurrency, multi-process, platform edge, multi-workspace, specific input) but then yields data inconsistency, deterministic feature failure, or irreversible side effects; **P1 also covers availability-per-plane** (added 0.18.1, S5): the same command works on one client/plane and is cut off on the other by a shorter-lived owner (measured: a desktop shell wall at ~305 s vs a web plane surviving >=950 s). Verdict is a **cross-plane comparison** of one command, and it is a **trigger, never a routine acceptance** — a >5-minute cross-plane long run is a ritual users veto. **P2** = dead code, multiple owners for one responsibility, uncovered critical path, or steady bleed. State explicitly that style, naming, "missing tests" as such, and dependency/environment issues are out of scope.
3. **Dispatch lanes with one identical brief** containing: (a) read-only mandate and "do not touch the repo"; (b) the rubric; (c) the exact per-item format — severity / position `path:line` / symptom+mechanism / impact+trigger / evidence (label **确定** / **实测** / **推断**+判定法) / one-line fix direction; (d) "no trigger condition ⇒ don't report it"; (e) a required coverage statement (read verbatim / only grepped / skipped and why); (f) for lane 2+, the list of ids already reported so they don't re-report.
4. **Do the parent's own sweep while lanes run.** Mechanical scans (casts, non-null assertions, empty catches, unguarded `JSON.parse`, `process.exit`, id-from-timestamp, sync IO in hot paths) plus structural diffs: declared config keys ↔ keys the code reads, registered names ↔ declared contracts, hook/tool names ↔ platform-valid names. Then take real measurements from a live instance's artifacts. Add the read-code question that catches lifetime debt without any long run: **whose lifetime does this work borrow?** — every external cancel source (`signal`/`request`/`fiber`/subagent/client connection) an execution body consumes names an owner that can expire first.
5. **Re-verify, do not relay.** For every P0/P1 open the cited lines and confirm; downgrade or drop what does not hold, and correct lanes that under-claimed. A subagent's severity is a proposal, not a finding.
6. **Measure before grading performance or complexity.** Micro-benchmark the hot function with production-scale inputs, then state both the curve and the constant. Publish a "measured and dismissed" table so the same suspicion is not re-raised next time.
7. **Deduplicate and renumber once.** Same root with a new facet ⇒ fold into the existing id and cross-reference. Afterwards make the summary counts equal the union of the section headings.
8. **Follow-up axes append, never fork.** A second pass (time/space, concurrency, security) becomes a new numbered section in the same file, keeping the rubric and the id sequence. New report files per axis violate the reader's expectation of one home.
9. **Close the loop on hygiene.** Delete probe scripts, run `git status`, and state that only the report file changed.
10. **If the ask continues into remediation, design against the real source.** Fold the findings into a handful of root causes, give each mechanism an API shape and an owner, map every id to a mechanism and a batch, then run the **self-check pass**: enumerate the plan's load-bearing assumptions and verify each at its source on both sides (target code + installed host code), classifying results as correction / internal contradiction / confirmed. Route each fix through the mechanism that will still exist after the last batch — a throwaway patch is the debt being removed. Details, the assumption-failure table and the executable invariants: `references/remediation-plan-design.md`.
11. **Close a multi-lane audit with a coverage diff and a self-audit.** Extract every source document's residue into the A/B/C shape above, and re-run the id-level diff after each document. Then audit your own deliverables with the same rigour you applied to the target: ids contiguous and unique, cross-references still resolving (a renamed id such as `P1-2` → `1-2` breaks silently across the set), countable sentences still true (`8 files` when there are now 13), section numbers without holes. Write each correction back into the body — no errata section, no 「see correction above」.

## Pitfalls

- **A lane's "P0" is frequently inflated.** Quadratic loops measured 2–3 ms at the real library size in this session; a "security gate bypass" measured only after truncation, not on the hot path. Grade after measuring.
- **Line counts and greps can lie about file integrity.** A `Get-Content`/byte-count mismatch made a document look truncated; a node-side `split(/\r?\n/)` settled it. Verify with the same reader you will quote.
- **A document can violate its own rule, and that is the highest-yield class.** Check each normative sentence against the artifact it governs: the registry table against the guard file's checks, the "do not hard-code counts" rule against the counts written in the same list. Fix = satisfy the rule (add rows / state coverage classes), never weaken it.
- **A dated record is fixed by an errata line, not by an edit.** Reconcile it mechanically (cited SHAs resolve, tags point where the text says, cited files/symbols exist), state what later work the section does not cover, and leave its historical numbers alone. When two documents in one repo disagree on a count and git history cannot settle it, declare the discrepancy instead of picking a side.
- **Inventory a doc gate's coverage from its own source, not from memory.** Extract every doc path it mentions and diff against the doc set; the unguarded file is invisible because an absent check is silent. Guard it with a property it already maintains (citations resolve, numbering consecutive), not with invented claims.
- **A brand-new check that fails everywhere is usually broken, not vindicated.** Shelling out without pinning the working directory makes every call land in the catch branch; the mirror failure is a vacuous pass when the extraction regex stops matching — assert the work list is non-empty.
- **`restructure` only moves `##` sections of SKILL.md itself; support files under `references/` are not splittable that way** (the call reports "no <heading> heading in the body"). When `references/documentation-audit.md` grows past comfortable size, split it by hand with `write_file` in the same call — attempts to restructure a support file just burn a round.
- **Before declaring a doc-vs-code pass complete, ask what it is complete *relative to*.** A sweep may cover every document yet only the code side: host/platform claims quoted from a packaged install are a second surface, and they are checkable — hash-stamped bundle names, the cited line's content, and whether the identifier is the definition or a use site. Name the residual surface in the closing message instead of implying the whole set is verified.
- **A run's own config decides what its numbers mean.** Before quoting a count or a rate from an evaluation run, diff the run's config against the product defaults; a batch that looked like proof of an automatic path turned out to have three threshold overrides. And when re-running one task by hand, go through a dedicated profile (the same entry point the harness used) rather than wiring state dirs by hand — manual wiring yields misleading `gateway already running (dead pid)` and `agent not in roster` errors.
- **An index must be reachable, not merely complete.** If the docs hub links everything but nothing links to the hub, readers entering from the README never find the maintenance set; check both directions and gate it.
- **Two language editions drift semantically, not structurally.** Compare what version-bearing headings announce, not heading counts: an English Upgrading-to-X heading against a Chinese 从 X-1 升到 X heading is the defect.
- **Verify by running the tool, not by reading the prose.** For any claim about the host platform, `--help`, `config schema` and a grep of the host's own bundles settle it in one step; the enumeration of claim types → artifacts is `references/docs-vs-code-inventory.md`.
- **A failing probe may be your harness, not the target.** A search returning 0 hits was caused by the tool's own "exclude current session" parameter, not a defect. Check the invocation before writing an item.
- **One condition branch in a dependency is not behaviour.** State what would settle it (a live run, a probe) and label it 推断 with a judgement method.
- **A guard change is not done until you have watched it fail.** Break the input on purpose, read the non-zero exit and the new message, restore, and re-run to green — and check the guard's entry condition first, or the fixture never reaches the judgement and the bite test passes vacuously (`references/guard-and-gate-repair.md`).
- **Don't wait indefinitely on lanes.** Send a wrap-up instruction with a deadline and the exclusion list; ask for verified items plus one "未覆盖" line. Then integrate what arrived.
- **Don't count the same root twice.** Growth, time, and correctness faces of one mechanism belong in one item with a cross-reference.
- **Coverage statements are part of the deliverable.** Without them a reader cannot tell "checked and clean" from "never looked".
- **Declarations are not the contract.** The host's type may be wider (an optional field the dispatcher never passes) or narrower (a field present at runtime but missing from the type) than reality. Settle it at the object-construction site; when runtime is richer than the type, read the field shape-defensively.
- **A unification can regress the best copy.** Before routing N implementations through one primitive, check whether one of them already does it right (a lock-internal re-read + keyed merge); a per-call rewrite would have made it worse.
- **Check the fix is possible at all**: the target path is writable by the tool you route it through, and a promised format/feature is exercised by real artifacts. A promise nothing uses is over-development; normalising a third party's file is churn plus risk.
- **A cleanup inside an uncalled function is not a cleanup.** Reachability, not existence, decides whether growth is bounded.
- **Measure the defect's mechanism before designing its fix.** The stated mechanism is a hypothesis. Here the audit said an append of foreign content was silently dropped by the next write; the regression test written from that judgement method failed, and re-measuring showed the append actually survived (it was absorbed into an entry) while the real irreversible path was a size guard returning null and the caller then writing one entry over the whole file. Implementing the fix first would have produced a correct-looking patch for the wrong mechanism.
- **A live observation is not a defect until it is attributed.** When the running instance disagrees with the design, instrument the boundary (log the raw input, the resolution source and the resolved value, once per key) before grading it. Here the plugin turned out to be faithfully using what the platform passed - the mismatch was on the platform's side - so the row was re-graded and the remaining question recorded with its judgement method instead of becoming a false P0.
- **Read every delivered lane report in full before synthesising.** Relayed titles and summaries hide whole sections (a heading with no body, a mechanism claim the same report later refutes); the synthesis pass is where those turn up.
- **A reported total line count can be wrong.** A reader reported 131 lines for a 187-line document, so the file looked finished while its §7 was still unread. Get the true extent from an outline grep (`^#{1,4} ` heading lines) and read by explicit offset/limit ranges; never stop at the reported total.
- **An id gap is a defect in the deliverable, not a cosmetic detail.** One missing `A42` in a 105-row fixture ledger means the ledger and its references disagree. Fill the gap with a real item; renumbering the tail cascades into every cross-reference (inline 「see A75」 breaks silently). Re-verify contiguity and uniqueness programmatically afterwards.
- **Never read CJK documents through the shell.** A `Get-Content -Raw` dump rendered Chinese as mojibake (console codepage), which invites a false 「the file is corrupted」 conclusion. Use the file-read/grep tools for content and the shell only for sizes, counts and git state.
- **Writing dense documents from a program has escaping rules.** In the program string: no ASCII double quotes inside Chinese prose (use 「」 — one unbalanced quote breaks the parse), and a lone backslash silently disappears (`\.` written into prose arrives as `.`), so quote a regex only inside a code span or drop it.

## Verification

- Every item carries a `path:line` a reader can open, and a trigger condition.
- Every performance/complexity claim carries a number **and** the scale it was measured at; dismissed suspicions are listed.
- Summary counts equal the union of section headings; merged items are cross-referenced, not silently dropped.
- The report ends with coverage + unverified sections, and `git status` shows only the report file as changed.
