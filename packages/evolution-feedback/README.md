# @lmzhen/dsh-evolution-feedback

Feedback aggregation service for skill and session ratings. The family currently has no in-family producer: an embedding host must call `record(target, rating, note?, kind?)` with a real target and a `positive` or `negative` rating.

Skill feedback writes the feedback-owned `feedback_score` and `feedback_warn` fields on the usage record. Curator lifecycle decisions read their union with the curator-owned quality warning; session feedback does not feed that skill-quality channel.

## Persistence and configuration

`$DSH_HOME/evolution/events.json` is the source of truth. `feedback.json` is a rebuildable boot cache, not the authoritative store. Appends are optimistic in memory and rolled back with a warning if the event append fails.

`qualityWarnThreshold` defaults to -0.25 and accepts values from -1 to 1. `path` overrides only the boot-cache location; it does not relocate the event log.

There is no built-in command or panel. Without an external producer, installing this package alone does not create feedback data.
