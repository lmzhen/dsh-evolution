---
name: literature-artifact-triage
description: "Triage research papers into an evidence-graded report with verified artifacts."
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Research, Literature, Evidence, OpenSource, Verification]
---

# Literature Artifact Triage

Builds a filtered, evidence-graded literature list: find papers matching stated inclusion
criteria, then **verify each claimed artifact and each author affiliation** before ranking.
It does NOT write the papers' science, and it does not rank by citation counts or popularity.
Core stance: rank by *what you can actually obtain*, not by what the paper claims to release.

## When to Use

- "Find research on X since <date>, prioritize high-quality / reliable authors / with GitHub or HuggingFace links"
- "Which of these papers can I actually reproduce?"
- Any request where a paper's *artifact availability* or *author credibility* is a selection criterion.
- Also use when auditing a report someone else produced for unsupported artifact claims.

## Prerequisites

None. Uses `web_search`, `web_fetch`, `subagent`, `skill_manage`. For arXiv metadata prefer the
Atom API (`https://export.arxiv.org/api/query?...`) — it returns authors, dates, `journal_ref`
and the full abstract in one call.

## Quick Reference

| Need | Call |
|---|---|
| Paper metadata (authors, venue, dates) | `export.arxiv.org/api/query?id_list=<ids>&max_results=N` |
| Metadata for a whole list at once | ONE `id_list=` request carrying every ID (`max_results=100`) — splitting into small batches trips `Rate exceeded.` (HTTP 429); on 429 wait ~60 s and retry the same single call |
| Survey PDF → text | bundled Python has `pypdf`: `PdfReader(p).pages[i].extract_text()` per page, keep `=== PAGE n ===` markers |
| Artifact verdict for a whole list | `node scripts/verify-paper-artifacts.mjs papers.json` — encodes the E1/E2 ladder (name + citation + ≤4 arXiv ids), paces searches, rewrites the result file per paper |
| Download + score the code you found | see `references/code-scoring-rubric.md`: shallow-clone hygiene (verify HEAD + file count), measured-vs-judged rubric, and the four measurement traps |
| Affiliation (NOT in abstract) | `arxiv.org/html/<id>v<N>` — the affiliation block |
| Repo metadata | `api.github.com/repos/<owner>/<repo>` |
| Repo file tree | `api.github.com/repos/<owner>/<repo>/contents/` |
| Repo real commit history | `api.github.com/repos/<owner>/<repo>/commits?per_page=5` |
| Model-weights page | `huggingface.co/api/models/<owner>/<name>` |

**Escalate hosts, never declare a host dead.** `api.github.com`, `github.com`,
`raw.githubusercontent.com`, and the git protocol are *separate* channels with independent
reachability; any one may work while others fail, and reachability changes mid-session when a
proxy/VPN comes up. Probe each channel with one cheap request before giving up on the host.
Route around with whichever responds, and re-probe later in the session rather than trusting an
earlier failure.

## Procedure

1. **Pin the inclusion criteria before searching.** Write them as a numbered list the user can
   audit (e.g. subject, task domain, artifact required). Ambiguity in "small model" or "traditional
   ML" must be resolved *now* or the list will silently drift.
   When the question is "which of these papers fit *our* system", derive the criteria from that
   system's CODE, not from the paper taxonomy — and expect the user to add criteria in successive
   passes (fit → deployability → architectural compatibility). Keep ONE list file, add a column per
   layer, and print the funnel counts so the audit trail stays visible. Recipes and a worked example:
   `references/domain-fit-layering.md`.
2. **Harvest candidates from several faces**, not one query: arXiv Atom API with `abs:`/`ti:`/`cat:`
   booleans sorted by date; a multi-engine aggregator; plain web search; and non-English
   paper-note blogs, which surface venue-accepted work that English search misses.
   **Screen on whether the relevant experiment appears anywhere in the paper, not on how the
   paper frames itself.** A benchmark or dataset paper routinely contains the most comparable
   experiments to a methods request. Screening by title/framing silently drops these — one paper
   was misfiled as "no artifact" and mentioned in a single line, when it actually had the most
   complete artifact set of any paper found *and* reported the negative result that mattered most.
   Seed the candidate set and templates/evidence-graded-list.md carries the report skeleton.
3. **Verify metadata from the paper itself.** Fetch the abs page *and* the HTML full text. Get
   affiliations from the HTML affiliation block — **never infer an institution from an author's
   name or from a third-party summary.** Real example: a paper attributed by guesswork to a
   university was actually AWS AI Labs; the name-based guess was simply wrong.
4. **Verify every artifact claim with the GitHub API**, never with "the README fetched". See
   Pitfalls — this is the highest-value step and the easiest to get wrong. Existence is not
   identity: a live, non-empty repo that merely *cites* the paper (awesome-list, `*-daily`
   aggregator, book/course repo) is not its artifact. Grade only after the repo passes the
   identity ladder in `references/artifact-identity-and-filtering.md`.
5. **Assign an open-source grade**, highest obtainable first:
   `weights+code > code > dataset-only > "will release" > none found`.
   Grade on evidence, and record the evidence next to the grade.
6. **Rank and write.** Lead with a scannable summary table (one row per paper, with the grade
   column), then per-paper entries, then an explicit exclusions section, then a verification log.
   Once the list is final and the code is downloaded, `references/code-scoring-rubric.md` covers the
   follow-ups: one-folder bundling (`--depth 1 --single-branch`, verify HEAD + file count) and a
   measured-vs-judged scoring rubric with the four traps that make a first scoring pass wrong.
   **Before choosing dimensions, ask which question is being asked** — "does this fit our system"
   (porting fit) and "is this code any good" (code quality) are different rubrics, and picking without
   asking got a rubric rejected. For code quality the user's axes are fixed and equal-weight:
   架构合理性 · 鲁棒性 · 可维护性 · 易读性 · 可扩展性; each maps to measurable proxies in the reference.
7. **State the gap instead of padding.** If only one paper satisfies all criteria, say so and say
   the count. A padded list is worse than a short honest one.
   **Scaling to N projects (one isolated reader each)?** `references/subagent-fanout-and-synthesis.md`:
   write the baseline + coordinator + synthesis ledger BEFORE dispatching, make every prompt
   self-contained with a single writable report path, require incremental writing (the report is the
   breakpoint), and treat the merge as verification work — re-check load-bearing claims, recount
   summary tables against detail, and never let a self-assessed evidence score stand for a repo whose
   tests never ran.
   **A conflict analysis is not finished when it hands out dispositions.** Score every item on a
   conflict dimension with a stated pass line, delete what falls below it, and keep a one-line
   deletion log in the same file — that is what the user means by "从另一个维度打分并把低于及格线的
   排除和删掉". Run the coverage self-check (items = sum of group sizes) before scoring.
8. **Survey (or awesome-list) → domain-filtered list?** Follow
   `references/survey-to-domain-mapping.md`: pin the target system's axes from its CODE first, map
   survey sections → citations mechanically, then verify every annotation against the abstract and
   correct title/year from primary metadata before filtering by obtainability.

## Pitfalls

- **HTTP 200 on a raw README does NOT prove a repo has code.** A 9-byte README (`# AceGRPO`)
  fetches perfectly. This produced a wrong "code available" verdict that survived one round of
  review. Judge content, not reachability:
  - `size: 0` **or** `pushed_at == created_at` ⇒ empty repo; `contents/` returns
    `{"message":"This repository is empty."}`
  - only `.gitignore` + a tiny README ⇒ placeholder, no implementation
  - commits worth reading: `"Initial commit"` → `"Public release"` timelines corroborate that
    weights/artifacts really shipped, and the commit author should match a paper author
- **A repo URL printed in a paper is not evidence of code.** Two papers here published a GitHub
  link; both repos were empty. Conversely, a paper whose abs page carries *no* link may still have
  a working repo discoverable by author search — absence of a link is equally weak evidence.
- **Citing the paper ≠ being its artifact (the expensive one).** "README contains the arXiv ID" also
  matches awesome-lists, `arxiv-daily` aggregators and course repos — `huangjia2019/agent-design-patterns`,
  `SanDiegoMachineLearning/talks`, `joheras/Lecturas`, `Marontis/agentic-engineering` (106 IDs) all passed
  it. Title-token overlap alone returns look-alikes (`ksm26/LLMs-as-Operating-Systems-Agent-Memory` for
  MemGPT instead of `cpacker/MemGPT`). Working test: repo name contains the system name **and** README
  cites the paper **and** the README holds ≤4 distinct arXiv IDs. Productised repos (MemGPT/OpenHands/
  AutoGen) fail the citation leg after their READMEs were rewritten — keep them, but as a separate tier.
- **Third-party notes are not the paper.** A code URL copied from a paper-note blog had no
  counterpart in the paper's own abs page. Mark provenance per claim: paper text vs third party.
- **Affiliation is not in the abstract.** If you only fetched the abs page, you do not know the
  institution. Write "not verified" rather than guessing.
- **Do not stop at "not reachable" when a proxy may exist.** Ask the user to bring up their
  proxy/VPN, then re-probe; the reachable set can change within one session and unlock an entire
  verification pass that was previously blocked.
- **Never launch a verification subagent for domains whose reachability you have not confirmed.**
  Otherwise it burns its whole run on unreachable hosts and must be interrupted. Walk one probe
  yourself first, then delegate — and give the subagent the channel that actually works.
- **Verify the verifier's method, once it works.** Re-check earlier "confirmed" verdicts with the
  newly available channel — several will flip.
- **Long-running verification subagents can stall** on network-bound work. Interrupt and do the
  checks inline over a channel you have already proven, rather than waiting indefinitely.

## Verification

The report is done when, for every entry, you can point to (a) a fetched source for each
affiliation and numeric claim, and (b) an API-level artifact verdict. Re-read your own grade
column while asking "did I confirm *content*, or only that a URL resolves?" If any grade rests on
URL resolution alone, it is not yet verified. Then append a verification-log section listing
corrections you made, so the next reader can see what changed and why.
