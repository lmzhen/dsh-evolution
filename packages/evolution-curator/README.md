# @deepseek-ai/dsh-evolution-curator

Deterministic skill lifecycle and recovery

## Model surface

- **Model-visible:** nothing of its own: it registers no prompt section and no tool schema; the packages that consume this service own the model-visible effects.
- **Prompt prefix / KV cache:** independent of request-prefix construction — it does not alter the assembled prompt or tool list; family-level rules: `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `evolution-curator` row, carried by the `evolution-host`, `evolution-all` and one-click `evolution-preset` bundles; it provides the `evolutionCurator` service the `/evolution curator …` commands and doctor read.

## Known limitations

- LLM nomination pass is advisory and disabled by default; deterministic lifecycle remains authoritative.
- Consolidation is a REAL merger path: the LLM nomination (when enabled / via `recommend()`) proposes
 merge groups, the control plane gates them and applies the mutation — merged source bodies are appended
 verbatim rather than rewritten into a synthesized skill.

## Recovery and consolidation

- `archive` never deletes: skills move to `.archive/` with a `.archive-reason` marker.
- `restore(name)` (service) / `/evolution skill restore <name>` brings one archived skill back to the active root and resets its usage state.
- `history(name)` (service) / `/evolution skill history <name>` lists one skill's content versions (number, time, action, characters, hash prefix) from the content history every write path maintains (`evolution-core/src/skill-history.ts`). An index that cannot be read, carries a foreign field layout, or was written by a NEWER reader all read as "no versions" (the module's never-guess posture) — the next successful write re-seeds the index with a baseline entry, so the record heals instead of staying invisible.
- `undo(name, v?)` (service) / `/evolution skill undo <name> [--to v<N>]` restores one version's CONTENT through an ordinary anchored write: an omitted `v` means the newest version whose content differs from the live file, the anchor is the live hash (a concurrent writer is refused rather than overwritten, and a version the index lists but whose blob cannot be read is refused rather than guessed at), and the rollback itself becomes a new version. Content only: the pin marker, usage counters and curation state are not versions and do not move, which the result text says. A skill with no recorded versions, a target that is not in the active tree (use `skill restore` for an archived one), and a session that cannot replay the write each get their own refusal.
- `consolidate(target, sources)` (service) / `/evolution consolidate` merges source bodies into the target, archives the sources with an absorbed-into marker, and folds their usage records into `archived` state. Both operations snapshot the full state first (`pre-consolidate` / `pre-restore`).
- `restoreSnapshot` (service) / `/evolution restore` rolls the state back to the latest snapshot: active tree, usage/suppression sidecars, `.archive/` and the curator state carried in the snapshot (`curator-state.json`), so the interval gate does not immediately re-fire after a rollback. Skills that were skipped at snapshot time (a live writer held their lock; recorded in the manifest's `skipped` list) are NOT restored — the restore result names them, and `.backups` may hold a copy. The restore itself is undoable — the pre-rollback safety snapshot preserves the current tree plus its state.

## Configuration

- `autoStart` (default true) arms an HOURLY tick that only asks whether the due-ness interval (`curatorIntervalHours`, default 168 h) has elapsed — the tick is not the interval — plus a deferred catch-up check `bootGraceSeconds` (default 10) after host boot. Both decide due-ness from the **persisted** `lastRunAt`, so a restart with an overdue schedule runs the first pass within the boot grace instead of waiting a full interval. `bootGraceSeconds: 0` disables the deferral (not recommended: the check may run against a half-mounted host). All scheduling gates — interval, idle, first-run deferral, and the reentrancy guard — remain inside `run()`.
- `autoStart: false` disables both automatic checks; `/evolution curator run` (manual, gate-skipping) still works.
- `autoStart` is the STARTUP default. The runtime switch is `/evolution curator pause` / `resume`: the pause is persisted in curation state, survives restarts, and wins over `autoStart` until it is cleared — turning `autoStart` off keeps curation manual, it does not freeze a schedule that is already paused or running.
- Deprecated name (G0/S0.3): `intervalHours` is the legacy spelling of the policy
  row's `curatorIntervalHours`, whose value the snapshot shadows. Reading it still
  works; writing it is refused. Removal was planned for 0.7.0 and is deferred: the alias still ships, so no later version is claimed here.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).
## Notes and history

- The one-click `/evolution consolidate <target> <source...>` remains the direct manual path (P2-8, v11: the earlier "no LLM pass proposes merge groups" wording contradicted the tested nomination chain).

## 单元与撤销（对外契约摘要）

- 一个单元 = 一次树改动（一个 unitId）。索引里只有一条记录带 unitHead，两形态互斥：代表片 { moves, sources }（全量清单 + 它写过哪些技能）／路标 { skill }（记录在别的技能里）；判别式固定为 moves !== undefined。
- undoUnit(name, unitId?)：逐路径回该单元铸的基线；没有基线才回退到最早那条的 beforeHash；单元前不存在的路径删除并锚定（盘上字节被别人改过就拒绝，不覆盖）。决策在纯函数 src/unit-undo-plan.ts，IO 与主机不进决策层。
- 跨技能单元：成员只按 sources[] 的已知 key 解析（禁止目录扫描）；缺片／外来片／重复片一律拒绝并点名对象 —— 不得用剩下的片段拼一个撤销。
- 路标的 undoable 是 undefined（wire 上不出现该键），绝不为 false；聚合时跳过路标，避免它的 hash 污染同单元兄弟片。
- 剪枝按单元 all-or-nothing；保留窗口今天仍按条目计（切换条件见仓库文档）。
- 完整说明（含回退与验证命令）见仓库 docs/units-and-undo.md；该目录不随 npm 发布，故在此摘要。
