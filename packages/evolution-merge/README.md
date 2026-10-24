# @deepseek-ai/dsh-evolution-merge

Skill auto-merge host surface: candidate screening through the vendored pipeline,
two-round child authoring, per-pair staging, pending approval, commit receipts and
unit undo.

## Surface

- `/evolution merge <subcommand>` — canonical command.
- `/merge <subcommand>` — 0.29 compatibility alias; removed in 0.30.
- Four read-only routes under `/api/dsh-evolution/merge/*`.

```text
/evolution merge scan | pair <a> <b> | status [id] | pending | report [id] |
  approve <id> | reject <id> | resume [id] [--clear <id>] |
  skipped [--restore <id>] | doctor | runs | cancel [id] | undo <target> --run <id>
```

## Models

The engine needs local `potion-multilingual-128M-int8` and
`potion-multilingual-128M-pca64-int8` directories under `mergeModelsRoot`.
No auto provisioning; missing models fail loud and `/evolution doctor` warns.
`SKILL_MERGE_MODELS_ROOT` is an engine-internal test/CLI knob, not a host
configuration surface.

## Read-only panel

The browser panel is `@deepseek-ai/dsh-evolution-merge-ui`, mounted by the
`all` bundle only. The host row is mounted by `all`, `host` and `preset`.
