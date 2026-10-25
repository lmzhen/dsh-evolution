# @deepseek-ai/dsh-evolution-merge

Skill auto-merge host surface: candidate screening through the vendored pipeline,
two-round child authoring, per-pair staging, pending approval, commit receipts and
unit undo.

## Surface

- `/evolution merge <subcommand>` — canonical command.
- `/merge <subcommand>` — compatibility alias; registered through 0.30, deprecated in 0.31, removed in 0.32.
- Four read-only routes under `/api/dsh-evolution/merge/*`.

```text
/evolution merge scan | pair [--force] <a> <b> | candidates [--retry <id>] |
  status [id] | pending [--expired] | report [id] |
  approve <id> | reject <id> | resume [id] [--clear <id>] [--retry] |
  skipped [--restore <id>] | doctor | runs | cancel [id] | undo <target> --run <id> |
  reconcile
```

`/evolution merge` help lists 19 read/write surface commands plus the `reconcile`
maintenance command; `doctor` and `reconcile` stay off the frozen CommandSurface v1.

## Models

The engine needs local `potion-multilingual-128M-int8` and
`potion-multilingual-128M-pca64-int8` directories under `mergeModelsRoot`.
No auto provisioning; missing models fail loud and `/evolution doctor` warns.
`SKILL_MERGE_MODELS_ROOT` is an engine-internal test/CLI knob, not a host
configuration surface.

## Read-only panel

The browser panel is `@deepseek-ai/dsh-evolution-merge-ui`, mounted by the
`all` bundle only. The host row is mounted by `all`, `host` and `preset`.
## Reconcile

`/evolution merge reconcile` is the one writer of row-state convergence: skipped-TTL
expiry, approved→fuse continuation when the stage tree is usable, stage-lost demotion to a
retryable fuse row, and source-gone clearing (only when the live library is non-empty).
Every run writes `<home>/merge/reconcile.json`; `/evolution merge doctor` and the global
`/evolution doctor` merge line consume that report. Snapshots and the four GET routes
derive (for example an expired stage) but never persist.

Runtime command failures use three lines — `code:` (with stage/run id), `hint:`, `next:`.
A missing parent run answers `merge-parent-required` (with an E-305 hint); an invocation
that carried no agent answers the typed `no-agent` code.
