---
name: codebase-inventory-survey
description: Survey a codebase and explain its functions as a list.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Code-Reading, Inventory, Documentation, Read-Only]
    related_skills: [codebase-defect-audit, capability-claim-audit]
---

# Codebase Inventory Survey

Read an unfamiliar or existing codebase and deliver a structured, function-first inventory of what it does. It does NOT grade defects or rank findings (that is `codebase-defect-audit`) and does NOT judge a port against its upstream point by point (that is `capability-replication-audit`). The output is a list a reader can act on: what the thing is, every capability it has, the interfaces it exposes, the files and limits it owns, its invariants, and what is knowingly unfinished.

## When to Use

- "深入阅读 X 的项目代码，对功能做清单式讲解" / "survey this repo and list its functions"
- Onboarding onto a codebase that already has README/IMPL/design docs written by its own authors
- Producing the "what exists" half of a review, before anyone argues about what should change
- Any request where the deliverable is understanding, not edits

## Prerequisites

- Read-only access to the repo root. No build, no test run, no install is needed for the survey itself.
- The repo's own documentation set. Find it before reading code: a docs index that splits "describes current behavior" from "dated process archive" is the highest-value thing in the repo.
- If the repo is a plugin or an extension, the host platform's installed docs matter more than the repo's prose — the code is usually shaped by host contracts it never restates.

## How to Run

1. Enumerate everything (`pwsh`), once: directories + every file with size, excluding `node_modules` and `.git`.
2. Read the authority documents whole. Note which ones are dated archives.
3. Per-file extraction: small files in full; large files by structure grep then offset reads.
4. Group the notes by capability, not by directory.
5. Write the report into the reply, in numbered sections, dense.

## Quick Reference

```powershell
# Every directory, node_modules/.git excluded
Get-ChildItem -Path <root> -Recurse -Force -Directory |
  Where-Object { $_.FullName -notmatch 'node_modules|\.git\\' } |
  ForEach-Object { $_.FullName.Replace('<root>\\','') } | Sort-Object

# Every file with size — the shape map (counts, hot spots, doc set)
Get-ChildItem -Path <root> -Recurse -Force -File |
  Where-Object { $_.FullName -notmatch 'node_modules|\.git\\' } |
  Select-Object @{n='Rel';e={$_.FullName.Replace('<root>\\','')}},Length | Sort-Object Rel
```

```
grep tool, path=<one large file>, pattern="^(export |async function |function |const [A-Z_]+ =)"
grep tool, path=<one large file>, pattern="^  // ──|^// ═+$"        # section markers
read tool, offset=<declared line>, limit=<section length>            # then deep-read
```

## Procedure

1. **Enumerate first, read second.** One recursive listing of directories and files with sizes gives the shape map: module count, which files are large enough to need structure-grepping, whether a docs set exists, whether tests/CI exist. Do not discover the tree file by file.
2. **Read the authority docs whole.** Prefer, in order: a docs index, the architecture/implementation manual, the user README, per-surface READMEs (tests, alignment, release). Skip dated process archives during the first pass; they describe a past state and will contradict the code.
3. **Extract per file by size.** Small files: read in full. Large files: grep for declaration lines and section markers, then `read` only the ranges the grep named. Batch several small files of one responsibility into a single program so one round-trip covers a whole subsystem.
4. **Harvest three classes of fact while reading**, in these words: the single owner of each semantic (policy table, registry, identity function), the seams to the platform/OS (which interface, what happens when it is missing), and constraints with numbers or literal strings (limits, thresholds, error codes, default values).
5. **Group by capability, not by directory.** One heading per user-visible or system-visible function ("记忆", "技能库策展", "审批与降级"), listing the modules it spans. A directory-shaped report is a file listing with prose on top and reads as coverage, not as understanding.
6. **Write the report in numbered sections**: positioning and version routing → capability inventory → seams and lifecycle → user-visible surfaces (tools/commands/CLI/UI) → file ownership and limits → configuration → bundled resources → code layering → invariants → gates and verification → documentation map → known gaps. Adapt the set; keep the order (what it is → what it does → how it is held together → what is unfinished).
7. **Keep claims traceable.** Every capability names the file that implements it, as a link with a relative path from the report's location. Every number (limit, threshold, count) is either read from code or from the repo's own doc set — never estimated. When the code and the docs disagree, state it in a "缺口" section instead of silently picking one.
8. **Ship the answer in three parts, in this order**: (1) the verified survey/matrix, (2) the confirmed-defect list where every row carries file:line + the mechanism + the evidence, (3) an executable plan whose batches each name an acceptance check. Then STOP and wait for approval before editing code — the read/plan/execute order is explicit user policy (see user memory: 先扫代码→再定计划→动手).
9. **When the ask is "re-check the docs against the code"** (not a fresh survey), run the authority-surface diff instead of re-reading prose:
   - Enumerate the authority surfaces (the tables/registries/manifests that the docs quote: config registry, feature-toggle table, hook assembly, capability matrix, platform-contract constants, manifest `contracts.tools`/`configSchema`/`skills`/`cliCommands`, constants module, command dispatch) and the doc set separately.
   - Diff BOTH directions: every surface item must appear in a doc, and every doc claim must resolve to a surface item. A one-directional check finds missing docs and misses invented ones.
   - Turn the diff into a repeatable gate script, then **reverse-verify it** (break one claim → the gate must go red) before trusting it.
   - Grade each claim's evidence: machine-checkable (registry/manifest/gate) > source-provable (read the implementation) > platform-external (grep the installed package) > explicit "unverified". Never silently promote "unverified" into a fact.
   - For docs that record a past state (dated archives, plans), the fix is an errata/index line, never a rewrite — the user's standing rule is 文档只改不实、不改史实.
   - Prioritize defects by class: authoritative-surface mismatch (code-vs-doc contradiction, self-contradicting docs) → hardcoded counts that code computes → drifted line numbers → platform citations with no checkable anchor → missing boundaries ("these docs do not exist") → doc-only knowledge with no assertion.
10. **Treat every doc-recorded current state as a claim, not as evidence** — the handoff/briefing page is the biggest instance (measured: a smoke/acceptance page carried a defect snapshot whose fix had landed, and a gate reading `268/268 · 12/12` while the tree was `277/277 · 14/14` after the fixed commit).
   - A doc that records **a defect with `file:line`** freezes a point in time. **Open that file first**: the fix often lands **in the same commit that wrote the doc**, so "the doc still says it is broken" is not current state and "the doc said it was fixed" is not either. Measured this session: the handoff item was already fixed in code (`index.js:247` versus the doc's `index.js:147`), in the same commit that added the stale record.
   - A doc-embedded gate reading (test counts, criteria pass counts, published hashes) goes stale silently. **Re-run the commands** — that reading, not the doc's, is what goes in the report.
   - When several docs disagree with each other, **classify the layers before judging code**: projects commonly mark one chain "active — must stay in sync" and another "frozen history — stop reading old counts as current". A contradiction is a finding only when both sides are on the same layer; otherwise quote the active chain and mark the other as history.
   - State a version/product fact as current only when **this session** observed it (ran the gate, read the tree, saw the deployed artifact). Anything sourced from a doc is attributed to that doc, with the date it records.
11. **Close with what is knowingly unfinished**: the archive's open items, unverified interfaces, acknowledged debt. An inventory that hides these reads as marketing, and gets corrected in the next reply.

## Pitfalls

- Reading is cheap per file and expensive per session: the context is consumed by tool results, not by conclusions. Fold each consumed batch into a summary at every milestone (see `[会话] 压缩断前缀缓存`), not in one panic pass at the end.
- Compressing the earliest ranges re-writes the prefix and invalidates the prompt cache; fold the newest consumed ranges, batched.
- PowerShell reading a Chinese/UTF-8 file eats line breaks and drifts line numbers. Use the read tool for any file whose lines you intend to cite.
- The repo's own manual may be simplified relative to the code (e.g. a "5-factor" heading over a 6-factor scorer). Report the code's number and flag the drift; do not restate the doc's number as fact.
- Do not inline JSON containing backslashes into a tool parameter — it fails as invalid JSON. Write a script file and pass its path.
- **For any claim about the host platform, run the tool** (`--help`, `config schema`, a grep of the host's own bundles) instead of reading the doc: the claim-type → artifact table is `codebase-defect-audit/references/docs-vs-code-inventory.md`.
- **A docs-vs-code re-check is its own lane set** once it grows past a survey: see `codebase-defect-audit/references/documentation-audit.md` for the gate designs (link + anchor, citation line-range, two-edition table parity) and the counting trap below.
- **Pin the counting method before quoting a count.** Editor line numbers (`read` totalLines) ≠ PowerShell `Measure-Object -Line` (measured on one file: 364 vs 326 — word/blank-line handling differs). Pick one method, name it in the report, and never mix.
- **`cmd | Select-Object -Last N` corrupts the exit-code check**: `$LASTEXITCODE` then reports the pipeline's last command, so a fully green suite can read as exit 1. Run the command bare, or `cmd; $c = $LASTEXITCODE; Write-Output ("EXITCODE=" + $c)`.
- **A doc that records a defect is a timestamp, not a status.** Measured: a smoke page's "still broken at `index.js:147`" snapshot was written in the same commit that had just moved the wiring to `index.js:247`. Read the file before repeating the claim, and read the commit that wrote the record before declaring it stale.
- **Re-run the gate reading before quoting it.** Doc-embedded numbers (`277/277`, `14/14`, a shasum) age every commit; the tree's live output is the only number a report may state as current.
- **Getting the tree's live readings has its own traps.** `node --test` prints nothing to a captured stdout without `--test-reporter=spec` (its summary lines are otherwise not in the captured stream) — the reliable shape is `node --test --test-reporter=spec` and then filter the `ℹ tests …` / `ℹ pass …` / `ℹ fail …` lines in the program. Filter **in the program**: a PowerShell pipeline (`| Select-String`) launched through `child_process.exec` fails on this host with a localized "not recognized as a command" error and exit 255.
- **Building a long summary string inside `run_code` can die on a quoting trap.** TypeScript source that embeds a column-0 `"` inside a `"`-delimited string (e.g. a quoted profile key or a `"private": true` fragment) is a syntax error — `Expected ',', got 'ident'`. Avoid it by using template literals, or build the quote character as `String.fromCharCode(34)` and concatenate.
- **Compression has a hard per-call floor and a real overhead.** `compress` rejects a batch under ~5000 characters ("Total compressible content too small"), so fold a small range together with a larger one in the same call. And a summary you write costs tokens of its own: this session spent a ~17K-character Chinese summary to reclaim ~48K tokens of source (≈3× on Chinese text). Worth it for a 40K+ range; not worth it for a few thousand tokens. After compressing, treat the summary as a **record of what was read, not as quoted current state** — re-read the file before repeating any of its claims.
- **Never nest file reads into a background `pwsh` job.** The `tools.*` bindings exist only inside the `run_code` program scope; a plain `node` process spawned by pwsh has none of them (three such jobs died as exit 1). Read in the program, and free context by compressing.
- **`> file` in PowerShell: the encoding follows the PowerShell you are in.** The DSH `pwsh` tool is **7.6.7 since 2026-10-15 and writes UTF-8 without BOM**; an explicit `powershell.exe` (5.1) still writes UTF-16LE, which the read tool refuses as binary. Write UTF-8 explicitly (`Out-File -Encoding utf8`) or print to stdout when the reader's encoding is not yours to control.
- Do not dump raw tool output into the report. Extract, then write.
- Do not add self-narration (how much was read, how it was batched, what each section is for). The reader wants the facts and the next reachable action.
- If a component turns out broken in this environment, say "unverified in this environment", not "does not work".

## Verification

- Every capability heading cites at least one real file path; every cited path was opened or grepped in this session.
- Totals (file count, line count) come from one enumeration command **and one measurement method, stated in the report**; the identical number must not appear in two different forms.
- Each code-vs-doc contradiction appears exactly once, in the gaps section, with both statements quoted.
- The gaps section is non-empty for any real codebase; "no known gaps" means the search was too shallow.
- The reply is written in the user's working language, reads dense, and contains no marketing vocabulary.

## References

- [references/hermes-claw.md](references/hermes-claw.md) — worked example and current architecture snapshot: an OpenClaw self-evolution plugin (`hermes-evolution`) at `D:\claw\hermes-claw`, with its capability map, seams, and open items.
