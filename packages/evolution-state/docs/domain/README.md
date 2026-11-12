# @lmzhen/dsh-evolution-state-domain

Optional `storageDomain` provider for review, curator, and pending state. It is enabled in the shipped bundle patches (the platform base bundle mounts the storage-domain facility) and requires the platform `storageDomain` service.

The provider defines three schema-validated tables: `review_state`, `curator_state`, and `pending`. The configured domain facility determines the actual medium, which can be JSON, SQLite, remote RPC, or another supported backend; this package does not imply that all state resides in `$DSH_HOME`.

Transient open failures receive a bounded retry; deterministic schema/version/backend failures surface immediately. Pending claim/resolve transitions and the shared caps match the JSON provider. Resolved pending history is capped at 200 and review cadence state at 500 sessions, but domain mode does not create the JSON `pending-state-archive.json` sidecar.

When both state providers are mounted, pin `provider: domain` on the `evolution-state` row. Leaving the choice to registration order is rejected by the facade.
