# @lmzhen/dsh-evolution-feedback

Error-report aggregation service for skills. The in-family producer is the `skill_manage` feedback action, which records a negative report with an optional short note; the skill page shows the recent note history.

Skill feedback writes the feedback-owned `feedback_score` and `feedback_warn` fields on the usage record. Curator lifecycle decisions read their union with the curator-owned quality warning; session feedback does not feed that skill-quality channel.

## Persistence and configuration

`$DSH_HOME/evolution/events.json` is the source of truth. `feedback.json` is a rebuildable boot cache, not the authoritative store. Appends are optimistic in memory and rolled back with a warning if the event append fails.

`qualityWarnThreshold` defaults to -0.25 and accepts values from -1 to 1. `path` overrides only the boot-cache location; it does not relocate the event log.

Reports are shown in the skill workbench; there is no separate feedback panel.

