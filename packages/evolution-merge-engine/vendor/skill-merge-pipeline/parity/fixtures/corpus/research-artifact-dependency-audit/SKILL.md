---
name: research-artifact-dependency-audit
description: Trace a research project's data and ground-truth needs.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Research, Provenance, Evidence, Ground-Truth, Reproduction]
    related_skills: [literature-artifact-triage, capability-claim-audit]
---

# Research Artifact Dependency Audit

Answers a pointed question about one research project — "does it need a dataset?", "does it need
ground truth?", "can I run this without X?" — by tracing each dependency to its exact layer and
citing paper text, not repo vibes. It does NOT rank papers or discover new ones (use
`literature-artifact-triage` for that), and it does not run the method.

Core stance: **a paper repository is usually the paper plus images.** With no code, dependency
claims are structurally unverifiable — say so, cite where each claim comes from, and never let the
README's framing stand in for the method's actual data flow.

## When to Use

- "这个项目依赖于数据集吗？尤其是依赖于 ground truth 吗？"
- "Does <project> need training data / labels / a reference implementation?"
- "Can I run <method> without <resource>?" / "What would I need to reproduce this?"
- Any request to judge a paper's data requirements before committing to reimplement or reuse it.
- "还能不能用在真实任务上" / free-form B2C use with no explicit task boundary and no ground truth.
  Answer this **first** (step 3), then use the layer accounting as evidence for it.

## Prerequisites

`web_fetch` for the repo page and project site; `pwsh` + `git` for a shallow clone when the repo is
small; a PDF text extractor for the paper (`pymupdf`/`fitz`, `pypdf`, `pdfminer` are commonly
present — probe with `importlib.util.find_spec` before assuming); `gh api` for artifact state that
the rendered page hides.

## How to Run

Clone the artifact, count its real contents, then read the paper — in that order.

```powershell
git clone --depth 1 <repo-url> D:\<work>\_probe\<name>   # git writes progress to stderr;
                                                          # a NativeCommandError there is not failure
Get-ChildItem <clone> -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.git\\' } |
  Select-Object @{n='Path';e={$_.FullName.Replace('<clone>\','')}}, Length
```

1. **Establish what artifact exists.** File list + `gh api repos/<o>/<r>` (`size`, `pushed_at`).
   README + `assets/` + a PDF and nothing else ⇒ **paper-only**: your answer must be flagged as
   unverified against code, and any release-plan table quoted verbatim.
2. **Extract the whole paper to text, then two-pass grep.** First pass: a terminology map to build
   vocabulary. Second: targeted terms. Do **not** start from generic `data|instance` — it drowns in
   code listings and "training signals" from related work.
3. **Test transferability to each real deployment regime — do this before layer accounting.**
   The question behind "does it need a dataset?" is usually "does this survive my usage model?".
   What a method needs *per usage point* is a reproduction cost, not a dataset; the preconditions
   that decide transfer are **a cheap objective signal** and **task repetition** (N attempts and
   fine-grained credit assignment at the moment of use). Two regimes:

   | Regime | Structure | Transfer verdict |
   |---|---|---|
   | B2B batch, same task, many items | task boundary exists; build a labelled set; score is computable per item | ≈ isomorphic to the academic setup ⇒ transfers; swap in the in-house evaluator |
   | C2C free-form use | no explicit task boundary; no objective; outcomes are subjective satisfaction; one request at a time | preconditions invert ⇒ does not transfer as a whole |

   Four things to check for the free-form regime, in order of how hard they bind:

   | Precondition the method needs | What it becomes in free-form use | Binds? |
   |---|---|---|
   | objective scorer ($F_k$, 1/ms) | proxy signals (rephrasing, abandonment, session length) — lagged, sparse, noisy | degraded |
   | tree + W parallel workers | a single request has no branch structure | no |
   | cheap upfront exploration run | must be amortized over one query | no |
   | history/traces | exists, but per-user sparse and privacy-constrained | degraded |

   Then name the **amortization boundary** (what one discovery run must be spread over) and the
   **applicability point** (which layer the mechanism would have to move to). If the only home for
   it is a system layer measured over non-stationary user traffic, say that relocating there is a
   different research question — not evidence the method transfers.

   **Test deployability before declaring a blocker.** "Needs a user population" is often false —
   check for a local CLI, an input contract, and required dependencies before using scale as the
   reason something cannot apply. The real gate is usually **data sufficiency at the usage point**
   (per-decision outcomes, overlap/support), plus a time window long enough to accumulate them.
   Read the input contract for *which columns are mandatory*: a required `oracle_tool`/label column
   means per-decision ground truth is a precondition, and an optional propensity/reward path means
   the cost moves rather than disappears. A tool that ships a coverage veto and returns "hold" on
   thin logs is designed to refuse exactly when volume is insufficient — that refusal is the
   evidence, so report it as such rather than as a tool limitation.

   **Name the boundary condition before proposing a port.** When the verdict is "the mechanism does
   not transfer", write the ONE condition under which it would — and treat that as the terminator,
   not as a shopping list. A defect that the rejected tool happens to also solve is **evidence of a
   defect, never a reason to import the tool**; importing it drags foreign assumptions in behind the
   fix and reads as gilding a system the tool never fit. Derive any fix from the target system's own
   invariants (its existing guards, its own refusals) and check the import is not solving a
   lower-order problem while the higher-order one — is the measured quantity even the right one —
   stays open. Say who owns the defect; do not let the rejected tool take credit for finding it.

4. **Classify every dependency claim by layer**, and label each *method-runtime* vs *reproduction*:

   | Layer | Contents | Label |
   |---|---|---|
   | Runtime | agent/model, evaluator or scoring oracle, execution interface | method needs it |
   | Experimental | tasks, instances, reference solution, held-out set, budgets | experiment needs it |
   | Reproduction | how instances were generated, preprocessing, seeds, checkpoints | reader must supply |
   | Assumption | "same as <prior work>", unstated generation, private corpora | risk |

5. **Split ground truth by task family, then by loop position.** The same phrase covers very
   different things: a *reference solver's objective value* (numeric-equivalence check with a
   tolerance), a *reference implementation's outputs* (kernel/implementation tasks), or *nothing at
   all* where the objective is computed from the candidate itself (math/construction tasks). Then
   find where it is consumed — inside the search loop, or only in the final scoring table.
   "Ground truth shapes search but exits the loop once recorded" is the finding that answers the
   question; a bare "yes it uses sklearn" does not.
5. **Hunt for deliberate exclusions — they are the strongest evidence.** Prompts and evaluation
   interfaces often forbid exactly the thing being asked about: "never use unrevealed scores, a
   true optimum, absolute score targets"; an agent API that exposes only `observed()` /
   `baseline_score` bounds what ground truth can reach. Quote the constraint and its location.
7. **Check any replay/offline-optimization mechanism for what it re-runs.** If offline policy
   evaluation reads stored scores, ground truth cannot be in that loop — verify with the paper's own
   wording, and state the limit too: an exact replay sim is exact only over the search space
   already realized, so decisions outside recorded history are **not evaluable**, not merely
   unexplored. The quality of accumulated history, not the dataset, is the real ceiling.
8. **Answer in this order**: ① the core mechanism does/does not need data — one line; ② ground truth
   per task family, each with a quoted location; ③ what is needed to *run* vs to *reproduce the
   numbers*; ④ what cannot be verified until code ships, with a date/version stamp.

## Quick Reference

Paper terms that expose dependencies (second-pass greps):

| Term | What it reveals |
|---|---|
| `held-out`, `fresh instances`, `test set` | whether evaluation data is separated from search data |
| `reference implementation`, `objective-value check`, tolerance | ground truth form and strictness |
| `we follow the benchmark setting of` | reproduction burden pushed onto another paper |
| `training data`, `weight fine-tuning`, `zero gradient` | whether learned weight updates are in scope |
| `correctness`, `tolerance`, `passes` | the pass/fail gate that makes a score meaningful |
| `prefix-only`, `unrevealed`, `true optimum` | deliberate exclusions constraining the agent |
| `W parallel workers`, `K rounds`, `N instances` | per-task structure that a single request cannot supply |
| `agent calls`, `generations`, `budget` | what one discovery run costs, i.e. what must be amortized |

## Pitfalls

- **Repo README framing ≠ method data flow.** A README can advertise "zero executions" about
  offline replay while the online phase still needs a full evaluator. Text found *above* the
  abstract on the GitHub page is license boilerplate, not README content.
- **Generic dependency greps produce noise, not evidence.** `data|instance` hits code listings.
  Prefer the map above and read the surrounding lines.
- **Don't collapse "needs a dataset" with "needs a dataset to reproduce the reported number".**
  Reporting the first when the paper means the second is the most common wrong answer here.
- **Ground truth is not one thing across task families.** A tolerance-based objective-value check
  against a reference solver, a reference-implementation output check, and a self-computed
  objective are three different dependencies; state which applies per task.
- **A public dataset name is not a runnable pipeline.** "same N instances as <prior work>" without a
  generator is a reproduction blocker — name it as such.
- **Do not extrapolate preprocessing** (which subset, how many folds) from a table of downstream
  numbers. If the paper does not say, the answer is "not stated".
- **Paper-only repos forbid structural claims.** Never imply you inspected an evaluator you never
  saw.
- **Don't let the ground-truth question hide the binding constraint.** In a controlled setting the
  label-absence worry is often moot (the objective *replaces* labels). What actually fails outside
  it is the **cost of acquiring the measurement** and the **per-usage-point structure** — check
  those before answering the question as literally asked.
- **Do not launder an uncontrolled claim into a transferable one.** "Optimize the orchestration
  policy over logged traffic" is a different (and much harder) problem from the controlled
  demonstration: the objective is unobservable, the data is non-stationary, and credit assignment
  spans sessions. Say "this is where it would have to live", not "this shows it works there".

## Verification

Done when each dependency claim carries a location (page/section/line or repo path), each is
labelled method-runtime or reproduction-only, and every "no evidence" verdict names its evidence
(the file list, the commit date, the release-plan row). Close with an explicit unverified list for
anything contingent on unreleased code. Worked example with quoted evidence:
`references/dream-rsi-case.md`.
