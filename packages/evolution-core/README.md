# @deepseek-ai/dsh-evolution-core

Shared pure library for the family: `SkillLibrary`/`MemoryStore`, the prompts and guidance text, the threat/quality/drift signals, the skill CONTENT history (`skill-history.ts`: content-addressed versions behind every write) and the frame classification the plan path reports over (`evidence.ts`), plus the IO primitives (`nodeEvolutionIo`, `transactIo`, `evolutionIoAdapter`) and the two helpers every host route surface shares (`http-routes.ts`: the loopback fence, the bounded JSON body reader and the JSON writer). It is **not a Cordis row** — it registers no service, tool or prompt
section, and importing the package root is its only entry.

## Model surface

- **Model-visible:** nothing of its own: the guidance text and memory snapshot it renders are injected by the rows that consume it (`tool-memory`, `tool-skill-manage`).
- **Prompt prefix / KV cache:** unchanged by this package: family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** no: a library, not a row; consumed by the family's rows (e.g. `evolution-threat`, `evolution-policy`, `memory-files`, `skill-usage`, `evolution-state-json`).

## Known limitations

- This package is a library, not a Cordis row; do not mount it as a plugin.
- 数值配置已在消费方 Config 面钳制（`min 1`/各字段域）；`MemoryStore` 内部对 `limit <= 0` 仍按 unbounded 防御处理——那是库内部防御，不构成"0 = 禁用"的配置语义。
- **Content-history storage grows with the number of DISTINCT bodies a skill has ever been written
  with, not with the retained count.** Trimming drops index entries; the blobs they point at stay on
  disk (they are shared by content, so a reference count would have to span every skill's index, and no
  sweeper exists yet). Measured on a 3.6 KB skill written 41 times: a 5.7 KB index over 20 entries and
  41 blob files totalling 150 KB (41x the live body); unchanged writes add nothing. Plan disk accordingly
  or remove `.history/blobs` entries by hand.
- Skill-library writes are serialized in-process; cross-process writers to the SAME skill file must go through the single-file paths (`update`, `patch`, `writeSupportFile`). The full concurrency model, its two-phase exceptions and their provenance are in Notes and history.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- Similarity is TWO NAMED QUESTIONS plus a projection the caller declares (`quality.ts`): `identity(text)` ("is it the same text?", a normalized-content hash) and `affinity(a, b)` ("how much vocabulary do these two share?", Jaccard over two `vocabulary()` sets), asked over `projectionText(projection, input)` — `body` for the library-wide scan, `summary` (name + description) for the create-time hint. `computePrefixClusters` stays a name-side STRUCTURAL index, not a score. Adding a projection is one entry in that table; a caller that wants a fourth ruler should name the question it is really asking instead.
- A whole-body replacement that keeps less than half of the previous body appends one line to its own result
  (`contentRetentionFeedback`, design §4 item 3): the ratio, both character counts, and the fact that the
  replaced version is still in the history. Computed in the write funnel where both bodies are in hand, feedback
  only — no ratio refuses a write, and the function owns no configuration.
- **A REMOVAL now leaves an entry (E2, 2026-09-30).** `nextHistoryIndex` mints an entry from the AFTER side,
  so an operation with `after === null` (removing a support file) used to record nothing once its bytes were
  already indexed: the deletion was invisible and its action vocabulary unreachable. A removal records the bytes
  it removed, labeled with the write that removed them, so a face can say "these bytes are gone" and undoing that
  entry puts the file back. The entry deliberately carries no `beforeHash` (its own hash IS the removed content).
- `anchorVerdict` is exported: the stage-time anchor rule ("does this write's target still hold the bytes the
  caller staged against?") has ONE implementation, and read-only readers (a preview, a dry run) call it instead
  of re-deriving a `contentHash` comparison.
- Content history is HISTORY ONLY: the skill tree is the single truth for current content, and no judgement reads the version index (design invariant I1). Recording is best-effort but happens inside the write lock, so the index never describes content that did not land; a failed record warns once per instance instead of failing the write.
- Skill-library mutations are read-modify-write on one file, so `SkillLibrary` serializes them in-process with a `makeSerialQueue` chain: `update`, `patch`, `restructure`, `writeSupportFile` and (since 0.3.46) `consolidate`'s target read→merge→commit run their whole read→validate→write under one serial task, so two concurrent mutators on one skill never interleave in this process.
- `create` is INSIDE the serial chain and, when a transact backend is bound, its exists check runs inside the same per-file transact (v18); `archive`/`consolidate` are rename-based two-phase paths and stay outside the single-file serial chain.
- **v18 residual (updated):** `create`, `removeSupportFile` and `setPinned` now run on the serial chain (`removeSupportFile`'s delete also goes through the per-file transact), so the remaining single-file residual is the protection TOCTOU (a marker check outside the transact) and the multi-file two-phase paths `archive`/`consolidate`/`restructure`.
- The race needs a concurrent mutator on the SAME skill file/package; the exposure is acknowledged and the protection check is the next candidate (see the v18 optimization plan, E-5).
- When the backend provides `transact` (nodeEvolutionIo and the io adapter do), the constructor binds it BY DEFAULT since 0.3.27: the single-file entry points (`update`, `patch`, `writeSupportFile`, and each per-file piece of `restructure`) run their read→write inside the cross-process lock for every instantiation, so same-file concurrent writes from different processes no longer resolve to last-writer-wins there.
- The two-phase paths deliberately stay outside that lock: `create`'s exists probe runs inside the transact when a transact backend is bound (v18), so only a transact-less custom backend can still double-pass the probe across processes; `archive`/`consolidate` are rename-based with best-effort rollback (an archive loser's rollback surfaces the raw failure when the source vanished), and `restructure`'s multi-file swap can expose an interleaved tree to a concurrent reader.
- These residual windows are documented rather than locked: cross-process writers to the SAME skill file should serialize through the single-file paths above.

## Events (the family's own, process-local)

Six process events ride the cordis bus (`evolution-core/src/events.ts` declares the payloads;
producers call `ctx.emit`, consumers `ctx.on`). They are NOT session events — appending one to a
session log made the session unresumable (A-line P0-1), which is why the payload file says so.

| event | mode today | emitted by |
|---|---|---|
| `evolution/skill-mutated` | emit (notification) | `evolution-core` skill store |
| `evolution/skills-refresh` | emit (notification) | `evolution-commands` `/evolution` verbs |
| `evolution/review-scheduled` | emit (notification) | `evolution-review` cadence paths |
| `evolution/review-error` | emit (notification) | `evolution-review` failure paths |
| `evolution/plan-applied` | emit (notification) | `evolution-review` after a plan lands |
| `evolution/memory-applied` | emit (notification) | `memory` after a memory write |

The mode column is what the code does today: every one of them is an announcement, and each
declaration carries it as a `@mode` tag (finding O-1, landed) — `verify-arch-guards`' rule **N33** checks that
tag against THIS table and against the dispatch site (`ctx.emit('…'`), so a declaration that drifts from
the table, or an event with no `@mode`, fails. This table stays the set's ONE home: the machine check here
(`machine.kind = event-mode`) re-derives the SET from the emit sites, so an event added or renamed in
code without this table fails N19.

The last two rows have no in-family consumer: `evolution/review-scheduled` and `evolution/review-error`
are emitted for operators and observability (5 and 3 dispatch sites, 0 `ctx.on` subscribers here). They are
**kept deliberately** — the observation surface is the point, and a deployment's own listener is the intended
consumer — so the `@mode` target stays at six (decision 10, provisional: keep).

