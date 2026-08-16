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

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-approval` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.
