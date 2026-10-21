---
name: invention-point-mining
description: Rank a codebase's technical points for patent filing.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Patents, Code Analysis, Prior Art, Evidence]
    related_skills: [dsh-evolution-maintenance]
---

# Invention Point Mining

Turn a codebase into a graded list of candidate invention points, each backed by
file:line evidence and a prior-art verdict. It does NOT draft patent
applications, does not search patent databases, and needs nothing beyond
git/grep/npm plus the ability to read the repo. The output is an assessment the
user takes to a patent attorney or an in-house filing pipeline.

## When to Use

- "这个项目有哪些可以写进专利的技术点？"
- "这些技术点能不能水专利 / 能撑独权吗？"
- "按照同样的口径分析另一个项目" — repeat the sweep on a sibling repo.
- Framing an application whose subject matter is a domain (e.g. skills) and needs
  scenario-level dependent claims written alongside other material.

## Prerequisites

- The target repo path, and if it is a port: the upstream/reference repo it came
  from (novelty is decided relative to that).
- `git` for remote/history, and npm for publication status.
- On PowerShell, `npm` resolves to `npm.ps1` and can be blocked by execution
  policy — call `npm.cmd` through `cmd /c`.

## How to Run

1. Recon + novelty probes (Quick Reference).
2. Evidence sweep: parallel subagents for the big packages, and read the small
   decisive files yourself (validators, state machines, registries, seams).
3. Grade every candidate S / A / B / OFF.
4. Assemble the claim tree and the "do not touch" prior-art list.
5. Deliver per point: scenario → failure mode → feature chain (file:line) →
   effect, plus collision risk and the experiment that would prove the effect.
   Hand over the outline first, then write.

## Quick Reference

Three gates — a point failing any gate is not writable:

| Gate | Rule | Consequence |
|---|---|---|
| Type | CN utility models protect products only | methods/software ⇒ invention patent only |
| Subject | Art. 25 excludes mental rules | need technical problem → technical means → technical effect on system resources |
| Novelty | the applicant's own prior publication destroys it | check git remote, npm versions, first-commit date |

Four-part frame per point: 场景 → 系统层失效模式 → 特征链 → 可量化效果.

Grades: **S** independent claim · **A** dependent claim · **B** embodiment only ·
**OFF** prior art (background section at most).

Novelty probes:

```bash
git remote -v
git log --reverse --format='%ci %s' -1; git log -1 --format='%ci %s'
cmd /c "npm.cmd view <pkg> versions --json"        # PowerShell-safe
grep -rn "<same-concept-synonyms>" <reference-repo>  # 0 hits = novel candidate
```

## Procedure

1. **Recon.** Root docs, package list, LOC per package, test layout. Docs are
   leads, never evidence.
2. **Novelty probes.** `git remote -v` + `npm view` + first/last commit dates
   decide whether the code is already public. Published code is prior art
   against a later filing — CN has no general grace period.
3. **Split novel from aligned.** Read the target implementation (file:line), then
   grep the reference repo for the same concept. Aligned ⇒ prior art. Keep
   grepping until an absence is a real absence, and record the greps used.
4. **Separate platform-given from plugin-given.** Check the platform repo for an
   equivalent API (injection point, approval seam, cache boundary). A wrapper
   over a platform capability is not an invention point.
5. **Grade.** S: a system-level failure mode + specific means + measurable
   effect. A: same shape, narrower or weaker novelty. B: real mechanism but
   plumbing. OFF: already in the upstream or the platform.
6. **Assemble.** Name the one specific technical feature every independent claim
   shares (unity), put S points as independent claims, A points as dependent
   claims grouped by usage scenario.
7. **Bucket the slices S / A / B / 别碰 — never letter the lifecycle stages.**
   The grade vocabulary is the skeleton of the answer; an earlier draft used
   A–F for stages and the grades disappeared. See
   `references/skill-scenario-catalog.md`.
8. **State each slice on the FUNCTIONAL side of a concrete scenario.**
   Read it as: 场景（谁在做什么）→ 系统做了什么（用户看得见的行为）→
   可观察结果; the failure mode and the mechanism (lock / anchor / state
   machine / cache) are the supporting evidence and the writability
   justification, never the headline.
9. **Deliver as scenario slices, not as a novelty ranking.** The user's
   application is ONE domain filing (e.g. skills) that also carries outside
   material, so each point is a slice: 场景 / 系统层失效模式 / 特征链 (file:line) /
   独权-从权-实施例 / 前置与验收. Never present the sweep as a list of separate
   filings; see `references/skill-scenario-catalog.md` for the delivered shape.

## Pitfalls

- **Docs drift from code.** Measured: a repo's own audit table claimed 9 hooks and
  5 prompt skills; the code had 11 and 4. Verify every claim against source.
- **"Concept exists upstream" ≠ "implementation identical."** When the concept is
  upstream but the mechanism differs (different event model, different state
  machine, different failure handling), write it as a dependent claim and put
  the difference into the features.
- **Thresholds, constants, prompt text and config plumbing are not inventions.**
- Gate/CI/build-tooling mechanisms (guards, generators, drift detectors, install
  state machines) count only when the filing is anchored on that pipeline; for a
  runtime-anchored filing record them as B-tier and move on.
- A port or an open-sourced project makes everything aligned with its parent
  prior art; only the host-specific engineering survives.
- **Never invent experimental data.** Ship the effect claim plus the experiment
  list instead.
- Raise own-publication ordering and employee-invention ownership before
  promising anything.

## Verification

- Every S/A point cites file:line that `read` can open.
- Every "novel" claim reproduces with the same absence grep against the reference
  repo.
- The deliverable contains a "do not touch" list; without it the sweep was not
  exhaustive.

## References

- `references/disclosure-docx-house-style.md` — the house style of the user's
  existing 交底书 files, and the recipe for emitting a .docx that inherits the
  template's styles (python-docx is available; template-as-container).
- `references/cn-invention-patent-rubric.md` — CN legal gates, claim-tree rules,
  common rejection grounds, 交底书 checklist.
- `references/worked-examples.md` — two graded sweeps (hermes-claw,
  dsh-evolution) reusable as a prior map.
