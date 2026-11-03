# @lmzhen/dsh-evolution-merge-ui

Skill-merge view inside the shared evolution workbench. It ships only in the `all` installation form.

The view is read-only: action buttons copy the appropriate `/evolution merge` or `/evolution doctor` command; they do not approve, execute, or undo a merge in the browser. Internal run fields (run id, stage, parent, result ref) live under the view's run-details disclosure so the queue and decision facts come first.

The host entry intentionally registers nothing. The Loader discovers the `dsh.client` manifest and serves the browser bundle, which registers itself into `evolution.workbench.view` and uses the shared client-kit lifecycle and the four merge read routes.
