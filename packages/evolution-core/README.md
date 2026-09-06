# @deepseek-ai/dsh-evolution-core

Shared pure library for the dsh-evolution plugin family.

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-core` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## SkillLibrary concurrency model

Skill-library mutations are read-modify-write on one file, so `SkillLibrary`
serializes them in-process with a `makeSerialQueue` chain: `update`, `patch`,
`restructure` and `writeSupportFile` run their whole read→validate→write under
one serial task, so two concurrent mutators on one skill never interleave in
this process. Single-file writes (`update`, `patch`, `writeSupportFile`)
additionally run the read and the write inside `transactIo` when a caller
injects a `transact` into the constructor — that is the cross-process lock, so
two processes sharing `DSH_HOME` cannot interleave their RMW on one file.
`create` writes a new file and `archive`/`consolidate` already own a two-phase
commit, so they deliberately stay outside the serial chain.

When the backend provides `transact` (nodeEvolutionIo and the io adapter do),
the constructor binds it BY DEFAULT since 0.3.27 — the single-file entry points
(`update`, `patch`, `writeSupportFile`, and each per-file piece of
`restructure`) run their read→write inside the cross-process lock for every
instantiation, so same-file concurrent writes from different processes no
longer resolve to last-writer-wins there. An explicit `transact` argument
overrides the default binding. The two-phase paths deliberately stay outside
that lock: `create` (exists probe + write) can still double-pass the probe
across processes, `archive`/`consolidate` are rename-based with best-effort
rollback (an archive loser's rollback surfaces the raw failure when the source
vanished), and `restructure`'s multi-file swap can expose an interleaved tree
to a concurrent reader. These residual windows are documented rather than
locked — cross-process writers to the SAME skill file should serialize through
the single-file paths above.

## Known Limitations and Deferred Work

- This package is a library, not a Cordis row; do not mount it as a plugin.
- 数值配置已在消费方 Config 面钳制（`min 1`/各字段域）；`MemoryStore` 内部对 `limit <= 0` 仍按 unbounded 防御处理——那是库内部防御，不构成"0 = 禁用"的配置语义。
