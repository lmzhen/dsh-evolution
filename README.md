# dsh-evolution

## What is this plugin for?

The plugin is designed to generate skills automatically and manage their full lifecycle, with an emphasis on retaining capabilities that are specific to a user and a project. It is task-oriented: the model builds and maintains a private set of skills for the user's environment, preferences and working procedures, improving its fit for those tasks.

That lifecycle includes creation, discovery, use, revision after review, restructuring, merging, archiving and restoration. These are independent capabilities rather than stages every skill must pass through. The plugin also provides budgeted memory for project facts and user preferences across sessions.

It does not modify or train the model, and it does not provide a hosted model service. DSH's configured model performs the semantic work, while the plugin's write gates, snapshots, history and approval mechanisms constrain changes and recovery.

## Platform line

The family targets DeepSeek Harness `0.2.2-rc.1` only. Published packages declare the `^0.2.2-rc.0` peer range and the `>=0.2.2-rc.0 <0.2.3-0` engine range. The single host edge is the `evolutionPlatform` service; features reach it through the family's platform ports, never by importing host internals. The family's own write authority is `evolutionMutationAuthority`: one lease/fence service above the IO seam, shared by merge, review, curator and the knowledge stores.

## What is a skill?

A skill is a module that packages a task procedure: a `SKILL.md` body plus optional scripts, templates and reference files. It is discovered by name and description and loaded through the native `skill` tool.

## Why build this plugin?

General model capability reduces the value of one-size-fits-all manuals, while project- and user-specific procedures still need maintenance. The plugin automates the mechanical parts and keeps writes bounded, inspectable and recoverable.

## What capabilities does it provide?

Each capability below has a corresponding code entry point. They have different triggers and should not be read as a pipeline that runs for every task.

| Capability | Current behavior and defaults |
|---|---|
| Skill generation and updates | The agent can create and patch skills through `skill_manage`. By default, review prompts ask the model to generate or update skills at an interval of ten weighted tool calls after substantive cadence signals, delivered at a task boundary; a review does not have to produce a new skill |
| Skill catalog and search | The full catalog is published by default and loaded through the native `skill` tool; `skill_search` provides local retrieval, while discovery domain cards and catalog trimming are off by default |
| Library curation | Curator performs deterministic lifecycle maintenance on interval and idle conditions, marking stale skills and archiving them; LLM-nominated consolidation is a separate option |
| Skill merge | Started with `/evolution merge scan` or `pair`. Scan requires local potion models and can fall back to stub without an LLM; ordinary pair does not require potion, but round 1/authoring requires a child-session model. Initiated runs are auto-approved by default, with `mergeApproval` available for manual approval |
| Memory | Available in `all` sessions. Project memory and user-profile budgets default to 2200 and 1375 characters; new writes are refused at the limit rather than silently truncated |
| Write approval and recovery | Ordinary write approval is off by default and stages memory and skill writes when enabled; curator and merge use their own controls. Skill history, body undo, unit undo and archive restore have different scopes, and execution-time failures do not guarantee complete rollback |
| Diagnostics and UI | `/evolution doctor`, curation reports, skill health and a knowledge graph are available; `all` adds its parameters to Settings → Capability evolution and provides skill history and a merge panel on Web/desktop GUI, while the health panel is disabled by default |

See [Feature reference](docs/features.md) for triggers, failure behavior and limits.

## Install

See [INSTALL.md](INSTALL.md) for prerequisites, the two internal installation planes and upgrades. Install the full form by default:

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# Restart DSH, then run in a session:
/evolution doctor
```

Install and upgrade through `dsh plugin add` only: the platform forwards add/remove to pnpm (the desktop app ships its own pnpm). Do not run `npm install` by hand — it leaves a `package-lock.json` and a flat `node_modules` inside the profile, and the plugin page's update button (pnpm) then fights with it. If that already happened, close DSH, delete `profiles/<profile>/package-lock.json`, run the pnpm `add` again in the profile directory, and restart.

For the desktop GUI, replace `--profile web` with `--profile desktop`. After installation, ask the agent to remember a project fact and open a new session to verify that it is injected. `doctor` checks the installation form and service state; it does not replace an actual read/write check.

The full source layout reports<!-- gen:install-counts --> 20 packages installed (the published list is 20; the agent preset is separate)<!-- /gen:install-counts -->.

## Installation forms

| Form | Use case | Capabilities and UI |
|---|---|---|
| `all` | Default product installation | Memory and skill tools in every session; evolution workbench (history/pending/merge/health) and the diagnostics card on Web/desktop GUI |
| `host` | Advanced composition only | Infrastructure without the model memory/skill rows; not the product default |

Use `all` for normal installs. The old `preset` and layered forms are internal migration paths, not product choices. See [packages/INSTALL.md](packages/INSTALL.md) for exact session behavior and [INSTALL.md](INSTALL.md) for commands.

## Common commands

| Command | When to use it |
|---|---|
| `/evolution doctor` | Check the installation form, versions and service state |
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
| Validated platform line | **`0.2.2-rc.1`** |
| Published dependency window | `^0.2.2-rc.0` |
| Family version | `0.44.0` |
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
