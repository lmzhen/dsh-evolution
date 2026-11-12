## What it does

Makes the agent better at its work over time: it remembers what it learned, keeps a library of reusable skills, reviews its own work, and can merge duplicate skills or clean up unused ones. What it saves stays on this computer by default; when it needs a model, it uses the one you configured.

## What is included

- What it remembers: useful facts stay with the agent across sessions, saved on this computer.
- Skills: the agent can create, update and archive its own skills, and a history page shows what changed.
- Review and merge: it checks its own work in the background; duplicate skills can be merged, and every merge leaves a receipt you can use to undo it.
- Cleanup and checks: skills left unused for a while are archived, and a skill health page lists problems without changing anything; it is off by default.
- Commands: /evolution pending lists what is waiting for approval, and /evolution doctor, /evolution maintain and /evolution curator are available in every session.

## Where to configure it

Every parameter lives in one place: Settings → Capability evolution, grouped by what it controls. Each card shows the current value, the default and whether you changed it. Most changes take effect right away; a few take effect only after a restart. Anything you leave alone keeps its default.

## Notes

Changes the agent makes to what it remembers or to its skills are saved automatically unless you turn approval on; then each change waits for you to approve or reject it. Merging skills has its own approval switch, separate from the one for ordinary saves, and every merge keeps a receipt that lets you undo it.
