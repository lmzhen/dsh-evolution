# @lmzhen/dsh-evolution-skill-catalog

Native `ctx.skills` provider for the evolution-managed skill tree. It publishes the same tree that `tool-skill-manage` writes and invalidates its catalog on `evolution/skill-mutated` and `evolution/skills-refresh`.

## Naming and publication

The family's canonical name for a skill is its **directory name**.

**Decision 1 is open**: whether a frontmatter name may become a separate publication name remains undecided; current publication uses the directory name.

The provider registers at rank 390 so its `user-dsh` entries shadow the filesystem provider's rank-400 entries for the same tree. Entries with an invalid platform skill name or an empty description are skipped with a warning instead of aborting the whole platform catalog.

## Configuration

- `root`: skill tree to publish; empty uses the shared default.
- `includeSkillNames`: optional allow-list; empty publishes all otherwise eligible entries.
- `excludeSkillNames`: deny-list applied after the allow-list.
- `modelInvocable` and `userInvocable`: row-level defaults, both true. Per-skill `disable-model-invocation` and `user-invocable` frontmatter override them.

## Refresh boundary

In-band writes invalidate synchronously. Out-of-band structural changes can remain invisible until `/evolution skills refresh` because the upstream registry caches collection results. Content reads of an already indexed name may observe newer bytes while its cached summary remains stale.
