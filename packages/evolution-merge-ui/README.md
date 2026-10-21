# @deepseek-ai/dsh-evolution-merge-ui

Browser-only sidebar panel for the merge queues. It reads the four host routes
and never writes skills: row actions are copyable `/evolution merge ...`
commands.

- Queues: pending / retry / skipped.
- Row facts: target, confidence, failure, attempts, origin, staging expiry.
- Run strip: latest run id/state/stage/progress.
- Four states: loading / ready / empty / failed; view schemaVersion guard.
- Mounted by the `all` bundle only.
