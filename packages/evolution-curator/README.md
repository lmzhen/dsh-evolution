# @lmzhen/dsh-evolution-curator

Skill lifecycle service for stale detection, archiving, optional LLM nomination, snapshots, history, restore, and unit undo.

Use `/evolution curator status`, `report`, or `run` for inspection and manual operation. Archive/restore/history/undo commands operate on the corresponding stored records; deleting a skill through curation means archiving, not hard deletion.

## Defaults and scheduling

The plugin and `autoStart` default to enabled. An hourly timer checks due-ness; `curatorIntervalHours` defaults to 168 hours. Pause/resume overrides the startup schedule until that persisted override is cleared.

`staleAfterDays` defaults to 30 and `archiveAfterDays` to 90, with archive required to be at least the stale threshold. The optional `llmReview` pass defaults off. Idle activity gates, protected/referenced names, unmanaged/builtin scope, health thresholds, and model limits are listed in [PARAMETERS.md](../PARAMETERS.md).

`root` must point at the same skill tree used by the catalog and write tools. `intervalHours` remains a readable deprecated alias of `curatorIntervalHours`; writes to the old name are refused.

## Failure boundary

A mutating pass takes snapshots and supports explicit restore/undo. That is not a promise that every failed run automatically rolls back the whole tree; inspect the run report and use the explicit recovery operation when needed. Notifications may be incomplete, so an archived skill can disappear from the catalog without a conversation notice.
