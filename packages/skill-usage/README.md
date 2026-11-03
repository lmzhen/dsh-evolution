# @lmzhen/dsh-skill-usage

Usage telemetry service for skill authorship and demand. It records use/view/patch counters, archive state, support-file reads, and feedback-owned quality fields for curator and health calculations.

Session dispatch observation counts a successfully settled skill read once and excludes review-leg traffic. Reads of unknown skills do not create usage records; creation/authorship paths must seed the record first. The first observed library read also attempts to append an observation-window event to the evolution timeline.

## Configuration and limits

- `root`: skill tree and usage sidecar root; empty uses the shared default.
- `eventsHome`: event timeline home; empty uses the normal evolution root.
- `sessionScoped`: when true, observe only sessions carrying the family model rows; shipped bundles set the appropriate scope.
- `supportReadToolNames`: file-reading tools whose successful calls can be attributed to support files.

Telemetry persistence and the observation-window timeline append are best effort and logged on failure. There is no direct command or panel; consumers read `report()` or the resulting curator/health views.
