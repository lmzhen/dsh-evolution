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
