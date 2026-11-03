# @lmzhen/dsh-evolution-commands

Host command surface for the `/evolution` namespace: diagnostics, pending approvals, curator operations, maintenance, skill history, parameters, merge dispatch, migration, and preset installation.

The canonical user command reference is [docs/commands.md](../../docs/commands.md); the package map and preset-install spelling live in [packages/README.md](../README.md). Do not maintain a second command table here.

The command row ships with `all`, `host`, and `preset`. If the platform `commands` service is absent, the `/evolution` namespace is not registered.

Under a layered/variant installation, original-preset sessions still see the management commands even though they do not carry the family model rows. That accepted difference and the mutual-exclusion rules are single-sourced in [INSTALL.md](../INSTALL.md).

The old `consolidate` command is retired; use `merge` for skill merging.
