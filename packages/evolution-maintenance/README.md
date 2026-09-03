# @deepseek-ai/dsh-evolution-maintenance

Skill-library drift-scanning determinism surface for the maintenance subagent
(design `docs/design-review/011-maintenance-subagent-v2.md`).

- `snapshotFromLibrary` — assemble a plain skill snapshot from a SkillLibrary-like reader.
- `renderFacts` — canonical `MECHANICAL_FACTS` block (version + joint signature + redaction).

Signal computation lives in `@deepseek-ai/dsh-evolution-core` (`drift-signals`); this
package owns assembly and rendering only.

## Known Limitations and Deferred Work

- Phase 1 exposes no service or command: the chain (commands → scan → render →
  subagent → validate) lands in Phase 2 of design 011.
- `probe` deep-dive tooling (Phase 3) is not implemented here.
- The model-visible template (`MAINTAIN_PROMPT`) ships in `evolution-core`
  `PROMPT_BUNDLE`; the joint-signature mismatch protocol is honored by
  `renderFacts` callers, not by this package alone.
