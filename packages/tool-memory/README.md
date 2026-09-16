# @deepseek-ai/dsh-tool-memory

Model-facing memory tool and prompt context: it registers the `memory` tool, one fixed
guidance section and the runtime snapshot of the current memory entries. It owns no store —
the memory files and their provider do.

## Model surface

- **Model-visible:** the `memory` tool schema, one fixed guidance section, and a runtime snapshot containing the current memory entries; the snapshot scales with the stored entries and is absent when memory is empty.
- **Prompt prefix / KV cache:** guidance text is prefix-stable; the runtime snapshot is replaced after successful memory writes and is otherwise unchanged between requests; family rules: `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `tool-memory` row, carried by the `evolution-all` and one-click `evolution-preset` bundles and by the Evolution agent preset delta.

## Known limitations

- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.
- The pre-approval required-field pre-check and the store's own rejection text are hand-copied twins: the check runs on BOTH paths — every `operations[]` element and the normalized single operation — BEFORE the approval gate, so an approval-enabled deployment never stages a write the approved replay must then fail. Keeping the two texts in step is still manual; unifying them is deferred.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).