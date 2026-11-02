# CI validation — 0.32.3 (2026-11-03)

Run: https://github.com/lmzhen/dsh-evolution/actions/runs/41531613401
Commit: 947a1532
Trigger: workflow_dispatch (no tag, publish skipped)

| Job | Result |
|---|---|
| platform line | success |
| validate (released upstream) | success |
| validate (released upstream, node 22) | success |
| desktop install (windows) | success |
| publish | skipped |

The run exercised the composite action end to end: platform build, evolution build/pack, docs/architecture gates, packed tarball asset smoke, source-overlay installer guard (Windows), and the packed-asset audit. No tag was pushed and nothing was published.

P1-13 residual: the release-evidence --gates-report ledger still has to be produced from this kind of run; the action currently emits per-step status, not the JSON ledger that assemble-release-evidence consumes.
