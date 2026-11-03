# @lmzhen/dsh-memory

Memory provider registry. It delegates reads, batch writes, snapshots, and context rendering to the selected provider; it does not implement a memory file format itself.

`provider` pins a provider by name. Empty uses the first registered provider; a named miss throws instead of silently writing through another store. Re-registering the identical provider object is idempotent, while a different object under the same name fails loudly.

Successful writes through this registry emit `evolution/memory-applied`, including writes that bypass the foreground memory tool. Provider registration emits `evolution/memory-provider-registered` so prompt snapshots can initialize after a late mount.

The model-facing tool lives in [tool-memory](../tool-memory/README.md), and the default local provider lives in [memory-files](../memory-files/README.md). This package has no direct command or panel.
