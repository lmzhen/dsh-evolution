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


- Review subagents inherit the host preset; Anchored Standard deployments rely on the default `skill_search`/`skill_load` allow-list.
- Review subagents run as `spawn` children on the deployment default preset rather than inheriting the parent agent's composition (`fork`): a fork child is always promoted by the Anchored Standard bootstrap and its narrowed resident catalog would drop the plain `skill` tool from the review allow-list.
- The review request text is redacted for credential-shaped patterns before it reaches the subagent, but redaction is pattern-based and best-effort, not a security boundary.

## Configuration

`reviewProvider` selects the LLM provider for review subagents. When omitted, the subagent inherits the deployment default route instead of a hardcoded provider name. Model selection stays on the policy (`memoryReviewModel` / `skillReviewModel`).
