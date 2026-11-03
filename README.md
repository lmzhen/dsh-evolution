# dsh-evolution

Memory and skill management for DeepSeek Harness.

## Purpose

dsh-evolution preserves project facts across sessions and turns reusable task procedures into skills. It provides memory writes, skill generation and maintenance, task review, library curation, skill merging, write approval, versioned undo and diagnostics.

It is intended for Harness users who maintain project conventions, working preferences and specialized procedures over time. It does not train a model or provide a hosted model service. Features that require model judgment use the model provider configured in DSH.

## Memory and skills

- **Memory** stores project facts and user preferences, such as build commands, directory constraints and release requirements. Project memory and the user profile have separate character budgets and are injected into later sessions within those budgets.
- **A skill** describes how to perform a class of task. It consists of a `SKILL.md` body and optional scripts, templates and reference files. The model discovers skills by name and description, then loads them when relevant.

Memory records which facts to retain; a skill records how to perform the work. MCP connects tools and resources, while a skill organizes the steps and completion criteria for using them.

## Install

See [INSTALL.md](INSTALL.md) for prerequisites, all four installation forms and upgrades. Install the full form by default:

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# Restart DSH, then run in a session:
/evolution doctor
```

For the desktop GUI, replace `--profile web` with `--profile desktop`. After installation, ask the agent to remember a project fact and open a new session to verify that it is injected. `doctor` checks the installation form and service state; it does not replace an actual read/write check.

The full source layout reports<!-- gen:install-counts --> 35 packages installed (the published list is 36; the agent preset is separate)<!-- /gen:install-counts -->.

## Capabilities

| Capability | Current behavior and defaults |
|---|---|
| Memory | Available in `all`, `preset` and selected layered-preset sessions. Project memory and user-profile budgets default to 2200 and 1375 characters; new writes are refused at the limit rather than silently truncated |
| Skill writes and versions | The agent can create, patch, split and archive skills; history, body undo and archive restore are available |
| Skill catalog and search | The full catalog is published by default and loaded through the native `skill` tool; `skill_search` provides local retrieval, while domain cards and catalog trimming are off by default |
| Task review | Enabled by default at an interval of ten weighted tool calls, delivered at a task boundary when substantive task signals are present; it uses the session model and can create a skill or prompt a patch to one used in the session |
| Library curation | Deterministic curation marks stale skills and archives them on interval and idle conditions; LLM-nominated consolidation is a separate option |
| Skill merge | Started with `/evolution merge scan` or `pair`. Scan requires local potion models and can fall back to stub without an LLM; ordinary pair does not require potion, but round 1/authoring requires a child-session model. Initiated runs are auto-approved by default, with `mergeApproval` available for manual approval |
| Write approval | Off by default; when enabled, it stages ordinary memory and skill writes. Curator writes and merge commits do not use this approval path |
| Diagnostics and UI | `/evolution doctor`, curation reports, skill health and a knowledge graph are available; `all` provides settings, skill history and a merge panel on Web/desktop GUI, while the health panel is disabled by default |

See [Feature reference](docs/features.md) for triggers, failure behavior and limits.

## Installation forms

| Form | Use case | Capabilities and UI |
|---|---|---|
| `all` | Default full installation | Memory and skill tools in every session; settings and panels on Web/desktop GUI |
| `host` | No memory/skill write tools for the model | Explicit merge, background curation, manual maintenance and diagnostics remain; automatic review and usage accounting do not run; no settings or sidebar panels |
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
| Family version | `0.32.5` |
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
