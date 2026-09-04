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

## Safety model

### Approval seam

Mutations (create/edit/update/patch/delete/write_file/remove_file/restructure) pass through the evolution approval seam when `evolution-approval` is mounted; approved/staged writes are replayed by the registered runner with the library origin preserved.

### pin/unpin: explicit exception (0.3.18, E-70)

`pin` and `unpin` are deliberately **outside** the approval seam. Pinning only lifts/restores the curator-lifecycle freeze — it changes a lifecycle flag, never content — and is fully reversible by the same tool. Routing it through `policy:'ask'` would let a staged-but-never-approved request hold the library in a pinned state invisibly. Tradeoff accepted: no approval on a lifecycle-flag flip; if product policy changes, pin/unpin should be wired into the same staging path as `patch`.

## Known Limitations and Deferred Work


- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.
