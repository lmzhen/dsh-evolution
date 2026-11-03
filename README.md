# dsh-evolution

> Task-oriented skill evolution for DeepSeek Harness: the model grows a private skill set for your environment, preferences and workflows.

## What this plugin is for

The first time you ask an agent to do something, you explain a lot: which package manager the project uses, what checks must pass before a release, which directory not to touch, where to look when something fails. By the tenth time, those explanations have settled, but the model still does not know them. You repeat yourself, or you do the work yourself.

A general model can learn how to publish an npm package. It cannot know that your repository requires three specific scripts before a release, or that one branch must never be touched. That is not general capability; it is process knowledge that only holds for this person and this project. dsh-evolution is meant to keep that kind of knowledge: it turns a working practice into a skill, brings the skill back on the next similar task, and lets it be revised or retired as the work changes.

It is not a plugin for making the model smarter, and it is not a general skill marketplace. It is a private skill mechanism for people who use Harness to get work done, not for casual chat.

## What is a skill?

Prompt engineering began as a way to state a request precisely: persona, task, format, examples, all in one prompt. The more professional the prompt, the more professional the answer tended to be.

Chain-of-thought changed the economics of single-step generation. The model could recall terminology and standards inside its reasoning, so a fully specified persona-and-task prompt mattered less. Tool calling changed the shape of the work again. The model now completes a sequence of operations, and it still needs to know what comes first, what comes next, what counts as done, and how to recover. At that point the prompt looks less like a character sheet and more like an operating manual.

Different tasks need different manuals, and they cannot all live in the context window. The usual industry answer is to give the model different prompts per scenario and per step, wiring inputs and outputs into fixed workflows. Once a model can select capabilities by name and description, another option appears: package the instructions themselves as a module that is discovered and loaded on demand. A skill is that module: an operating manual for the model, plus the scripts, templates and reference files it needs. The model finds it by name and description, loads it when relevant, and follows its steps.

MCP and skills are not the same thing. MCP is a protocol for connecting tools and resources. A skill is the layer that tells the model when and in what order to use those tools, and what "done" means for this task.

## Why this plugin exists

Two changes are happening at once.

First, the value of generic skills is falling. Public, widely useful manuals are being absorbed into model capability. One-shot completion of generic tasks is becoming normal, and a separate generic skill buys less and less.

Second, models can now extract skills from execution traces. Given real trajectories and clear feedback, a capable model can produce a usable manual. Work that used to require a person to organize is now partly within the model's reach.

The conclusion is not that skills are dead. It is that generic skills matter less and private skills matter more. Every user has a different machine, project, set of preferences and set of task details. After general capability is sufficient, the difference between a good and a mediocre result is often knowledge that only holds for that person or that project. That knowledge grows, changes shape, duplicates itself and goes stale. Curating it by hand does not scale.

The plugin hands that work to the model's semantic ability, while keeping the automation bounded: writes pass gates, deletions can be recovered, and the user can step in at the points that matter.

## How it relates to memory plugins

They are mostly complementary.

A memory plugin manages facts: who the user is, what the project is, what was decided. That helps in conversation and in task execution alike. This plugin manages process: how a job should be done, in what order, and to what standard. It is for people who use Harness to finish work.

The plugin does include a memory module, but it deliberately goes against the usual "retrieve on demand, grow forever" design. Memory has a hard character limit: once it is full, new writes are refused, and the model must delete, compact or merge existing entries before writing again. Memory is also injected in full, not retrieved on demand. The reason is simple: this is a task-oriented plugin. If a critical fact is only fetched "when needed," the model may never see it. Full injection guarantees it sees the fact, and the hard limit keeps the injection bounded, so it does not drown the context or burn an unreasonable number of tokens.

The trade-off is deliberate: memory should be small and complete; skills should be specific rather than generic.

## What it can do with skills

These capabilities share one job: skills form while work is happening, then get used and maintained. The starting point is a review at a threshold. When a task has run long enough, the review decides whether the process contains something worth keeping. If it does, the model creates or updates a skill. Everything else exists to make that loop work.

| Part | Role | What the user sees |
|---|---|---|
| Automatic generation | Main loop | A review at a threshold; if the work contains a reusable practice, a skill is created or updated |
| Use | After generation | The model finds and loads the relevant skill on the next similar task |
| Update after use | After a task | A skill used in the session turns out to be incomplete or outdated; the review patches it |
| Structure | On demand | A skill that is too long or overlapping is split, merged or rewritten |
| Lifecycle | Long term | Stale or duplicate skills are archived or deduplicated, and can be restored |
| Safety | Read/write boundary | Checks before writes; optional approval; versions, undo and restore |
| Diagnosis | Support | Doctor and reports show status, structure and relationships |

### Automatic generation: from work to skill

By default, after roughly ten tool calls and at the end of a task, a review looks at the session and asks whether it contains a reusable practice. If it does, the model creates a skill or updates an existing one. The threshold and trigger can be adjusted, but the order is fixed: a real task trajectory comes first, and the decision to keep something comes second.

The model does the writing; the user does not call a write tool. Restructuring is used only when a skill is too long, and checks and versions exist so that automatic writes can be reversed. What the user gets is not "a tool was called"; it is a usable practice the next time the same kind of task comes up.

### Use: let the model find it next time

Once a skill exists, the next problem is discovery. By default, the plugin publishes the whole skill catalog to the platform, and the model loads a skill body by name through the native `skill` tool. The plugin does not trim the catalog on demand.

As the library grows, a full catalog stops being a good deal. At that point `skill_search` can retrieve candidates, and discovery's domain cards and catalog trimming can change what the model sees at once. That second option is off by default and depends on model and projection conditions. It solves "how to find something in a large library," not "guarantee the right skill is chosen"; execution still belongs to the model and the tools it calls.

### Update after use: write the correction back

A review does more than create new skills. It checks which skills were actually loaded or used in the session. If one is missing a step, has gone stale, or conflicts with the user's preferences, the review patches that skill before considering a new one. A new skill is created only when no existing skill can absorb the lesson.

This is not a live edit in the middle of a task. The fix lands at the next review, triggered by the threshold or the end of the task. The review only changes skills it actually loaded or used; creating a new skill for a new class of task is the exception. In the current implementation, "used" is tracked mainly through the platform's `skill` tool. Whole-library views through management tools do not count as a per-skill read, and direct writes are not hard-blocked; they still depend on the model following the read-before-write rule. That is the current boundary.

### Structure: split, merge, rewrite

A generated skill will not always have the right shape. If it is too long or covers too many jobs, split it. If two skills overlap heavily, merge them. If a skill uses an old format, path or section structure, rewrite or migrate it.

These are on-demand repairs, not steps every skill must go through. Splitting and rewriting go through normal writes; the split and extract commands under `/evolution` are a separate path, and their approval point is not necessarily identical. Merge is its own flow, with candidate screening, a commit and a receipt; it does not use ordinary write approval.

### Lifecycle: libraries age

After a while, the problem shifts from "what should be written" to "what should stay."

The curator marks stale skills and archives them on a time and idle schedule, and merges near-duplicates. It snapshots first; on failure it writes a report and does not roll back the whole tree. Restore is explicit. Deletion is an archive, not a hard delete.

Pin and protection markers are meant to keep selected skills out of automatic curation. The exact coverage depends on the current implementation. Curation has scheduling and reports, but notification and explanation are incomplete: a run may not announce itself in the conversation, and a skill may simply disappear from the list.

### Safety: where automation stops

Automatic generation means the model judges and writes on its own, so the write boundary matters.

The question is not whether the user trusts the model. It is where automation should stop when the model makes more semantic decisions and the user has limited time and attention. Low-risk, reversible actions can run automatically. Critical writes can wait for a person. Skill writes leave versions; deletion is an archive; one skill can be undone and the whole tree restored. Writes pass structural gates, policy protection and threat scanning.

The current implementation does not fully deliver that balance. Approval is off by default and covers only staged memory/skill writes. The curator's and merger's own writes do not pass through it. Pending work is mainly visible in forms that have a settings page; notification and an inbox are incomplete.

### Diagnosis: check that it is working

`/evolution doctor` shows the install form, version, connections and service state. It cannot prove that memory/skill tools actually work; a real write or edit is still the test.

Health, drift, the knowledge graph and reports show another layer: structure, references, usage and relationships. They are for troubleshooting and long-term maintenance, not daily entry points, and they do not repair anything automatically.

These capabilities have a natural order in use, but not a mandatory workflow, and they are not equally mature. Automatic generation and versioned rollback are the main path; retrieval, domain cards, curation notifications, merge defaults and cross-form UI are still basic or conditional.

## Install

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# restart dsh, then in any session:
/evolution doctor
```

After the restart, ask the agent to remember something:

> Remember that this repository uses pnpm and tests run with `pnpm test`.

Open a new session. If the fact is still there, the basic loop works. Try the rest after that.

## Forms

| What you want | Install | What changes |
|---|---|---|
| Full use | `@lmzhen/dsh-evolution-all` | memory and skill tools in every session, plus settings and panels |
| Automation only | `@lmzhen/dsh-evolution-host` | curation and reports run; the agent cannot write memory/skills, and review/usage do not run |
| Tools in selected sessions | `host` + `agent-preset` + `/evolution preset install` | only sessions using the Evolution preset get the tools |
| Migration from the old setup | `@lmzhen/dsh-evolution-preset` | close to all, without the settings page or three sidebars |

Only one form per profile. Uninstall before switching. The exact differences are in [packages/INSTALL.md](packages/INSTALL.md).

## Day to day

Memory is the simple part. Ask the agent to remember a fact, or let it decide one is worth keeping. It writes to `MEMORY.md` and `USER.md` under `$DSH_HOME/memories/`, and later sessions get a snapshot. The budget is configurable in settings.

Skills are the working part. The agent writes a repeated procedure down, then patches, splits or archives it. Use `/evolution skill history <name>` to inspect versions and `/evolution skill undo <name>` to go back. Deletion is an archive.

Review and curation run in the background. Review adds one model round at the end of a task, after roughly ten tool calls by default; raise the interval or turn it off if that is too much. Curation archives stale skills and merges near-duplicates on a time and idle schedule. It snapshots first and archives instead of deleting. It may not announce itself in the conversation, so check `/evolution curator status` and `/evolution curator report`.

Merge is separate. When two skills overlap, they can be combined. The default accepts and writes the merge automatically; turn on `mergeApproval` if you want to confirm each one. It needs a local merge model and will not download one. Merge has its own flow and does not use ordinary write approval.

Approval is off by default. When on, it covers staged memory/skill writes only; the curator's and merger's own writes do not go through it. The everyday commands are `/evolution pending`, `/evolution approve <id>` and `/evolution reject <id>`.

## Commands

| Command | When you need it |
|---|---|
| `/evolution doctor` | after install/upgrade, or when something looks missing |
| `/evolution pending` | see writes waiting for approval |
| `/evolution skill history <name>` | inspect or undo a skill change |
| `/evolution curator status` | check whether curation is due |
| `/evolution merge pending` | see the merge queue |
| `/graph` | browse and edit the skill and memory graph |

Advanced commands (maintenance scans, replay, preset install, extraction) are in [docs/commands.md](docs/commands.md). You do not need them for daily use.

## Settings

Most defaults are fine. The ones people actually change are approval, memory budget, review interval and curation interval.

The settings page exists only in the all + Web setup. Host, preset and layered use commands or the profile config instead. The full list is in [docs/configuration.md](docs/configuration.md).

## Privacy and safety

No telemetry and no hosted service. Data stays under `$DSH_HOME`.

The model can write memory and skills, but not policy, prompts, routing or audit history. Skill deletion is an archive; restore and undo are explicit. Merge keeps a receipt. Threat scanning runs before memory/skill writes, even when approval is off.

## Compatibility

| | Value |
|---|---|
| Validated platform line | **`0.2.1-rc.3`** |
| Published dependency window | `^0.2.1-rc.2` |
| Family version | `0.32.5` |
| Node | 22.19+ or 24+ |

Only this platform generation is supported; older prerelease lines fail at dependency resolution. Install details are in [INSTALL.md](INSTALL.md).

## Documentation

- [Start here](docs/getting-started.md) — install, first memory, first skill.
- [What it does](docs/features.md) — memory, skills, review, curation and merge in practice.
- [Commands](docs/commands.md) — everyday and advanced commands.
- [Settings](docs/configuration.md) — approval, budgets, intervals.
- [Model/API keys](docs/api-keys.md) — which features need a model, and how to configure it.
- [Operations](docs/operations.md) — backup, upgrade, uninstall, doctor.
- [Troubleshooting](docs/troubleshooting.md) — symptoms and the matching action.
- [Install details](INSTALL.md) — the four forms and upgrade order.
- Maintainers only: `packages/README.md` contains the package map and canonical facts, not user documentation.

## Known boundaries

- Host has no memory/skill tools, and its automatic review/usage do not run. Use all or the layered preset for those.
- Approval is off by default, and even when on it covers staged memory/skill writes only.
- The settings page and three sidebars ship only with all + Web.
- The skill-health panel is disabled by default in the full bundle.
- If a feature needs a model or a local merge model, it fails with a message instead of pretending to work.
