# @lmzhen/dsh-evolution-learning-graph

Top-level `/graph` command for inspecting and editing a graph of skill and memory nodes. This is not `/evolution graph`.

## Commands and node identity

- `/graph` lists nodes, `related` and `memory_skill` edges, and a density summary.
- `/graph detail <nodeId>` reads one node.
- `/graph edit <nodeId> <text>` replaces a skill body or memory entry.
- `/graph delete <nodeId>` archives a skill or removes a memory entry.

A skill node id is its directory name. A memory node id identifies `memory` or `user` plus an entry index and snapshot token; edit/delete rejects a stale snapshot instead of modifying whichever entry later moved into that index.

## Write semantics and limits

**Skill deletion archives; memory deletion removes the entry.** These are different operations and must not be read as one retention policy.

Writes use the same approval seam and library gates as the corresponding memory/skill tools. A host-only assembly may lack the replay runner; if a write would stage and no runner exists, the command refuses before creating an unapprovable record.

Node and edge blocks each render at most 200 lines plus an explicit overflow marker; the density footer retains the true totals. Skill reads are batched, and unreadable bodies reduce the available edges rather than being presented as a complete graph.
