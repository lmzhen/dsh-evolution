# @deepseek-ai/dsh-evolution-review

Background review orchestration

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-review` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- - Review subagents inherit the host preset; Anchored Standard deployments rely on the default `skill_search`/`skill_load` allow-list.
