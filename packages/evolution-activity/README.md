# @deepseek-ai/dsh-evolution-activity

Durable activity store for self-evolution plan outcomes

## What it does

Subscribes to the process event `evolution/plan-applied` (payload v2, with sessionId) and persists every plan outcome to `$DSH_HOME/evolution/activity.json` through the evolution IO seam — the same best-effort sidecar posture as `feedback.json` and the curator reports. The sidecar is append-merge (load → fold → save under an in-process queue), so records survive host restarts and are readable without a session. The retired session projection is gone: a session log carrying `evolution/*` types is refused wholesale at resume, so plan-outcome durability lives here instead. A storage-domain table is deferred until a consumer needs domain routing.

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-activity` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Configuration

- `maxItems`: bound on the retained activity sidecar (default `DEFAULT_MAX_ITEMS = 200`). A non-finite value falls back to the default (0.3.19, S6.4 guard).

## Known Limitations and Deferred Work


- Each event lands through `transactIo` (like `feedback.json`), so append cycles are cross-process atomic at the single-write granularity; the read-modify-write of one event is serialized in-process and atomic on disk. A multi-record batch is still one event at a time — no batch transaction exists.
