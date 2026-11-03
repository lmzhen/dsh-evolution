# @lmzhen/dsh-evolution-merge-ui

Browser sidebar for skill merge queues, A/B bodies, and history. It ships only in the `all` installation form.

The panel is read-only. Action buttons copy the appropriate `/evolution merge` or `/evolution doctor` command; they do not approve, execute, or undo a merge in the browser.

The host entry intentionally registers nothing. The Loader discovers the `dsh.client` manifest and serves the browser bundle, which uses the shared client-kit panel lifecycle and the four merge read routes.
