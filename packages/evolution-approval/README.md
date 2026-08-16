# @deepseek-ai/dsh-evolution-approval

Stage/pending approval service for Hermes-style self-evolution writes.

DSH native approval is one-shot; this service adds the Hermes staged queue:
`request()` stores background writes, `approve()` replays them through a runner,
and `reject()` discards them. The core evolution plugin registers memory/skill
runners when both plugins are composed.

Run the companion invariant and tests:

```sh
node node_modules/vitest/vitest.mjs run packages/evolution/evolution-approval/tests
```
