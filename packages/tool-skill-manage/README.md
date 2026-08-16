# @deepseek-ai/dsh-tool-skill-manage

Model-facing skill_manage tool

## Model Experience

### skill_manage tool surface

#### What the model sees

The model sees the `skill_manage` tool schema and tool results containing success or validation messages.

#### Token effect

Adds the `skill_manage` tool schema to the request catalog; result tokens scale with returned messages.

#### KV Cache effect

Tool schema is prefix-stable. Skill writes do not alter the current request prompt; catalog invalidation affects the next request.

## Known Limitations and Deferred Work


- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.
