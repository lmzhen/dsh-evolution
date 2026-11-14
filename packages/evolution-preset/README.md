# @lmzhen/dsh-evolution-preset

Compatibility one-click bundle retained only for uninstalling an existing 0.47 profile. It was not published after 0.47 and has no install path in 0.48; new and upgraded profiles use `evolution-all`.

Like `all`, it mounts model tools at profile root so every session receives them. It does not include the settings/skill-history UI umbrella, merge sidebar, or skill-health panel.

The bundle is mutually exclusive with `all` and `host`. Use [INSTALL.md](../INSTALL.md) for the one-version uninstall path; the old attach/variant install semantics are gone.

The package also ships a standalone `cordis.yml`. That standalone composition intentionally omits the `evolution-maintenance/tools` row; add it explicitly if a standalone deployment needs `maintenance_probe`.
