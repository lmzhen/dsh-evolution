# @lmzhen/dsh-evolution-ui

Browser UI umbrella for the evolution family. It ships in `all`, not in `host` or the compatibility `preset`.

The UI has one workbench page with four visible tabs — skill history, data overview, pending decisions, and merge suggestions — plus a small diagnostics card in the settings section. The data overview is the sortable library table (loads, 30-day loads/negative feedback, feedback rate); clicking a skill name opens its history and keeps the table state on return. Health findings stay in diagnostics rather than a separate tab. Parameter cards register on the platform's Plugins surface (`settings.plugin.item`); this bundle owns no second parameter page. The browser bundle registers the workbench page and the feature views; the host entry mounts the history host half.

Pending decisions, merge commands, and health findings are read-only in the browser except for the approval decisions the host routes expose. Headless or TUI sessions do not gain a separate panel surface.
