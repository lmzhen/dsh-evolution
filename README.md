# dsh-evolution

> Task-oriented skill evolution for DeepSeek Harness: the model grows a private skill set for your environment, preferences and workflows.

## What this plugin is for

dsh-evolution is built around **automated skill generation and full-lifecycle skill management**. It is for accumulating personal capability, not for making a model better at casual conversation.

The model should get better at doing work *your* way: your machine, project conventions, habits, and the details of your recurring tasks. Once general capability is strong enough, the valuable layer becomes a private skill set that grows with the variety and complexity of your work. Managing that set by hand does not scale.

The plugin treats skill creation, use, review, patching, splitting, merging, archiving and restoring as a set of auditable capabilities, not a fixed sequence. It uses the model's semantic ability to run them where possible, gives the user a choice to approve critical writes, and makes deletion an archive rather than a hard delete.

## What is a skill?

Early language models rewarded precise prompts: a more professional question or instruction usually produced a more professional answer. That was the era of prompt engineering.

Chain-of-thought changed the economics of single-step generation: the model can recall relevant terminology and standards inside its reasoning, so a fully specified persona-and-task prompt matters less. Tool calling then changed the task shape again. The model now completes a sequence of operations, and it still needs to know what to do first, what comes next, when it is done, and how to recover. The prompt becomes less like a character sheet and more like an **operating manual**.

Different tasks need different manuals, and they cannot all live in the context window. The common industrial answer is to give the model different prompts per scenario and per step, wiring inputs and outputs into fixed workflows. Once models can select capabilities by name and description, another option appears: package the instructions themselves as a module that is discovered and loaded on demand. **A skill is such a packaged operating manual, plus the scripts, templates and reference files it needs.** The model finds it by name and description, loads it when relevant, and follows its steps.

MCP and skills are not the same thing. MCP is a protocol for connecting tools and resources. A skill is the layer that tells the model when and in what order to use those tools, and what "done" means for this task.

## Why this plugin exists

Two changes are happening at the same time:

1. **Generic skills are being absorbed into model capability.** Public, widely useful manuals increasingly become part of what the model already knows. One-shot completion of generic tasks is becoming normal, and the marginal value of a generic skill falls.
2. **Models can now extract skills from execution traces.** Given real trajectories and clear feedback, a capable model can produce a usable operating manual.

The consequence: **the marginal value of generic skills is falling; private skills are becoming the differentiator.**

Real environments differ. Machines, project conventions, personal preferences and the details of complex tasks vary from user to user. After general capability is sufficient, the difference between a good and a mediocre result is often this private process knowledge. That knowledge grows, changes shape, and cannot be curated by hand. The plugin automates its generation and lifecycle with the model's semantic ability, while approval, versions, archives and undo keep the automation from running out of control.

## How it relates to memory plugins

They are almost entirely complementary.

A typical memory plugin manages **facts**: who the user is, what the project is, what was decided. That helps in conversation and in task execution alike. This plugin manages **process**: how a job should be done, in what order, and to what standard. It is mainly for people who use Harness to get work done.

The plugin does include a memory module, but it deliberately inverts the usual "retrieve on demand, grow without bound" design:

- **A hard character cap.** When the cap is reached, new writes are refused; the model must delete, compact or merge existing entries to make room before writing again.
- **Full injection into the context.** Memory is not retrieved on demand; it is injected in full. For a task-oriented plugin, a critical fact that is only fetched "when needed" may never be seen. Full injection guarantees the model sees it, and the cap keeps the injection bounded: large enough not to lose the essentials, small enough not to hurt model performance or blow up context cost.

The trade-off is deliberate: **memory should be small and complete; skills should be specific rather than generic.**

## What skill-facing capabilities does it provide?

First, a correction: **a skill is not a pipeline.** Creation does not have to follow use, review does not always produce a skill, curation may not run for weeks, and merging only matters once duplicates have accumulated. Presenting these as `create, use, review, patch, split, merge, archive, restore` suggests a sequence every skill must follow; in practice they are different work surfaces used by different actors at different times.

The useful split is by responsibility:

| Surface | Who/when | Output | Current boundary |
|---|---|---|---|
| Authoring | explicit user request, or the agent judges a workflow worth keeping | new skill, rewrite, patch, support files | create/edit/archive exist; versions and undo are the necessary companion |
| Retrieval | when the library grows and the full catalog stops fitting well | search results, domain cards, a trimmed catalog | `skill_search` works independently; domain cards need discovery, off by default |
| Structure | on demand, when a skill is too long, overlapping or outdated | split, merge, migrated skill | merge is a separate flow; it does not use the ordinary write approval |
| Curation | time/idle schedule | stale/archive, near-duplicate merge | scheduling and reports exist; notification/inbox is incomplete |
| Control | every write; approval when enabled | gates, approval, versions, undo | approval covers staged memory/skill writes only |
| Diagnosis | troubleshooting and long-term maintenance | status, health, references, relationships | reports only; doctor cannot replace a real write test |

The six surfaces are not equally mature: authoring and versioned rollback are relatively complete; retrieval, domain cards, curation notifications, merge defaults and cross-form UI are still basic or conditional. This section describes the division of responsibility, not a claim that every surface is finished.

### 1. Authoring: turn experience into a skill, or change an existing one

This is the write surface. It answers: how does a working practice become something the model can reuse?

- The user asks for a skill to be written, or the agent decides a workflow is worth keeping;
- `skill_manage` creates, edits, patches and archives skills; support files under references, scripts, templates and assets are written here too;
- a long skill can be split: `restructure` moves sections into references, `extract` turns a section into a child skill or reference;
- every write goes through the gates and leaves a version; deletion is an archive.

This surface is about writing the skill correctly. It does not make the skill visible to the model, and it does not clean up old skills.

### 2. When the library grows: an optional retrieval/trimming mode

This surface is not about "making the model use the right skill at the right time." It answers a narrower question: **when automatically generated skills become numerous enough that handing the model the full catalog stops working well, is there an alternative mode?**

- By default, the plugin publishes the skill tree to the platform catalog; the model loads the full body by name through the platform's native `skill` tool. By default it publishes the visible skill catalog and does not trim it on demand.
- As the library grows, `skill_search` provides retrieval, and discovery's domain cards/trimming provide another organization, so the model does not have to see every skill at once.
- This is not the default path: `skill_search` is a separate tool; domain cards and trimming require discovery to be enabled and depend on model/projection conditions. Discovery is off by default.

So this is a **conditional, optional capability**, not a guarantee that the plugin picks the right skill on every task. If the model did not load a skill, that may be a weak description, a trigger mismatch, or simply a task that did not need it. The plugin supplies the catalog, body, search and trimming; execution is still done by the model and the tools it calls.

### 3. Structural refactoring: split, merge, migrate

This surface answers: the skill exists, but its shape is wrong. It is an on-demand edit, not a daily lifecycle step.

- **Split**: a skill is too long or covers too many jobs; create a parent and children, or move details into references;
- **Merge**: two skills overlap heavily; combine them into one more complete skill;
- **Rewrite/migrate**: bring old formats, paths or section structures into the current shape; today this is done mainly through rewrite/patch, not a separate migration engine.

Splitting and rewriting through `skill_manage` use the ordinary write gates, approval and versions; `restructure`/`extract` from `/evolution` are a separate command path, and their approval point should not be assumed identical to `skill_manage`. Merge is a separate flow with its own candidate screening, commit and receipt; it is not covered by the ordinary write approval. A merge is not "the end of the lifecycle"; it is one restructuring of duplicate material. These operations usually appear after a library has grown, not for every skill.

### 4. Keeping the library usable

This surface answers: which skills are still useful, and which should leave.

- usage evidence comes from views, patches and support-file reads;
- the curator marks stale skills and archives them on a time/idle schedule, and merges near-duplicates; it archives rather than hard-deletes;
- pin/protection markers are intended to keep selected skills out of curation; the exact coverage depends on the current implementation;
- health, drift and graph views are observations: they report, they do not repair.

The distinction is: **refactoring changes the shape of one skill or a group; curation decides which skills remain in the library.** Merging happens when there is duplication; curation happens when skills go unused or degrade. They are not consecutive steps on one line.

The current implementation already has scheduled curation and reports, but notification/explanation is incomplete: a curation run may not announce itself in the conversation, and a skill may simply disappear from the list. This surface is closer to "background execution plus reports" than to a complete inbox experience.

### 5. Balancing semantic automation with user attention

This surface is not "why should the user trust the model?" It is the more practical question: **when the model makes more and more semantic decisions and the user's time and attention are limited, how do we keep automation inside the range the user is willing to accept?**

The design split is:

- low-risk, reversible actions can be automatic, so the user does not approve every detail;
- critical writes can wait for human confirmation, saving attention for the moments that matter;
- skill writes leave versions; deletion is an archive; a single skill can be undone, the whole tree restored;
- writes pass structural gates, policy protection and threat scanning;
- reports and diagnostics try to explain what happened, instead of making the user infer it from results.

The current implementation does not fully deliver that balance: approval is off by default, covers only staged memory/skill writes, and does not cover the curator's or merger's own writes; pending work is mainly visible in forms that have the settings page, without a complete notification/inbox; explainability is concentrated in reports and commands rather than every action. This section describes the design direction and current coverage, not a claim that the balance is complete.

### 6. Observation and diagnosis

This surface answers: what is going on right now?

- `/evolution doctor` shows install form, version, connections and service state; it cannot prove that memory/skill tools actually work, so a real write or edit is still the verification;
- health, drift, graph and reports show structure, references, usage and relationships;
- these are for troubleshooting and long-term maintenance, not daily task entry points, and they do not replace a real write test.

**In one line: authoring keeps the practice, retrieval keeps a large library findable, refactoring gives it the right shape, curation decides what stays, control makes it reversible, and diagnosis explains it.** They can be combined in any order; they are not six mandatory stages.

## Install

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# restart dsh, then in any session:
/evolution doctor
```

After the restart, ask the agent to remember something:

> Remember that this repository uses pnpm and tests run with `pnpm test`.

Then open a new session. The fact is already there. That is the smallest useful loop: **remember, reuse, improve**.

## Four ways to use it

| What you want | Install | What you get |
|---|---|---|
| The full experience (recommended) | `@lmzhen/dsh-evolution-all` | memory and skill tools in every session, plus settings and panels |
| Automation only, no model write tools | `@lmzhen/dsh-evolution-host` | curation and reports run; the agent cannot write memory/skills, and review/usage do not apply |
| Tools only in selected sessions | `host` + `agent-preset` + `/evolution preset install` | the Evolution preset carries the tools; other sessions stay untouched |
| Old one-click setup | `@lmzhen/dsh-evolution-preset` | compatibility form; no settings or sidebar panels |

Do not mount two forms in one profile. Uninstall one before installing another. The precise per-form semantics live in [packages/INSTALL.md](packages/INSTALL.md); this page does not restate them.

## What you will actually use

### Memory

Ask the agent to remember a fact, or let it notice one. It writes `MEMORY.md` / `USER.md` under `$DSH_HOME/memories/`; later sessions get a short snapshot automatically. You can cap the size in settings (all + Web setup).

### Skills

Ask the agent to turn a repeated procedure into a skill. It can create, patch, split, merge and archive skills. Use `/evolution skill history <name>` and `/evolution skill undo <name>` when a change was wrong.

### Review

At natural checkpoints the agent reviews what just happened and proposes an improvement. It runs in the session by default; it is not a per-message interruption. You can change the cadence or turn it off.

### Curation

A periodic curator marks stale skills, archives what stopped being used, and merges near-duplicates. It snapshots first and archives instead of hard-deleting. Use `/evolution curator status` and `/evolution curator report` to see what it did.

### Merge

If you enable merging (it needs a local model), overlapping skills can be proposed for a merge. By default the merge is accepted automatically and committed; turn on approval if you want to approve or reject each one. The result can be undone. The merge panel is read-only; it shows the queue and copies the command.

### Approval

Approval is off by default. Turn it on when you want every memory/skill write to wait for you. Then `/evolution pending`, `/evolution approve <id>` and `/evolution reject <id>` are the whole workflow.

## Everyday commands

| Command | When to use it |
|---|---|
| `/evolution doctor` | after install/upgrade, or when something looks missing |
| `/evolution pending` | see writes waiting for approval |
| `/evolution skill history <name>` | inspect or undo a skill change |
| `/evolution curator status` | see whether automatic cleanup is due |
| `/evolution merge pending` | review merge proposals |
| `/graph` | browse and edit the skill/memory graph |

There are advanced commands too (maintenance scans, replay, presets, extraction). They are documented in [docs/commands.md](docs/commands.md); you do not need them for daily use.

## Settings you may want to change

- **Approval**: on/off, and whether approving asks again (only in the all + Web setup).
- **Memory budget**: how much project memory and user profile to keep.
- **Review cadence**: how often the agent reflects, or turn it off.
- **Curator interval**: how often stale skills are archived/merged.

Everything else has a sensible default. The full list of user-facing knobs is in [docs/configuration.md](docs/configuration.md).

## Privacy and safety

- No telemetry and no hosted service; data is written under `$DSH_HOME`.
- The model can write memory and skills only. Policy, prompts, routing and audit history are not model-writable.
- A skill delete archives; restore and undo are explicit. A merge keeps its receipt.
- Threat scanning runs before memory/skill writes, even when approval is off.

## Compatibility

| | Value |
|---|---|
| Validated platform line | **`0.2.1-rc.3`** |
| Published dependency window | `^0.2.1-rc.2` |
| Family version | `0.32.5` |
| Node | 22.19+ or 24+ |

The platform line is one supported generation; older prerelease lines fail at dependency resolution. Current install details are in [INSTALL.md](INSTALL.md).

## Documentation

- [Start here](docs/getting-started.md) — 10 minutes from install to the first remembered fact.
- [What it does](docs/features.md) — the five loops, told from the user side.
- [Commands](docs/commands.md) — everyday and advanced commands.
- [Settings](docs/configuration.md) — approval, budgets, cadence.
- [Model/API keys](docs/api-keys.md) — which features need a model, and how to configure it.
- [Operations](docs/operations.md) — backup, upgrade, uninstall, doctor.
- [Troubleshooting](docs/troubleshooting.md) — symptoms and the matching action.
- [Install details](INSTALL.md) — the four forms and upgrade order.
- For maintainers only: `packages/README.md` (package map and canonical facts; not user documentation).

## Known boundaries

- The **host** form has no memory/skill tools, and its automatic review/usage do not run. Use all (or the layered preset) if you want those.
- Approval is off by default; turn it on if you want a human gate.
- Only the **all** form ships the settings page and the three sidebar panels; preset and host do not.
- The skill-health panel ships disabled in the full bundle; enabling it is a configuration change, not a daily switch.
- If a feature needs a model or a local merge model, it fails with a message instead of pretending to work.
