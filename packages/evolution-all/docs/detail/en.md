## What it does

Turns a plain Harness session into a self-improving one: the agent remembers what it learned, keeps a skill library, reviews its own work, merges duplicate skills and curates them over time. Its data stays in your DSH home, while the model calls it makes go to the provider you configured.

## What is included

- Memory: a model-facing `memory` tool backed by a local layered memory store.
- Skills: the `skill_manage` tool, a catalog the agent can load, and a skill-history workbench.
- Review and merge: background review, two-round skill authoring, and a merge approval you can turn on.
- Curation and maintenance: lifecycle checks, drift scans and a read-only health view that ships off.
- Commands: `/evolution pending`, `curator`, `maintain` and `doctor` work in any session, panel or not.

## Where to configure it

Every editable parameter belongs to the component that owns it, where the panel shows the live value, the default it ships with and whether you overrode it. Most changes take effect immediately and the few deployment settings need a restart; parameters you leave alone stay at the default.

## Notes

Ordinary memory and skill writes are approved automatically unless you turn write approval on: with it on, each one stages a pending entry you approve or reject first. The health view ships disabled. Skill merging has its own approval setting, separate from write approval, and keeps a receipt you can undo.
