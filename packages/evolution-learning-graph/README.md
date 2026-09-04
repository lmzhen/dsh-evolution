# @deepseek-ai/dsh-evolution-learning-graph

Learning graph over skills and memory

## Graph surface

`/graph` renders the learning graph. A skill node is its name; a memory node is `memory:<source>:<index>`, where `<source>` is `memory`|`user` and `<index>` is the position in that file's entries.

Memory node ids carry a trailing snapshot token (`memory:<source>:<index>:<snapshot>` — an 8-hex digest of the node label's first line). It exists so `graph edit`/`graph delete` can detect index drift: any memory write between the last render and the command shifts indices, and a stale id is rejected (requiring a re-run of `/graph`) instead of mutating a different entry.

Memory→skill edges are word-level, not substring: the entry is tokenized on non-letter/digit/hyphen runs and a skill name links only when it is a whole token. This prevents a skill named `run` from linking the words `running`/`grunt`.

`graph edit`/`graph delete` of a skill node route through the evolution approval seam when it is mounted (soft-probed; the write executes directly when it is absent). Each approved/executed edit bumps the skill's patch counter and a delete archives it, matching `skill_manage`.

## Model Experience

### Indirect model surface

`@deepseek-ai/dsh-evolution-learning-graph` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work

- The memory drift snapshot covers only the node label (first line, first 80 chars): a change confined to a later line of the same entry is not detected, because the rendered node label is the comparison anchor.
- A hand-typed bare `memory:<source>:<index>` id has no snapshot and skips the drift check (legacy path; the rendered ids always carry the snapshot).
