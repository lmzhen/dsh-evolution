# @lmzhen/dsh-evolution-skill-health

Optional read-only skill-health route and a view inside the shared evolution workbench. The `all` bundle ships it disabled by default.

The view projects curator health findings, proposal reports, protection markers, hard-cap hits, and available dimensions such as body size, support files, churn, and stamp density. It reports structural problems and duplicates; it does not repair skills. The by-skill queue is the only skill list; history and copy actions live on each row, and proposal provenance is under a details disclosure.

Unreadable skills are not presented as healthy. An unavailable scan or proposal read is marked unavailable/truncated rather than returned as a clean empty result. The `references-sprawl` rule is named but its count is suppressed until its threshold is calibrated.

The host package owns one GET route. The browser package registers the view into `evolution.workbench.view`; applying fixes requires the relevant curator or skill-management surface, not this view.
