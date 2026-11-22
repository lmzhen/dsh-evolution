# `@lmzhen/dsh-evolution-platform`

The only host-facing package in the dsh-evolution family.

It owns:

- the platform port implementations (`agents`, `tools`, `llm`, `settings`,
  `storageDomain`, `projections`, `connection`, `presets`, and the rest);
- the `evolutionPlatform` service, which exposes one live port table;
- the platform runtime helper values (`defineTool`, `createUserMessage`,
  `escapeText`, `SessionId`, `withFileLock`, ...).

Feature packages must not import `@deepseek-ai/dsh-*`; they import contract
types and adapter helpers. The adapter is also the place where a real host API
shape difference is normalized; business code never branches on a DSH version.

## Detached review child

`@deepseek-ai/dsh-evolution-platform/review-child` exports `createReviewChildAgent(parent, taskId, options)`. It creates a live child `Session` through the public Session store, makes the child object the scope key of a real `createScope` context, and assigns that context to the child. When PTC is requested it probes the platform's optional `@deepseek-ai/dsh-tool-executor-ptc` package by export shape and mounts that executor in the child scope; a missing/incompatible package fails with `PTC_UNAVAILABLE`, never a version guess. The child stays detached from the parent lineage, so PTC nested `tool/ptc-dispatch*` frames land on the child and never touch the parent Session. The PTC package is not a family dependency: the platform base bundle ships it disabled and the PTC preset enables it.
