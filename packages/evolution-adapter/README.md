# `@lmzhen/dsh-evolution-adapter`

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

`@deepseek-ai/dsh-evolution-adapter/review-child` exports `createReviewChildAgent(parent, taskId)`. It creates a real detached `Session` through the public Session API and proxies the parent agent with only `agent.session` replaced. Use it whenever a platform tool (notably PTC `run_code`) appends nested dispatch frames to `exec.agent.session`: those frames must land on the child, never the parent Session. The child Session is intentionally not registered in the SessionStore; it is a per-review log sink.
