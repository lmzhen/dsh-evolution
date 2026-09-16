# @deepseek-ai/dsh-evolution-replay

Replay/A-B evaluation primitives for evolution plans

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-replay` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.
- **The activity-sidecar verdict is per read (`sourceCorrupt`).** When `apply()` meets
  bytes this build cannot read as the current format, every `compare()` result carries
  `sourceCorrupt: true` and its report states the leaderboard is NOT the recorded
  history (an empty list does not mean nothing happened). A later successful read
  clears the qualification — a repaired sidecar plus an io reload (HMR / plugin
  restart) stops qualifying — while the corruption itself stays observable through the
  one warn `apply()` emits at mark time (PLAN S5.1, audit P2-18, 0.3.83).

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).
