---
name: session-handoff-briefing
description: Give a new session the context to continue the work.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Handoff, Documentation, Continuity, Projects]
    related_skills: [reference-aligned-writing, capability-claim-audit]
---

# Session Handoff Briefing

Author the one document that lets a fresh session (or a different agent, mode, or plane)
continue a long-running project without re-deriving it: why it exists, what its design
philosophy is, which trade-offs are already settled, and where every design document
lives. It does **not** replace the chronological ledger — it is the entry point *to* it,
and the two must stay separate files with a one-line cross-link. No dependencies.

## When to Use

- "我准备新开一个对话继续这个项目" / "换 PTC 模式继续" / a project resumes after a long gap.
- Handing a project to another agent, teammate, or machine.
- A designated "new sessions read this first" page has drifted from reality.

**Set a goal's round cap generously at creation, and expect a human turn to continue.** This user's
standing rule: *"今后在 goal 设置之初，可都按略微高估问题持续轮数的标准设置最大轮数"* — a cap that fits
the estimate exactly will stop mid-project, and resuming costs a human turn (see the cap mechanics below).
Prefer a cap several times the estimate; there is no penalty for headroom, only for an early stop.

**Report at milestones, and batch the simple steps.** This user's standing instruction: *"不需要频繁汇报进度，
简单任务可以一次性完成一组"* — a per-step progress report is noise. Do a WHOLE GROUP of simple items in one
execution (read → design → land → verify), then report once with the evidence; keep interim replies to a few
lines. Reserve a full report for a milestone (an item closed with its red proof, a gate reading, a release
check) or for a decision that needs the user.

**A long-running GOAL stalls on its round cap, and the stall looks like a block.** When a goal hits
`maxGoalRounds` the runtime sets `phase=blocked` and `activation=disarmed` on its own — nothing failed, but
a continuation turn cannot raise the cap: `update_goal` `edit`/`resume` both **require a direct human turn**
and refuse on an automatic continuation ("this goal operation requires a direct human turn on a top-level
agent"). On the next human message ("继续" is enough) run **`edit` with the same objective and a larger
`max_goal_rounds` FIRST, then `resume`** — `edit` alone leaves `phase=blocked`/`disarmed`; `resume` clears
both and bumps the revision. Verify with `get_goal` and report the new `rounds/max` in the handoff.
- Before a mode switch that changes what the model can see (see Pitfalls).

## Prerequisites

- Read access to the project's authoritative pages: the invariants/criteria file, the
  architecture decision record, the implementation plan, and whatever plays the role of
  the running ledger.
- The publish boundary, if the project ships: `package.json` `files`, or the equivalent
  whitelist.

## How to Run

One file, written where the next reader already looks, linked from the page that
currently claims to be the entry point. Then verify it with the file-aware read tool and
confirm the shipped artifact hash is unchanged.

**Do not close by asking the owner to review it.** Verify it yourself first, then report
what you checked claim by claim. This user delegates exactly that way — *"我不需要看，你再
稍微检查一下是否有误即可"* — so a handover that ends with "please take a look" hands back
the very work you were asked to do. Keep questions for choices that are genuinely his
(scope, external actions), never for proofreading you can do yourself.

## Quick Reference

| Section | Answers |
| --- | --- |
| coordinates | name, root, current version, gate readings, form |
| why it exists | the concrete gap in the platform it fills, with `file:line` |
| positioning | what it deliberately is not, and the reason for each exclusion |
| philosophy | first principle, the axes, the invariant + criterion list |
| settled trade-offs | decided, with the reason — and "don't re-litigate" |
| history | the pivotal narrowing, and any near-miss the team paid for |
| doc map | which file owns what, what is frozen history, what is prior art |
| how to work | the standing order, the hard rules, the reporting convention |
| open items | what is still unverified, with the procedure and the rollback |
| local traps | environment facts that silently corrupt readings |

## Procedure

1. **Separate the entry briefing from the running ledger.** A long project accumulates a
   chronological log (round records, resume cards). The new session needs the briefing.
   Keeping them one file means the briefing is buried under thousands of lines.
2. **Harvest every constant from its owning page — never from memory.** Invariants,
   criteria, acceptance tests and the document map each have an authoritative home. Open
   it and quote. A briefing that misstates an invariant is worse than no briefing, because
   the next session will quote it back at you and defend it.
3. **Repair the entry pointer.** Find whichever file claims "new sessions read this first"
   and check whether its first screen is still true. Measured trap: the designated page
   opened with a snapshot from weeks earlier (`G2 in progress`, `74/74 tests`) while the
   truth was `16/16 closed`, `277/277` — a session reading only that gets a thoroughly
   wrong picture. Label the stale block historical and point at the authorities rather
   than restating the numbers.
4. **Do not create a third copy of the state.** Point at the two authorities (the ledger's
   closure table, plus the artifact's own status). Parallel lists drift within a round;
   this user's standing rule is one list only.
5. **Check the ship boundary before editing any document.** If the project publishes a
   whitelist, a doc inside it is *shipped bytes*: editing it after a release reopens the
   release obligation. Put internal briefings outside the whitelist, and prove it by
   re-packing and comparing the artifact hash with the previous one.
6. **Write the "how to speak here" section.** The new session needs: which paths are
   frozen history (never read old counts as current), which decisions are settled and what
   evidence is required to reopen one, the evidence-grading convention, and the reporting
   convention (report the scope you changed — never "synced").
7. **Include the mode-specific section when the mode changes visibility.** If the next
   session runs in a programmatic-tool-calling mode, the model sees the tool's canonical
   `value`, not its rendered text, and `meta` does not reach it — so say explicitly which
   field to judge a tool by. Getting this wrong is invisible until results look thin.
8. **Sweep the reference-type claims before handing it over.** Paths, line numbers, file
   names and counts are the claims a reader *follows and trusts*; a wrong line number or a
   missing file costs them a silent wrong turn. Open every cited path, resolve every
   `file:line`, and check the document map against a directory listing — not against your
   memory of what the project contains. Measured in one pass: a line range off by one
   (`:11-14` where `:11-13` was meant), and three files missing from the map, two of them
   **layered spec pages whose numbers had drifted** (a page still describing "three
   backends" long after the stubs were deleted). Two rules fall out: mark a drifted layer
   as history *in the map itself*, and never list a history artifact in the "must stay in
   sync" table.
9. **When re-counting a documented number, find the document's counting authority first.**
   A number in a spec is usually owned by a gate or a generator, and the spec may say so
   outright ("count from the gate's output"). Bound your range to the section's own
   boundaries as well — an overshooting range silently swallows the next table. Measured:
   two attempts at one count gave 18 and then 49; the document said 40 and was right both
   times, and it had already recorded that the number had been miscopied twice. **Never
   "correct" a document on the strength of your first count** — a gap report is a claim
   about your instrument, not about the world.
10. **Reconcile the briefing against the tree before anyone reads it as current state.** A briefing is a snapshot; the fastest way for it to become wrong is for it to embed live readings. Measured in reading a briefing this session: its smoke/acceptance page carried a defect snapshot ("`index.js:147` still puts the whole variable index into `section()` and never filters by session") **plus** the gate reading `268/268 · 12/12`, while the tree had `index.js:247` registering `context()` with a session filter and the gates read `277/277 · 14/14`. The fix had landed **in the same commit that wrote the record** — so the page disagreed with itself, and both numbers were wrong.
    Two rules fall out, and they belong in the briefing itself:
    - **A recorded defect is a timestamp, not a status.** Keep the record (it is the evidence the fix was earned), but add the back-mark: which commit closed it, what the current line is, and the live reading. A stale defect snapshot is the one that costs a reader a wrong turn — it either sends them to re-fix something fixed, or (worse) it gets quoted as current state.
    - **Embedded gate readings are perishable.** Either re-run them at handover and date the reading, or point at the command instead of the number ("run `node --test`; it was 277/277 on 10-13").
11. **Label quotations honestly.** If a section says "verbatim", it must be word for word.
    Dropping a parenthetical turns it into a condensation wearing a verbatim label, which
    is worse than an open condensation because the next reader quotes it as authority.
    Either restore the original wording or drop the label.

## When a long autonomous run hits its capacity ceiling (2026-10-13)

- **Stop before starting the next slice, not after.** If the remaining item is a change that must land in one piece (it touches a frozen interface, several assembly points, and needs its own bidirectional red proofs), beginning it with little headroom is how you leave a half-built slice on a frozen surface. Prefer: finish the current slice, verify green, then hand off.
- **A capacity ceiling is not a reason to idle.** While the condition persists, keep banking *safe* increments: settle an open design question and file the decision, align stale documented readings, or withdraw a gate that cannot be green (recording the finding and restoring green) — all of which reduce the next session's work without touching risky surfaces.
- **Mark the run blocked only after the same condition has persisted across ≥3 rounds, and make the reason self-sufficient**: the concrete condition, its duration, what was completed while it persisted, the checkpoint readings (`HEAD`, tree clean, gate/test counts), and the **resume entry point** — which files to read and the ordered list of what to do next. A blocked reason that says only "context is full" costs the next session an hour of re-derivation.

## Pitfalls
- **A run that ends blocked on a human-only step should ship an *authorization dossier*, not a status paragraph.** When the remaining clause needs a person (2FA tap, a decision, an approval), consolidate into one file they can act from: per-item acceptance evidence with **what each red proof was**, the live gate readings quoted **byte-identical to the tools' own output** (a paraphrased count reads as "the numbers don't match" to the next verifier), the artifact inventory, the exact copy-pasteable commands that unblock it, and an explicit "still not done" section listing the gaps you chose not to close with their reasons. Then state the blocker once with its persisted duration and stop looping — repeating the same status each round is cost without progress.

- **A briefing that duplicates the ledger becomes a second source of truth** and starts
  contradicting it within one round.
- **Do not put the briefing in the published whitelist "because the README lives there"** —
  that couples a documentation edit to a release.
- **Never summarize from the conversation's own narration.** Open the files. The standing
  requirement is evidence per claim; unsourced inference is rejected on sight.
- **Dense plus pointers beats exhaustive.** The reader consumes one page and then follows
  paths; a briefing that restates everything is a second ledger.
- **A wrong line count can come from the reader, not the file.** Measured: a shell
  `Get-Content` on a UTF-8 markdown file returned mojibake *and* reported 176 lines for a
  263-line file. Both the glyphs and the count were unreliable. Re-read head and tail with
  the file-aware tool before declaring the document complete — and treat any mojibake as a
  reader problem first.

## Verification

Every current-state statement in the file (a defect status, a gate reading, a version, a file's wiring) is either backed by a tree read **from the session that wrote the file** or dated and attributed to the record that produced it — never carried over unmarked from an earlier doc. A fresh reader can state, without opening anything else: (a) why the project exists,
(b) its invariants and criteria *and where they live*, (c) which trade-offs are settled,
(d) what is still open and what it would take to close it. The file has been read back at
both ends by the file-aware tool, and — if the project ships — the artifact hash is
unchanged by the documentation commit.
