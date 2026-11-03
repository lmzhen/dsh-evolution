# @lmzhen/dsh-evolution-host

Infrastructure-only installation bundle for background automation and management without the general memory/skill-authoring model rows.

It mounts review, curator, approval/state, activity, replay, merge, maintenance, graph, and command infrastructure, but not `memory`, `skill_manage`, or the evolution skill catalog used by the full model-tool forms.

Host-only still exposes the read-only `maintenance_probe` and the merge-child-only `merge_stage` model tools. During the author phase, `merge_stage` supports staging writes and copies; it is not a read-only or generally available user tool. The host distinction is the absence of the general memory/skill-authoring model rows, not the absence of every model tool.

Use `all` or the layered Evolution preset when sessions need memory and skill authoring. `host` is mutually exclusive with `all`, `preset`, and a layered host-plus-preset installation.
