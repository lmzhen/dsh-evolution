# @lmzhen/dsh-evolution-preset

Compatibility one-click bundle for existing configurations. New installations should normally use `evolution-all`.

Like `all`, it mounts model tools at profile root so every session receives them. It does not include the settings/skill-history UI umbrella, merge sidebar, or skill-health panel.

This bundle is mutually exclusive with `all`, `host`, and the layered Evolution preset. Use [INSTALL.md](../INSTALL.md) for the attach/variant semantics and upgrade path.

The package also ships a standalone `cordis.yml`. That standalone composition intentionally omits the `evolution-maintenance/tools` row; add it explicitly if a standalone deployment needs `maintenance_probe`.
