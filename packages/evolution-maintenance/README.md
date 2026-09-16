# @deepseek-ai/dsh-evolution-maintenance

Skill-library drift-scanning determinism surface for the maintenance subagent
(design 011 — the maintenance-subagent design paper, archived in git history).

- `snapshotFromLibrary` — assemble a plain skill snapshot from a SkillLibrary-like reader.
- `renderFacts` — canonical `MECHANICAL_FACTS` block (version + joint signature + redaction).

Signal computation lives in `@deepseek-ai/dsh-evolution-core` (`drift-signals`); this
package owns assembly and rendering only.

## Known Limitations and Deferred Work

- Phase 1-2 expose no service beyond the command surface: the chain
  (commands → scan → render → subagent → validate) is wired through
  `/evolution maintain`; orchestration lives in this package.
- **Plan validation is instance-granular (§3 completeness).** The facts block
  renders one line per skill, so ONE signal id can be `over` on several skills:
  every `over` instance (`skill::id`; a library-level signal renders once and keeps
  the bare id) must be covered by plan evidence or named in a note, so a plan that
  advises one skill no longer zero-explains the same signal on its siblings (P2-4,
  0.3.83). Notes stay id-level — one mention explains away all instances of that id.
- **A budget-capped dedup scan is reported, never silently shortened.**
  `maintenance_probe` appends "note: dedup scan truncated at the pair-comparison
  budget; groups may be incomplete" and the `dedup_group` signal value carries the
  same qualification (P2-8, 0.3.83).
- `maintenance_probe` (read-only deep-dive tool, host-mounted via
  `evolution-maintenance-tools`) is available to maintenance subagents only
  through the orchestrate `toolFilter` allow-list; it is globally visible to
  every session as a read-only query (same exposure tier as the `skill`
  tool — never a write path). V10 (F-02): orchestrate soft-probes the tools
  registry before spawning and degrades the filter to `skill`-only (declared
  in the subagent prompt) when the tool row is not mounted, instead of failing
  the spawn; an explicit `toolAllow` option bypasses the probe.
- The model-visible template (`MAINTAIN_PROMPT`) and the subagent output
  instruction (`MAINTAIN_OUTPUT_INSTRUCTION`, V10 F-16) ship in `evolution-core`
  `PROMPT_BUNDLE`; the joint-signature mismatch protocol is honored by
  `renderFacts` callers, not by this package alone.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).
