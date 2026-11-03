# dsh-evolution

> Task-oriented skill evolution for DeepSeek Harness: the model grows a private skill set for your environment, preferences and workflows.

## What this plugin is for

dsh-evolution is built around **automated skill generation and full-lifecycle skill management**. It is for accumulating personal capability, not for making a model better at casual conversation.

The model should get better at doing work *your* way: your machine, project conventions, habits, and the details of your recurring tasks. Once general capability is strong enough, the valuable layer becomes a private skill set that grows with the variety and complexity of your work. Managing that set by hand does not scale.

The plugin turns **create → use → review → patch → split → merge → archive → restore** into an auditable loop. It uses the model's semantic ability to run that loop where possible, gives the user a choice to approve critical writes, and makes deletion an archive rather than a hard delete.

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

## Install

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# restart dsh, then in any session:
/evolution doctor
```

After the restart, ask the agent to remember something:

> Remember that this repository uses pnpm and tests run with `pnpm test`.

Then open a new session. The fact is already there. That is the smallest useful loop: **remember → reuse → improve**.

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
- [Troubleshooting](docs/troubleshooting.md) — symptom → action.
- [Install details](INSTALL.md) — the four forms and upgrade order.
- For maintainers only: `packages/README.md` (package map and canonical facts; not user documentation).

## Known boundaries

- The **host** form has no memory/skill tools, and its automatic review/usage do not run. Use all (or the layered preset) if you want those.
- Approval is off by default; turn it on if you want a human gate.
- Only the **all** form ships the settings page and the three sidebar panels; preset and host do not.
- The skill-health panel ships disabled in the full bundle; enabling it is a configuration change, not a daily switch.
- If a feature needs a model or a local merge model, it fails with a message instead of pretending to work.
