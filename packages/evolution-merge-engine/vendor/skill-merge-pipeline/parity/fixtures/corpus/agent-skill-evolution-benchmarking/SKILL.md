---
name: agent-skill-evolution-benchmarking
description: Benchmark skill generation across agent frameworks.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Agent Evaluation, Skill Generation, Benchmarking]
    related_skills: [dsh-evolution-maintenance]
---

# Agent Skill Evolution Benchmarking

Measure whether an agent framework turns one real task round into a reusable skill, and compare frameworks or configurations. It runs each dataset task in an isolated workspace, snapshots the skill directory before and after, scores the task with the dataset's original verifier, and LLM-judges the generated skill. It does NOT measure multi-round skill reuse, and it never replaces the dataset verifier with a custom grader.

## When to Use

- "Test whether <framework> auto-creates a skill after a task."
- "Compare Hermes / OpenClaw / DSH skill generation on real datasets."
- "The harness reports 0 skills, false-zero task scores, or suspiciously cheap runs."
- "Expand a benchmark with task variants, repeats, or offline fixtures."

## Prerequisites

- Framework CLIs runnable non-interactively (for example a one-shot prompt mode, an agent RPC, or a headless runner).
- An OpenAI-compatible endpoint that both the agent and the skill judge can call.
- A task dataset with `tasks.json`, task data, and the original verifiers.
- Isolated state per case: one `HERMES_HOME`, OpenClaw state dir, or profile per run; never share state between cases.
- Python 3.10+; a background-run mechanism for long matrices.

## How to Run

Drive the host harness from a DSH shell tool: `bash` on POSIX, `pwsh` on Windows. Avoid `--flag=value` in scripts parsed by `argv.indexOf()`, and always quote path arguments containing spaces.

```text
python skill_generation/run_skill_generation.py \
  --bench <skillsbench|wildclawbench|all> \
  --tasks <comma-separated ids> \
  --framework <hermes|hermes-claw|both> \
  --condition <baseline|evolution|both> \
  --run-id <id>
```

Run the API preflight first, then a single-task probe, then the matrix. For long runs use a managed background job and poll the run log instead of blocking one shell.

## Candidate Frameworks (dataset-free check)

Before spending matrix budget, check whether the framework needs a pre-existing labelled/eval dataset. Verified statically from source 2026-09 (star counts then; code has not been run here).

| Framework | Needs pre-made dataset | Improves an existing skill | Needs env re-run |
|---|---|---|---|
| `Tencent/SkillHone` (162) | no (quick path: "No eval repo or benchmark data is required"). its optimizer IS DSH: `src/core/harness.ts:117-135`; pinned `@deepseek-ai/dsh@0.1.5-rc.2` | yes, verifier = one reproduction test (`src/cli.ts:202`) | only that test |
| `NousResearch/hermes-agent-self-evolution` (5398) | no: `evolve_skill.py:298-299` default `--eval-source synthetic`; evaluator built by `core/dataset_builder.py:89-96` | yes, target is SKILL.md | no |
| `Memento-Teams/Memento-Skills` (1564) | no | yes + real rollback `engine.py:490-507 / :297`; `evolution_enabled` default False | optional (`engine.py:441-453`) |
| `MemTensor/MemOS` (11552) | no; deterministic verifier `core/skill/verifier.ts:5` | yes (rebuild) | rebuild no, promote needs one episode |
| `gepa-ai/gepa` (6715) | no: `optimize_anything.py:94-101` `dataset=None` | any text, incl. skill | no |
| `SakanaAI/ShinkaEvolve` (1412) | no: task dir = `evaluate.py` + `initial.<ext>` | program / system prompt | evaluator only |
| `algorithmicsuperintelligence/openevolve` (7426) | no: CLI wants `initial_program` + eval file | program | evaluator only |
| `PrimeIntellect-ai/prime-agent` (21241), `sethkarten/continual-harness` (331) | no (live session only: `agent-session.ts:4745-4749`, `refinement.ts:1258`) | yes: update = same id + `version+1` (`refinement.ts:1114-1120`), rollback = `refinement.ts:1163-1196` via `/refine rollback <id>` | no, but **no verification**: refine is default-on auto (turnInterval 25 / compact / 20 min cooldown, `settings-manager.ts:25-30`, `agent-session.ts:4659,4748,9339`) yet the only gates are shape checks (`refinement.ts:1002-1064`) plus a pre-plan LLM reviewer (`refinement.ts:181-191`, `agent-session.ts:9366`); no test/bench; `expectedOutcome` is stored, never executed (`refinement.ts:888,1147`) |

Forced dataset at the entry point (do not expect a data-free run): `dgm` (`swe_bench/harness.py:206 load_dataset("princeton-nlp/SWE-bench_Verified")`), `sia` (`orchestrator.py:391 --dataset_dir`), `microsoft/SkillOpt` (`data/README.md:3-6`), `SEAL` (`few-shot/launch.sh:18-19`), `HyperAgents` (default domains need `dataset.csv`; only `domains/genesis` is data-free), `ace` (core `ace/ace.py:33-43` takes no dataset, but `eval/finance/run.py:106` raises without the jsonl).

This benchmark itself always needs real tasks with their original verifiers (see Prerequisites) — the column above decides only whether a candidate can run its own evolution loop without extra data, not whether a matrix can be run without `tasks.json`.

When the framework synthesises its own evaluation set (hermes `synthetic`), judge only the evolved SKILL.md support files; never let the framework's self-made answers stand in for the dataset verifier.

## Quick Reference

- `--list`, `--dry-run` — inspect the task set without starting agents.
- `--timeout`, `--skill-wait`, `--gateway-timeout` — per-call, review-wait, and gateway-start budgets.
- `--repeat N` — repeat each case; report mean and spread, not one sample.
- `--export-skills <root>` — after a case, copy each package to `<root>/<family>/<framework>-<condition>-<skill>/<run-id>-r<repeat>/` with `export_meta.json` and a root `index.json`; the evaluator consumes `package_id@version` and still accepts legacy unversioned dirs.
- Evaluator flags: `--skills-root <root>` (packages at `<family>/<candidate>/SKILL.md`), `--rounds N`, `--no-baseline`, plus a `paired` summary with mean delta and wins/losses/ties.
- `results.json` / `results.csv` / `summary.json` — raw cases plus grouped means and trigger rates.
- `skill_triggered` — a `SKILL.md` was created or changed; telemetry files do not count.
- `skill_leak_suspect` / `skill_leak_rate` — flags a package whose `SKILL.md` names another variant's tokens (paper title, file name), which usually explains failed transfer.
- Judge scope: every added/modified `SKILL.md` is judged separately with its own support files (`skill_judges`); the case score is their mean, and summaries expose both `avg_skill_judge_score` (case-level) and `avg_skill_quality` (per-skill).
- `review_channel` — which mechanism produced the skill: native background review, tool-result completion injection, cadence nudge, or a harness-driven follow-up review turn.
- Support bank: `references/wildclawbench-extension-integration.md` — variant tasks, offline fixtures, and integration caveats for the WildClawBench extension checkout.

## Procedure

1. Preflight the endpoint with `GET {base_url}/models`; abort on 401 before spending a matrix budget.
2. Prepare one workspace per case, copy task data and support files, and snapshot the skill directory.
3. Run exactly one task round through the framework's non-interactive entry point.
4. Let the review channel finish. Join native review threads when the framework forks them; poll the skill directory otherwise.
5. Snapshot again and diff: `added`, `modified`, and the `SKILL.md` paths that changed.
6. Score the task with the dataset's original verifier, from its pristine location.
7. Judge each changed `SKILL.md` separately with its own support files, then aggregate the verdicts into one case score. If a judge call fails, backfill offline from `results.json` + `skills_after` instead of rerunning the agent.
8. Export generated packages to the evaluator root (`<root>/<family>/<framework>-<condition>-<skill>/<run-id>-r<repeat>/`), then aggregate per framework and condition: mean task score, skill trigger rate, judge score, failure rate, and tokens.
9. Report progress, coverage, and blockers before starting or extending a long matrix.

## Pitfalls

- **Daemon review dies with the CLI.** A one-shot CLI can exit before its background review fork writes a skill; the run then looks like "no skill". Run through a driver that joins the review thread, or move the review to a channel that is awaited.
- **A cadence trigger needs a resident process.** The default nudge accumulates per finished turn and is cashed in at the *next* prompt build, so it cannot fire when each message runs in a fresh process (`agent --local`); it does fire under a resident `openclaw gateway`, and the review then runs as an **independent subagent under its own session key**, invisible in the chat turn. Look for that key in the plugin's session index before calling it a miss — a "no changes needed" assessment is still a fired trigger. Detail: `references/cadence-trigger-and-runner-residency.md`.
- **Two counters, one word "count" — never conflate them.** The *trigger* counter advances on **every** tool call regardless of name (`after_tool_call` → `recordToolCall()` increments a single turn counter; `exec` counts like any other tool), while the *skill-usage* telemetry only counts `read` / `write` / `edit` whose params carry a path inside the skills dir — so reading a skill through a shell does not move `use_count`. Symptom of mixing them: "tool X is not counted" conclusions that are true for one metric and false for the other. Prove which one you mean by reading the raw value.
- **A platform call can report success while the request was rejected.** An LLM-completion API returned `ok`, `text: ""`, and zero usage on every attempt; provider logs showed the requests were failing upstream (401, no credential rotation on that path). The adapter resolved transport failures as an empty result rather than raising, and the host then suppressed usage because the text was empty — so the caller's view was "it ran, it just answered nothing". When a completion-shaped call comes back empty-but-successful, **serialize the whole return value (`Object.keys(res)`) and correlate the run's provider status codes by run id** before concluding anything about the API or the model.
- **Read the raw counter, don't infer it from a side effect.** A threshold verdict can be read directly: add one temporary diagnostic line at the counter increment (`logger.info("[diag-count] tool=… turnCalls=… turnsSinceSkill=…")`), run one turn, grep the log, then revert. In-process state means the value lives only as long as the resident process; a per-message process starts at zero every time. The diagnostic edit is throwaway — verify the revert (`grep -c EXP-PROBE` → 0) before reporting.
- **Completion injection is heuristic.** A tool-result injection after N calls can land before the task ends or be ignored — measure it as its own channel, and its own gate: the instruction's own words ("if you are still mid-task, ignore this") are a legitimate reason for the model to skip it at call #3. A harness-driven follow-up turn is not the framework's automatic behavior.
- **The review payload is self-contained — don't infer cross-run memory.** Each review request carries a fresh inventory snapshot, so a reviewer reporting "12 skills now, up from 4" proves nothing about what it saw last time. Verify continuity claims against the request/response transcript, not against a plausible-sounding sentence.
- **Windows verifier encoding.** Verifiers that call `Path.read_text()` without an encoding fail on UTF-8 agent output under a GBK locale, producing false zeros. Run the verifier in Python UTF-8 mode (`PYTHONUTF8=1`) and keep the dataset verifier byte-identical.
- **Agents edit graders.** The workspace copy of a verifier is untrusted. Score from the original verifier and record a tampering flag; never grade the workspace copy.
- **Gateway cold start.** An isolated gateway can need more than two minutes to listen. Use a 300–360s timeout, choose a free loopback port, and write gateway logs to a file for post-mortems.
- **Provider config merge.** Reusing a provider id that also exists in the user's global config can silently select another API key. Use a benchmark-unique provider id.
- **Variant tasks hide in `variants`.** A task entry can nest several variants; a top-level loop ignores them. Flatten variants and let each variant select its own verifier.
- **Network-dependent tasks need offline fixtures.** Pre-seed the fixture directory, add a "do not use the network" instruction, and map each variant to its source file; otherwise low scores measure the environment, not skill generation.
- **Single runs are noisy.** Repeat each case (three runs is a reasonable start), then report mean and spread; otherwise model variance reads as a framework difference.
- **Split generation from evaluation.** One script that both produces and reuses skills hides which half failed. Keep a generator that produces packages and an evaluator that injects them across variants and rounds; let the evaluator import the generator's helpers instead of duplicating them, and document that dependency.
- **No package means no skill-effect claim.** If a framework's evolution run reports `skill_triggered=false`, it produced no candidate package; its baseline score must not be presented as a skill effect. Report the missed generation separately.
- **Cross-product needs a label.** An evaluator that tests every candidate under every framework measures cross-framework transfer, not framework-matched transfer; state which comparison the numbers represent.
- **Variant expected outputs must be explicit.** Inheriting the base task's `expected_outputs` for a variant whose file names differ produces false `required_output_missing` classifications. Use the variant's own list; when it has none, disable the missing-output heuristic and rely on the verifier score.
- **Leak check the generated skill.** A skill generated on one variant tends to hardcode that variant's file names or paper titles. Scan its text for other variants' tokens before judging transfer; a leaked skill is an overfitting result, not a model-capability result.
- **Judge can return empty content.** A reasoning judge may spend the whole `max_tokens` on thinking, leaving `message.content` null and crashing the JSON parse. Disable thinking for the judge request (`chat_template_kwargs: {"enable_thinking": false}`), fall back to `reasoning_content`, and retry with a larger budget; verify one previously failing case now scores.
- **The workspace verifier leaks ground truth.** Copying a grader into the generation workspace lets the agent read expected answers and write them into the skill, inflating task and judge scores. Keep gradable verifiers out of the generation workspace, or run a ground-truth leak scan over the generated skill before claiming a capability result.
- **Exclude `api_error` cells from paired stats.** A mid-matrix connection failure yields 0-token `api_error` cases; if either arm of a variant pair is invalid, drop the pair instead of averaging it, and rerun only the invalid cells.
- **Bulk replace can hit the helper you just added.** Replacing a repeated prompt line with `replace_all` also rewrote the same line inside the new helper, creating infinite self-recursion while `py_compile` still passed. After a bulk edit, trace one call path or run a stubbed smoke to prove it terminates.
- **Token accounting differs by channel.** Native review forks and follow-up turns consume tokens differently; report them separately or label the total as a trend.

## Verification

After one evolution case, a new `SKILL.md` must exist under the framework's skill directory, `skill_triggered` must be true, and the task score must come from the original verifier. Baseline cases must not create a `SKILL.md`. After editing either harness script, run `py_compile` plus a `--dry-run` for both, then one live smoke case per framework; compile alone misses self-recursion and import-wiring defects.
