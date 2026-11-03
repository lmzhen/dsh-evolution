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

# dsh-evolution

> Automated skill generation and long-term skill management for DeepSeek Harness.

## What this plugin is for

It is for people who use Harness to get work done, not for casual chat.

General models already handle a lot of standard work. What they do not know is your machine, your project conventions, the way you like to work, and the details of the tasks you repeat. Those details decide what "done" means in practice. dsh-evolution turns them into skills, then keeps those skills alive as the work changes.

It is not a plugin for making the model smarter, and it is not a general skill marketplace. It is a private skill mechanism: the model writes down a working practice, uses it next time, and eventually revises, merges or retires it.

## What a skill is

A skill is not a model, and it is not MCP. MCP is about what tools the model can reach. A skill is about how a job should be done.

Early prompt engineering tried to put the persona, task, requirements and format into one prompt. Chain-of-thought made that less necessary for single-step generation: the model can fill in a lot of terminology and standards while reasoning. Tool calling changed the shape again. The model now has to carry out a sequence of operations, and it still needs to know the order, the boundaries, the checkpoints and what to do when something fails. At that point the prompt starts to look like an operating manual.

You cannot put every manual in the context window. One common answer is to split prompts by scenario and by step and wire them into a fixed workflow. Once a model can select capabilities by name and description, another answer appears: package the manual itself as a module and load it when needed. A skill is that module: instructions for the model plus the scripts, templates and reference files it needs. The model finds it by name, loads it, and follows it.

## Why this plugin exists

Two changes are worth looking at together.

First, the value of generic skills is falling. Public, widely useful manuals are being absorbed into model capability. One-shot completion of common tasks is becoming normal, and a separate generic skill buys less and less.

Second, models can now extract skills from execution traces. Given real trajectories and clear feedback, a capable model can produce a usable manual.

The conclusion is not "skills are dead." It is that generic skills matter less and private skills matter more. Every user has a different machine, project, set of preferences and set of task details. The thing that decides whether a job goes well is often knowledge that only holds for that person or that project. That knowledge grows, changes shape, duplicates itself and goes stale. Curating it by hand does not scale.

The plugin hands that work to the model's semantic ability, but automation is not the same as letting go. Writes still pass gates, deletions can be recovered, and the user can step in at the points that matter.

## How it relates to memory plugins

They are mostly complementary.

A memory plugin manages facts: who the user is, what the project is, what was decided. That helps in conversation and in work. This plugin manages process: how a job should be done, in what order, and to what standard. It is for people who actually use Harness to finish things.

The plugin does have a memory module, but it deliberately goes against the usual "retrieve on demand, grow forever" design.

Memory has a hard character limit. Once it is full, new writes are refused; the model has to delete, compact or merge something first. Memory is also injected in full, not retrieved on demand. The reason is simple: this is a task-oriented plugin. If a critical fact is only fetched "when needed," the model may never see it. Full injection guarantees it sees the fact, and the hard limit keeps the injection bounded, so it does not drown the context or burn an unreasonable number of tokens.

The trade-off is deliberate: memory should be small and complete; skills should be specific rather than generic.

## What it does around skills

These capabilities are not a pipeline. Creation does not have to follow use, review does not always produce a skill, curation may not run for weeks, and merging only matters once duplicates have accumulated. A fixed sequence of "create, use, review, patch, split, merge, archive, restore" makes it sound like every skill goes through every step. It does not.

A more honest way to describe it is by the problem each capability solves.

### Writing and editing skills

This is the write path. The user can ask for a skill to be written, or the model can decide that a workflow is worth keeping. Creating, editing, patching, writing support files and archiving all go through `skill_manage`. When a skill gets too long, `restructure` can move sections into references, and `extract` can pull part of it into a child skill or a reference. Writes pass gates and leave versions; deletion is an archive, not a hard delete.

This path is responsible for writing the skill correctly. It does not make the skill visible to the model, and it does not clean up old skills.

### What happens when there are too many skills

By default the plugin publishes the whole skill catalog to the platform, and the model loads a skill body by name through the native `skill` tool. The model sees the catalog; the plugin does not trim it on demand.

At some point a full catalog stops being a good deal. Then `skill_search` can retrieve candidates, and discovery's domain cards and catalog trimming can change what the model sees at once. That second option is not the default. It requires discovery to be enabled and depends on model and projection conditions. Discovery is off by default.

So this is a scaling option, not a guarantee that the model picks the right skill every time. If the model does not load a skill, the description may be weak, the trigger may not match, or the task may not need it. The plugin supplies the catalog, the body, search and trimming; execution belongs to the model and its tools.

### Splitting, merging, rewriting

A skill that has already been written may have the wrong shape. Too long or too broad means split. Two skills with heavy overlap mean merge. An old format, path or section structure means rewrite or migrate.

Splitting and rewriting usually go through the `skill_manage` write path, with gates, approval and versions. The `restructure` and `extract` commands under `/evolution` are a separate command path; their approval point should not be assumed to be identical to `skill_manage`. Merge is more special: it is its own flow, with candidate screening, commit and a receipt, and it does not use the ordinary write approval.

These operations usually show up after a library has grown. Not every skill has to go through them.

### Keeping the library usable

A library accumulates skills that are no longer used, have degraded, or overlap. The curator marks stale skills and archives them on a time and idle schedule, and merges near-duplicates. It snapshots first; on failure it writes a report and does not roll back the whole tree. Restore is explicit. Deletion is an archive, not a hard delete.

Pin and protection markers are meant to keep selected skills out of automatic curation. The exact coverage depends on the current implementation.

Curation is not the same as splitting or merging. Splitting and merging change the shape of one skill or a group; curation decides which skills remain in the library. Merging happens when there is duplication, curation when skills go unused or degrade.

The current implementation has scheduled curation and reports, but notification and explanation are incomplete. A curation run may not announce itself in the conversation, and a skill may simply disappear from the list. It is closer to "background execution plus reports" than to a complete inbox.

### Controlling writes, and getting them back

The problem here is not "why should the user trust the model?" It is more practical: the model is making more semantic decisions, while the user has limited time and attention. Where should automation stop?

The design intent is that low-risk, reversible actions can be automatic; critical writes can wait for a person; skill writes leave versions; deletion is an archive; one skill can be undone and the whole tree restored; writes pass structural gates, policy protection and threat scanning. The user should not have to approve every small thing, but should be able to get back to a known state.

The current implementation does not fully deliver that. Approval is off by default, covers only staged memory/skill writes, and does not cover the curator's or merger's own writes. Pending work is mainly visible in forms that have a settings page; notification and an inbox are incomplete. Explainability lives mostly in reports and commands, not in every action.

Those are current boundaries, not things the design says are unimportant.

### Diagnosis

`/evolution doctor` shows the install form, version, connections and service state. It cannot prove that memory/skill tools actually work. A real write or edit is still the test.

Health, drift, the knowledge graph and reports show another layer: structure, references, usage and relationships. They are for troubleshooting and long-term maintenance, not daily entry points, and they do not repair anything automatically.

These capabilities can be used alone or together. They are not six mandatory stages, and they are not equally finished. Writing and versioned rollback are relatively mature; retrieval, domain cards, curation notifications, merge defaults and cross-form UI are still basic or conditional.

## Install

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# restart dsh, then in any session:
/evolution doctor
```

After the restart, ask the agent to remember something:

> Remember that this repository uses pnpm and tests run with `pnpm test`.

Open a new session. If the fact is still there, the basic loop works. Try the rest after that.

## Choosing a form

| What you want | Install | What changes |
|---|---|---|
| Full use | `@lmzhen/dsh-evolution-all` | memory and skill tools in every session, plus settings and panels |
| Automation only | `@lmzhen/dsh-evolution-host` | curation and reports run; the agent cannot write memory/skills, and review/usage do not run |
| Tools in selected sessions | `host` + `agent-preset` + `/evolution preset install` | only sessions using the Evolution preset get the tools |
| Migration from the old setup | `@lmzhen/dsh-evolution-preset` | close to all, without the settings page or three sidebars |

Only one form per profile. Uninstall before switching. The exact differences are in [packages/INSTALL.md](packages/INSTALL.md).

## Day to day

Memory is the simple path. Ask the agent to remember a fact, or let it decide one is worth keeping. It writes to `MEMORY.md` and `USER.md` under `$DSH_HOME/memories/`, and later sessions get a snapshot. The budget is configurable in settings.

Skills are the working path. The agent can write a repeated procedure down, then patch, split or archive it. Use `/evolution skill history <name>` to inspect versions and `/evolution skill undo <name>` to go back. Deletion is an archive.

Review and curation run in the background. Review adds one model round at the end of a task, after roughly 10 tool calls by default; raise the interval or turn it off if that is too much. Curation archives stale skills and merges near-duplicates on a time and idle schedule. It snapshots first and archives instead of deleting. It may not announce itself in the conversation, so check `/evolution curator status` and `/evolution curator report`.

Merge is separate. When two skills overlap, they can be combined. The default accepts and writes the merge automatically; turn on `mergeApproval` if you want to confirm each one. It needs a local merge model and will not download one. Merge has its own flow and does not use ordinary write approval.

Approval is off by default. When on, it covers staged memory/skill writes only; the curator's and merger's own writes do not go through it. The everyday commands are `/evolution pending`, `/evolution approve <id>` and `/evolution reject <id>`.

## Everyday commands

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
