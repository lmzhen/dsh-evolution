# @lmzhen/dsh-evolution-ui

Browser UI umbrella for the evolution settings section and skill-history panel. It ships in `all`, not in `host` or the compatibility `preset`.

The settings surface exposes approval, diagnostics, parameter, and row-configuration cards. Skill history reads versions/diffs and the host history routes. The browser bundle registers both panels through client-kit; the host entry mounts the history host half.

These panels require the browser client slots used by the Web/desktop GUI. Headless or TUI sessions do not gain a separate panel surface. Client availability does not change the underlying command or service behavior.
