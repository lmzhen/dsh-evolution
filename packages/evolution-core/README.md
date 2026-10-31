# @deepseek-ai/dsh-evolution-core

Shared pure library for the family: `SkillLibrary`/`MemoryStore`, the prompts and guidance text, the threat/quality/drift signals, the skill CONTENT history (`skill-history.ts`: content-addressed versions behind every write) and the frame classification the plan path reports over (`evidence.ts`), plus the IO primitives (`nodeEvolutionIo`, `transactIo`, `evolutionIoAdapter`), the two helpers every host route surface shares (`http-routes.ts`: the loopback fence, the bounded JSON body reader and the JSON writer), the run lifecycle owner and the shared report window (`run-registry.ts`: the single owner of what is in flight, how a run ended and where its result lives, with read-time orphan convergence and no timer; `reports.ts`: one bucket sweep for every run-report kind, plus the per-home lock target both sweeps hold), and the long-run inventory the published table is rendered from (`long-runs.ts`). It is **not a Cordis row** — it registers no service, tool or prompt
section, and importing the package root is its only entry.

## Model surface

- **Model-visible:** nothing of its own: the guidance text and memory snapshot it renders are injected by the rows that consume it (`tool-memory`, `tool-skill-manage`).
- **Prompt prefix / KV cache:** unchanged by this package: family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** no: a library, not a row; consumed by the family's rows (e.g. `evolution-threat`, `evolution-policy`, `memory-files`, `skill-usage`, `evolution-state-json`).

## Known limitations

- **The family tree IS the platform's USER skill root.** `skillsRoot()` resolves to `<dshHome>/skills` — the root the platform's `skill-filesystem` serves at rank 400 — so "the same tree" holds while that root is enabled. Two divergences stay documented rather than mirrored: a platform row with `includeDefaultRoots:false` (or a composition without this family's catalog row) removes the only providers that serve the tree while family writes still succeed, and the platform's CWD-derived PROJECT roots (`<cwd>/.dsh/skills`, `<cwd>/.agents/skills`) are not read by the family at all, so `ctx.skills.get(name).path` and `SkillLibrary.read(name)` can name different files. Mirroring project roots is `U-3`, deliberately not started; point `customSkillDirs` (platform side) or `root` (family side) at a shared directory when the project tree has to be visible to both.
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

Seven process events ride the cordis bus (`evolution-core/src/events.ts` declares the payloads;
producers call `ctx.emit`, consumers `ctx.on`). They are NOT session events — appending one to a
session log made the session unresumable (A-line P0-1), which is why the payload file says so.

| event | mode today | emitted by |
|---|---|---|
| `evolution/skill-mutated` | emit (notification) | `evolution-core` skill store |
| `evolution/skills-refresh` | emit (notification) | `evolution-commands` `/evolution` verbs |
| `evolution/review-scheduled` | emit (notification) | `evolution-review` cadence paths |
| `evolution/review-error` | emit (notification) | `evolution-review` failure paths |
| `evolution/review-completed` | emit (notification) | `evolution-review` after a plugin branch settles |
| `evolution/memory-applied` | emit (notification) | `memory` after a memory write |
| `evolution/approval-decided` | emit (notification) | `evolution-approval` after an approval decision lands |

Legacy `evolution/plan-applied` remains declared so old activity ledgers stay readable, but the current production tree has no plan emitter after the review subagent/plan path was removed.

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

## 错误码（THE error-code table）

> 本节的表与 `src/errors.ts` 的码表必须**同集**，并写明**区间**：CI 门禁 `verify-error-codes.mjs <root>`
> 到 `<root>/evolution-core/README.md` 逐码核对（新增码要同时进表与区间行）。
| `E-301` / `E-302` / `E-303` | approval / curator / replay service not mounted | mount the row (they ship with host/all), then run doctor |
| `E-306` | this deployment stages foreground writes, but the named command is not replayable through the skill runner | approve-and-execute it directly, or set `stageForeground: false` deliberately |
| `E-304` | the mounted approval service predates the release capability (a skewed/partial upgrade) | `reject` the pending record instead of `release` |
| `E-305` | the invocation carries no agent (a script/headless caller reached a session-backed branch) | run the command from a session in the GUI or the CLI |
| `E-307` / `E-311` | the settings service is missing or cannot report its sections (`/evolution params`, `/evolution policy set`) | mount the settings row (ships with host/all), then run doctor |
| `E-312` | a parameter id or value was rejected, with the reason included | run `/evolution params` to see the canonical ids |
| `E-308` / `E-313` | unknown parameter group or id | list them: `/evolution params` shows every registered id with its tier and owner |
| `E-314` / `E-315` / `E-316` | the id is a deployment parameter, has no user layer, or its owner is not mounted | write it in `cordis.yml`, or mount the owner row — the message names tier, owner and namespace |
| `E-309` / `E-310` | your write lost a revision race, or the settings service refused it (the reason is included) | re-read with `/evolution params` and retry |
| `E-317` | you declined the confirmation the tool asked before creating or deleting a skill (a foreground create or bare delete asks when `skillWriteConfirm` is `ask` or `timeout`; the default `auto` does not ask at all) | nothing was written; repeat the call if you do want it |
| `E-318` | a write without a read: the session never loaded that skill, so the write is refused (skills only; the foreground operator session is exempt) | load it with the `skill` tool, then repeat the write |
| `E-320` | the profile home is not reported by this host, so the legacy settings document cannot be located | run the command in a session whose profile home is set |
| `E-321` | no evolution-io provider is mounted, so the legacy settings document cannot be read | mount the `evolution-io-node` row |
| `E-322` | a cross-field parameter constraint would be broken (the field, its floor and the attempted value are included) | raise the value to the named floor, or lower the sibling first |
| `E-323` | the subagent channel is unavailable: no subagents/agentPresets service, or the spawn provider lacks the agentPreset capability | run `/evolution doctor`; review keeps its inject channel, maintenance reports the channel unavailable instead of degrading silently |
| `E-324` | a restricted preset could not be created (parent preset read, YAML parse, register, or restrictor mount failed; the reason is included) | run `/evolution doctor` to see the preset id, allow set and failure reason; the review/maintenance channel stays unavailable until it is fixed |
| `E-325` | the host data plane is unavailable: no connection service, so panel/approval routes are not registered | use `/evolution pending`, `approve`, `reject` (same service methods) and run `/evolution doctor` |
| `E-319` | the confirmation before a create or bare delete went unanswered for `skillWriteConfirmTimeoutSeconds` (`skillWriteConfirm: 'timeout'`), so the write was cancelled | set `skillWriteConfirm` to `auto` (write without asking), keep `ask` (wait until answered), or raise the timeout |
Symptom → next step; the exact text of every code (`E-301`–`E-325`) is stored once in

## 单元与撤销（本包负责的契约）

- 本包持有单元契约的**类型与折叠**：SkillVersion.unitHead 两形态互斥（代表片 { moves, sources }／路标 { skill }），判别式固定为 moves !== undefined；读端折叠必须带上新字段，否则下一次写就丢。
- 成员解析与孤路标判定在 src/unit-members.ts：candidateSkills（代表片首位、去重保序）、resolveUnitMembersFromIndexes（只按已知 key、三向校验）、landmarkVerdict 与 staleRouteStubs（可跳 ⟺ 目标存在 ∧ 其索引仍持该 unitId；输出按 skill/version/owner 确定性排序）。
- 写作端的硬规则：kind 判 previous === null（不是 undefined）；path 抄循环里既有的 rel；同一目标写两次时清单保留最后一次写入的 afterRef。
- 面向读者的完整说明见仓库 docs/units-and-undo.md。

## Restricted preset ids

The review and maintenance channels run under two internally generated restricted presets (they are
NOT user-facing preset picker entries):

- `evolution-reviewer-readonly` — the review channel's child preset;
- `evolution-maintainer-readonly` — the maintenance channel's child preset.

The family's own agent-preset ids (`EVOLUTION_PRESET_IDS`) are `evolution`, `evolution-ptc`,
`evolution-cordis` and `evolution-minimal`. The two id sets are deliberately separate: a restricted
preset is created at runtime from a parent preset, never installed or selected.
