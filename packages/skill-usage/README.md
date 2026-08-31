# @deepseek-ai/dsh-skill-usage

Skill usage telemetry service

## Telemetry sources

`record(name, kind)` is the write API (`use` / `view` / `patch`). Reads are
observed automatically: the service listens for `session/event` `tool/call`
records of the read tools (`skill`, `skill_load`) and bumps `view` on
EXISTING records only — an arbitrary read never mints a usage record
(records are authored by skill creation, patching, or curator seeding).

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-skill-usage` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.
