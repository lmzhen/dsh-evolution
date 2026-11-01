# @deepseek-ai/dsh-evolution-ui

Web UI umbrella for the evolution family. The settings and skill-history panels now live here; the merge panel still delegates to its package until that client code moves.

## Known Limitations and Deferred Work

- The merge panel is still a dependency and is mounted through its `apply` export.
- The skill-health panel stays a separate disabled row; it is not enabled by this umbrella.
