# dsh-evolution

## What is this plugin for?

The plugin is designed to generate skills automatically and manage their full lifecycle, with an emphasis on retaining capabilities that are specific to a user and a project. It is task-oriented: the model builds and maintains a private set of skills for the user's environment, preferences and working procedures, improving its fit for those tasks.

That lifecycle includes creation, discovery, use, revision after review, restructuring, merging, archiving and restoration. These are independent capabilities rather than stages every skill must pass through. The plugin also provides budgeted memory for project facts and user preferences across sessions.

It does not modify or train the model, and it does not provide a hosted model service. DSH's configured model performs the semantic work, while the plugin's write gates, snapshots, history and approval mechanisms constrain changes and recovery.

## What is a skill?

Early language models generated text autoregressively. Questions, instructions and answers were linked statistically, so prompts that described the domain, task and constraints precisely usually improved the result. That relationship was a foundation of early prompt engineering.

Chain-of-thought and stronger model capabilities reduced the need for exhaustive prompts in some single-step tasks: the model could recall terminology and conventions during reasoning. Tool calling then changed the objective again. Instead of producing one piece of content, the model had to complete a sequence of operations. Execution order, tool constraints, completion criteria and failure recovery still needed explicit instructions. The prompt increasingly resembled an operating manual rather than a complete description of one desired answer.

Different tasks need different manuals, and they cannot all remain in context. One approach is to connect step-specific prompts and inputs and outputs into a fixed workflow. Another is to package a manual as a module that the model can discover by name and description and load when relevant. That module is a skill. In DSH, a skill normally consists of a `SKILL.md` body and optional scripts, templates and reference files, loaded through the native `skill` tool.

Skills and MCP belong to different layers. MCP is a protocol for connecting tools and resources; a skill describes when to use those capabilities, in what order, and what counts as done. The plugin manages procedural knowledge, not tool connectivity itself.

## Why build this plugin?

Two related changes are taking place:

1. **The marginal value of some general-purpose skills is falling.** Public, common operating procedures are increasingly being absorbed into model capability through training. Maintaining a separate manual for those tasks yields less benefit, although this does not make every general-purpose skill obsolete.
2. **Models are becoming capable of extracting operating procedures from execution traces.** With real trajectories and clear feedback, a model can organize the steps, constraints and corrections from a task into a reusable skill. This plugin uses that capability during review and skill writing. The output still passes structural checks and may require human approval; it is not assumed to be correct merely because a model produced it.

At the same time, every user's machine, project conventions, preferences and complex task details remain different. Once general capability is sufficient, the decisive knowledge is often valid only for one person or one project. A private skill set grows with task variety and complexity, and it also develops duplication, staleness and structural problems. Maintaining all of that manually does not scale.

The plugin therefore uses the model's semantic ability to automate the generation and maintenance work that is suitable for automation, while retaining human control and recovery paths. Its objective is not unrestricted skill accumulation, but a useful, inspectable and maintainable private skill set built from real work.

## How does it relate to memory plugins?

The two are largely complementary. A typical memory plugin manages facts: who the user is, what the project is, and what was decided. This plugin is more concerned with process: how a class of task should be performed, in what order, and to what standard. It is intended primarily for people who use Harness to get work done.

The plugin also contains a memory module, but its design differs from the familiar retrieve-on-demand, continuously growing model:

- **Memory has a hard character budget.** The default budgets for project memory in `MEMORY.md` and the user profile in `USER.md` are 2200 and 1375 characters. If a batch would exceed the budget, it is refused rather than silently truncated. The model must delete or compact existing entries before adding new ones. After the budget is lowered, replacement can also be refused when an existing entry exceeds the new limit; deletion is then the recovery path.
- **Memory is supplied as a snapshot instead of relying only on deliberate retrieval.** This keeps critical project facts visible during a task instead of depending on the model to search for them.

Snapshot injection does not mean that every persisted byte necessarily reaches the model context. Entries matched by threat scanning are filtered, and abnormally large files are skipped. The character budget bounds injection size; it is not a guarantee that every task avoids performance loss or additional context cost. The design keeps critical facts within a bounded context while using skills to maintain procedural knowledge.

## What capabilities does it provide?

Each capability below has a corresponding code entry point. They have different triggers and should not be read as a pipeline that runs for every task.

| Capability | Current behavior and defaults |
|---|---|
| Skill generation and updates | The agent can create and patch skills through `skill_manage`. By default, review prompts ask the model to generate or update skills at an interval of ten weighted tool calls after substantive cadence signals, delivered at a task boundary; a review does not have to produce a new skill |
| Skill catalog and search | The full catalog is published by default and loaded through the native `skill` tool; `skill_search` provides local retrieval, while discovery domain cards and catalog trimming are off by default |
| Library curation | Curator performs deterministic lifecycle maintenance on interval and idle conditions, marking stale skills and archiving them; LLM-nominated consolidation is a separate option |
| Skill merge | Started with `/evolution merge scan` or `pair`. Scan requires local potion models and can fall back to stub without an LLM; ordinary pair does not require potion, but round 1/authoring requires a child-session model. Initiated runs are auto-approved by default, with `mergeApproval` available for manual approval |
| Memory | Available in `all`, `preset` and selected layered-preset sessions. Project memory and user-profile budgets default to 2200 and 1375 characters; new writes are refused at the limit rather than silently truncated |
| Write approval and recovery | Ordinary write approval is off by default and stages memory and skill writes when enabled; curator and merge use their own controls. Skill history, body undo, unit undo and archive restore have different scopes, and execution-time failures do not guarantee complete rollback |
| Diagnostics and UI | `/evolution doctor`, curation reports, skill health and a knowledge graph are available; `all` provides settings, skill history and a merge panel on Web/desktop GUI, while the health panel is disabled by default |

See [Feature reference](docs/features.md) for triggers, failure behavior and limits.

## Install

See [INSTALL.md](INSTALL.md) for prerequisites, all four installation forms and upgrades. Install the full form by default:

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# Restart DSH, then run in a session:
/evolution doctor
```

For the desktop GUI, replace `--profile web` with `--profile desktop`. After installation, ask the agent to remember a project fact and open a new session to verify that it is injected. `doctor` checks the installation form and service state; it does not replace an actual read/write check.

The full source layout reports<!-- gen:install-counts --> 35 packages installed (the published list is 36; the agent preset is separate)<!-- /gen:install-counts -->.

## Installation forms

| Form | Use case | Capabilities and UI |
|---|---|---|
| `all` | Default full installation | Memory and skill tools in every session; evolution workbench (history/pending/merge/health) and the diagnostics card on Web/desktop GUI |
| `host` | No memory/skill write tools for the model | Explicit merge, background curation, manual maintenance and diagnostics remain; automatic review and usage accounting do not run; no evolution workbench or diagnostics |
| `preset` | Migration from an older configuration | Similar tool coverage to `all`, without settings or sidebar panels |
| Layered preset | Tools only in selected sessions | `host` plus the Evolution preset; other sessions do not enable automatic plugin behavior; no settings or sidebar panels |

Use only one form per profile. See [packages/INSTALL.md](packages/INSTALL.md) for exact session behavior and [INSTALL.md](INSTALL.md) for commands.

## Common commands

| Command | When to use it |
|---|---|
| `/evolution doctor` | Check installation form, versions and service state |
| `/evolution pending` | List ordinary writes waiting for approval |
| `/evolution skill history <name>` | Inspect body and support-file history |
| `/evolution skill undo <name>` | Revert the skill body; support files are not restored |
| `/evolution curator status` | Inspect automatic curation state |
| `/evolution merge status <runId>` | Inspect an initiated merge run |
| `/graph` | Browse or edit the skill and memory graph |

See [docs/commands.md](docs/commands.md) for the command reference and [docs/configuration.md](docs/configuration.md) for common settings.

## Data and safety

- In the default assembly, plugin data is stored under `$DSH_HOME` and does not depend on a family-hosted service. See [Operations](docs/operations.md) for backup and restore scope.
- Controlled memory/skill model tools scan call arguments, and the corresponding write paths apply structural checks and policy protection. Approval is an optional additional control; it neither replaces those checks nor covers curator or merge internal writes.
- Skill deletion archives the skill. Body history is recorded best-effort; verify an available version before undo, and note that body undo does not restore support files. Pre-curation snapshots can be restored, and merge runs retain records used for undo.
- Local storage does not mean that content never leaves the machine. Review, LLM curation and discovery domain generation send the relevant task or skill content to the configured model provider; branch review also copies session events into a child session.
- API keys are managed by DSH model and credential configuration. Do not place them in skills, memories or plugin configuration. See [Models and API keys](docs/api-keys.md).

## Compatibility

| Item | Current requirement |
|---|---|
| Validated platform line | **`0.2.1-rc.3`** |
| Published dependency window | `^0.2.1-rc.2` |
| Family version | `0.32.6` |
| Node | `^22.19.0` or `>=24.0.0` |

Published packages do not cross older prerelease platform lines. See [INSTALL.md](INSTALL.md) for installation and upgrade order.

## Documentation

- [Getting started](docs/getting-started.md): installation, first memory write and first skill operation.
- [Feature reference](docs/features.md): actual capabilities, defaults and limits.
- [Commands](docs/commands.md): everyday, curation, merge and maintenance commands.
- [Configuration](docs/configuration.md): approval, budgets, intervals and model-related settings.
- [Models and API keys](docs/api-keys.md): model dependencies and credential configuration.
- [Operations](docs/operations.md): backup, upgrade, uninstall and verification.
- [Troubleshooting](docs/troubleshooting.md): symptom-based diagnosis.
- Maintainer references: [package map and canonical facts](packages/README.md) and [development guide](docs/developer/development.md).
