# @lmzhen/dsh-evolution-io

Provider registry for the family IO seam. This package does not itself read or write files.

Backends register an `EvolutionIo` implementation under a provider name. Consumers can request a named provider or resolve the default: the first explicitly declared default wins, with registration order as the fallback when no default was declared. Resolving a missing name or an empty registry throws an actionable error.

Re-registering the identical provider object is idempotent for remount/HMR; a different object under the same name fails loudly. Disposal handles are generation-scoped so an old handle cannot remove a newer registration.

There is no command, panel, or model tool. The shipped local backend is [evolution-io-node](../evolution-io-node/README.md).
