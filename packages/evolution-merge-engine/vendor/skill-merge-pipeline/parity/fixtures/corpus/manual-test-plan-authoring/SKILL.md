---
name: manual-test-plan-authoring
description: Write operator test steps for a live system.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Testing, Documentation, Operations, Usability]
    related_skills: [codebase-defect-audit, codebase-inventory-survey, live-instance-spot-check]
---

# Manual Test Plan Authoring

Write a step-by-step manual test procedure that a human operator (or a non-specialist tester) executes against a
running system to prove each功能项 is *present and does something*, not whether the output is good.
It does NOT grade defects (`codebase-defect-audit`) and does NOT survey what exists (`codebase-inventory-survey`).
The deliverable is a procedure document whose every step is copy-pasteable in the operator's own environment.

## When to Use

- "把每一项功能生成一套手动测试方案" / "给测试同学一份可照做的操作手册"
- A verification report or acceptance sheet needs a reproducible "how to observe this" section per capability
- The test surface is constrained (chat only, no settings UI, air-gapped box) and the steps must fit it
- Any request where the reader runs the steps, not the agent

## Prerequisites

- The code that implements the features (this is where the *reachable surface* comes from).
- The exact environment the steps will run in: which client, which UI, whether config/CLI exists at all.
- Read-only access to a live instance of that environment when you can get it — one probe beats three guesses.

## Procedure

1. **Derive the reachable surface from code before writing a single step.** Enumerate, per feature:
   the chat/CLI entry point, the keys it actually accepts, and what is only reachable through a
   settings UI or a config file. Steps that name an unreachable surface are worse than missing steps:
   the operator gets stuck and reports a false defect against the product.
2. **Budget the granularity to evidence, not to features.** One scenario per feature group, 3–6 steps each,
   each step being {what to send, what to expect}. If a step's observation needs a file the operator cannot open,
   replace it with a chat read ("读一下 <path>") or a status command.
3. **Write expectations as the artifact's own words** (tool receipt text, command reply, file field), quoted
   verbatim where it matters; keep them short. Say "回执文案以实际为准，语义一致即算命中" once instead of
   guessing every string.
4. **Run every command you ship, in the target environment's own shell, before shipping it.** Capture the real
   output; then write the expectation next to the command. Two traps that only show up when you run it:
   the tool silently operates on a *different* instance/profile unless you set the environment variables the
   deployment uses, and a flag may be documented but require an extra switch to actually print.
5. **List the unreachable items explicitly as 未测** with (a) why they are unreachable here, (b) the exact
   configuration or permission that would make them testable, (c) any partial substitute reading that the
   reachable steps still give. Never fold them into the pass column.
6. **Give one consolidated document.** Operators execute from one file; split only if the reader set differs.
   If you already split it, merge it back and delete the split set (leave no two copies to diverge).

## Writing the items the way the user rewrites them (learned from a diff of their edits)

Hand a draft back and the user will rewrite it — then the diff is the specification. Their edits all
pointed the same way:

| Their edit | What it changes |
|---|---|
| deleted the bold lead sentence of an item | the item became one flowing sentence: no label line, no caption |
| replaced an abstraction with a behaviour (“提醒回顾沉淀” → “可配置为由独立子智能体运行给出建议，或将回顾的提示词注入主对话”) | say *what happens* and *who did it*, not what the feature is called |
| replaced an internal name with a plain one (“独立审查运行” → “独立子智能体”) | the reader's vocabulary, not the module's |
| kept every number | thresholds are why someone reads the list; never drop them |
| stated the consequence instead of a negation (“不是自动搬家” → “需先自行判断把内容搬进 references/，腾出空间后重试”) | describe the action the reader takes; contrasts explain, actions instruct |
| rewrote a mechanism as a run of behaviour | a list item is a sequence of events, not a system description |

Checklist before handing over a feature list:

1. **No bold labels.** If an item needs a bolded title, it is two items or a paragraph.
2. **Subject = actor.** “agent 要再写，就得先…” beats “本模块返回错误”.
3. **One sentence per fact, and the fact is an action.** Cut anything that only explains why the design is that way.
4. **Keep thresholds, file names and commands** — the reader acts on those; cut the reasoning around them.
5. **Doubtful wording gets a question, not a rewrite.** The user marked two items 没说明白 / 意义不明 rather than fixing them — unanswered vagueness in a draft signals the writer did not know the mechanism.
6. **If two items are not end-user-visible, fold them into the items they serve** and renumber. The user cut two of twelve for exactly this reason.

## Cutting the plan to what the tester uses (the user will do it for you)

Operators ask for less, not more: a 250-line plan becomes 34 lines after the person who will run it
reads it once. Ship the shape they land on:

- **Keep**: section titles, step ids, the action line per step, the expectation line per step, the values a
  tester must carry back (a baseline count, a record id).
- **Cut**: title and purpose paragraph, how-to-read notes, decision-principle paragraphs, memos to remember
  receipts, and the code fences around the whole thing (a fence makes it read as a document; bare lines read
  as a checklist to execute).
- **Preserve as a precondition, not as prose**, anything a step depends on: if a step behaves differently under
  a setting, say it in the step's expectation ("under 直接写 this succeeds without a prompt"), not in a preamble
  note that becomes stale when a later scenario is deleted.
- **Sidestep the coverage argument**: verify representative paths without claiming coverage, rather than
  padding the plan to touch every surface. Padding is what gets deleted next round.

## Re-verifying a plan the user has edited

Never inherit your own copy: read the file from disk (it changed), then run these checks — each one has
already produced a real defect on a heavily hand-trimmed plan:

1. **Dead cross-references.** A note that says "the switch behaviour is recorded in scenario D" survives the
   deletion of scenario D. Grep every scenario id mentioned outside its own block.
2. **Stale titles.** Section headings keep naming steps the user deleted ("new/create/rewrite/delete" over a
   plan that only creates and reads). A heading that promises steps that are not there is worse than no heading.
3. **Expectations that contradict an earlier step's state.** A step that sets a mode and the next step's
   expectation written for the previous mode — the tester cannot judge pass or fail. Re-derive each expectation
   from the state established by the step before it.
4. **Leftover artifacts of editing**: a trailing fragment line, blank lines inside fenced blocks, a count word
   that no longer matches the list under it ("two facts" with one item left).
5. **A genuinely broken expectation is still your job to fix** even when the user says "just delete the useless
   notes" — deletion is not the same as correcting.

## Self-review checklist before handing the plan over

The plan is itself an artifact under test; a wrong step costs the operator a wasted round and a false defect.
Run these five passes and fix what they catch — on a 250-line plan this pass found five real defects:

1. **Negative cases: check the precondition is actually satisfiable.** A "should be refused" step is only valid if
   nothing earlier in the procedure satisfies the guard. Traps live in the *unit* of the guard: a read-before-write
   rule scoped per file is already satisfied by an earlier read of the *same* file, so the反例 needs a fresh object.
2. **Every "期望…" string: match it against the artifact, not your memory.** Receipts are often a different language
   or a different sentence than the feature name suggests; grep the implementation for the literal text and paste it.
3. **Pick the judgement field deliberately.** Two similar fields often coexist — one advances on every run, the other
   only when the run actually changed something. Name the one that is authoritative for the claim and say explicitly
   which field must *not* be used as evidence.
4. **Cover the branch where the precondition is absent.** Commands that need a prior snapshot, a prior approval record,
   an enabled subsystem, or a first run must state what the empty-state receipt looks like and whether that is
   "无法判定" or "不通过".
5. **Internal cross-reference pass — run it, do not eyeball it.** Step ids referenced across sections, shared naming
   namespaces between scenarios (two scenarios both creating "demo" objects collide), and leftover wording from a
   previous environment (settings page / config file / CLI) that the current target cannot offer. Ten lines of
   regex over the file text settle all three: collect "^(id)(?= )" step ids and the ids named in each verdict line,
   then assert (a) every referenced id exists, (b) no id is defined twice, (c) every scenario has exactly one verdict
   line, (d) no forbidden-surface word survives.
6. **Order state-changing steps so a later test still has its object.** A step that re-enables a subsystem (or marks a
   skill as managed, or deletes a demo object) can invalidate the *next* scenario's target — the operator then reports
   "could not test". Sequence: destructive/last first, restoration last, and say in the step why the order matters.

## De-duplicating a plan the user calls "over-tested"

Over-testing is almost never "too many features" — it is **the same artifact read twice** under two step names.
Find it mechanically: list every step's (artifact, behaviour) pair and keep one per pair.

- Two reads of one file (before and after a change) collapse into one read plus a re-read only when the *content* is
  the judgement; if the judgement is the receipt, the read is just setup and should be labelled as such.
- Two list commands over the same directory (archive stats and archive restore) collapse into one, with the second
  step judging only the state change it caused.
- Two status surfaces showing the same counters collapse into one.
- Anything whose result is **conditional on elapsed time or turn count** is not a pass criterion: demote it to a
  separate "附加观察 / observations, not judged" section, or delete it. A tester may run a conditional step ten times
  and still have nothing to write in the report.
- Record the cut explicitly in the reply ("deleted X because it duplicated Y") — the user asked for the cut, so the
  reasoning is part of the deliverable.

## Pitfalls

- **The documented UI may not exist in the target environment.** (This session: the plugin ran on an
  air-gapped box whose only entry point was the chat box; every settings-card and config-file step had to
  become a chat command or be dropped.) Ask which surface exists *before* drafting, not after.
- **Don't invent a config step to make a test possible.** If the switch has no entry point on that surface,
  the test is 未测 — inventing "edit the file" hands the operator a broken step.
- **Counts and ids drift**: read ids at execution time from the system's own listing (e.g. a report or a
  pending list) instead of hard-coding them.
- **Verify the manual's language against the environment too**: a "settings card" step left in a chat-only
  document is a defect in the deliverable, not a nuance.
- **One file, dense, verbatim commands.** The operator copies; they do not read prose for clues.

## Verification

- Every command in the document was executed in the target environment during authoring, and its quoted
  expectation matches the observed output.
- Grep the finished document for unreachable-surface words (settings page, config file, CLI) and confirm each
  hit is intentional (a 未测 note or an explicit "you do not need this").
- Each functional item has at least one step whose observation is independent of the agent's self-report
  (a listing, a status output, a read-back of the artifact).
- The 未测 section is non-empty when the surface is constrained.

## References

- [references/user-rewrite-diff.md](references/user-rewrite-diff.md) — before/after of the user's own rewrite of a feature list (12 → 10 items) and the seven 说人话 rules extracted from it: no bold labels, actor as subject, behaviour instead of rationale, keep the numbers, fold non-user-visible items.
- [references/trimming-to-execution-only.md](references/trimming-to-execution-only.md) — worked example of the final cut (177 → 64 → 34 lines), the three defects a hand-trimmed plan carried, and what the user explicitly refused to re-add.
- [references/hermes-claw-dialog-only.md](references/hermes-claw-dialog-only.md) — worked example: the chat-only
  surface of the hermes-claw plugin (accepted commands, what is unreachable, verified expectations).
