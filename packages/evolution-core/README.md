# @deepseek-ai/dsh-evolution-core

Shared pure library for the family: `SkillLibrary`/`MemoryStore`, the prompts and guidance text,
the threat/quality/drift signals and the IO primitives (`nodeEvolutionIo`, `transactIo`,
`evolutionIoAdapter`). It is **not a Cordis row** — it registers no service, tool or prompt
section, and importing the package root is its only entry.

## Model surface

- **Model-visible:** nothing of its own — the guidance text and memory snapshot it renders are injected by the rows that consume it (`tool-memory`, `tool-skill-manage`).
- **Prompt prefix / KV cache:** unchanged by this package — family-level rules single-sourced in `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** no — a library, not a row; consumed by the family's rows (e.g. `evolution-threat`, `evolution-policy`, `memory-files`, `skill-usage`, `evolution-state-json`).

## Known limitations

- This package is a library, not a Cordis row; do not mount it as a plugin.
- 数值配置已在消费方 Config 面钳制（`min 1`/各字段域）；`MemoryStore` 内部对 `limit <= 0` 仍按 unbounded 防御处理——那是库内部防御，不构成"0 = 禁用"的配置语义。
- Skill-library writes are serialized in-process; cross-process writers to the SAME skill file must go through the single-file paths (`update`, `patch`, `writeSupportFile`). The full concurrency model, its two-phase exceptions and their provenance are in Notes and history.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- Skill-library mutations are read-modify-write on one file, so `SkillLibrary` serializes them in-process with a `makeSerialQueue` chain: `update`, `patch`, `restructure`, `writeSupportFile` and — since 0.3.46 — `consolidate`'s target read→merge→commit run their whole read→validate→write under one serial task, so two concurrent mutators on one skill never interleave in this process.
- `create` is INSIDE the serial chain and, when a transact backend is bound, its exists check runs inside the same per-file transact (v18); `archive`/`consolidate` are rename-based two-phase paths and stay outside the single-file serial chain.
- **v18 residual (updated):** `create`, `removeSupportFile` and `setPinned` now run on the serial chain (`removeSupportFile`'s delete also goes through the per-file transact), so the remaining single-file residual is the protection TOCTOU (a marker check outside the transact) and the multi-file two-phase paths `archive`/`consolidate`/`restructure`.
- The race needs a concurrent mutator on the SAME skill file/package; the exposure is acknowledged and the protection check is the next candidate (see the v18 optimization plan, E-5).
- When the backend provides `transact` (nodeEvolutionIo and the io adapter do), the constructor binds it BY DEFAULT since 0.3.27 — the single-file entry points (`update`, `patch`, `writeSupportFile`, and each per-file piece of `restructure`) run their read→write inside the cross-process lock for every instantiation, so same-file concurrent writes from different processes no longer resolve to last-writer-wins there.
- The two-phase paths deliberately stay outside that lock: `create`'s exists probe runs inside the transact when a transact backend is bound (v18), so only a transact-less custom backend can still double-pass the probe across processes; `archive`/`consolidate` are rename-based with best-effort rollback (an archive loser's rollback surfaces the raw failure when the source vanished), and `restructure`'s multi-file swap can expose an interleaved tree to a concurrent reader.
- These residual windows are documented rather than locked — cross-process writers to the SAME skill file should serialize through the single-file paths above.
