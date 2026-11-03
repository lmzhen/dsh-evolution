# @lmzhen/dsh-evolution-activity

Internal plugin that persists evolution process events into `$DSH_HOME/evolution/activity.json`.

## What it records

- `evolution/plan-applied`: accepted, rejected, skipped, and failed operation counts for a reviewed plan.
- `evolution/review-completed`: the review status, trigger, text, actions, timing, and model usage when supplied.

The versioned sidecar contains separate `items` and `reviews` arrays. `maxItems` bounds each array and defaults to 200; values below 1 are rejected by the loader.

## Consumers and failure behavior

There is no direct command or panel. `evolution-replay` reads plan records, while other diagnostics can read the persisted review history without a live session.

Persistence starts after an `evolutionIo` provider mounts. Appends are best effort: a write failure is logged after the upstream operation has already completed. Before an append replaces unreadable or foreign-version bytes, the writer attempts to preserve them in a `.corrupt` copy and refuses the append if that rescue fails.

The concurrency guarantee comes from the selected IO backend. The shipped Node backend is single-process; see [evolution-io-node](../evolution-io-node/README.md).
