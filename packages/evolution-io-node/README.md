# @lmzhen/dsh-evolution-io-node

Local `node:fs` IO provider. It registers as `node` and declares itself the default provider for the family IO registry.

Writes use a durable temporary file followed by rename. Missing files read as absent; permission and other real IO failures remain errors instead of being mistaken for an empty store.

## Process boundary

The backend guarantees serialization of writes to the same path **within one process only**. It does not provide a cross-process read-modify-write lock. A deployment that shares a directory between processes must use a platform `ctx.fs` provider that explicitly declares cross-process scope; the Node backend alone is insufficient.

Crash atomicity and mutual exclusion are separate properties: temporary-file plus rename gives the former, not the latter.

There is no command, panel, cloud replication, or remote storage implementation in this package.
