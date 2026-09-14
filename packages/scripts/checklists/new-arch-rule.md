# New architecture rule

Skeleton: `templates/rule/rule-snippet.mjs.tmpl` (into
`packages/scripts/verify-arch-guards.mjs`).

Rule ids are append-only labels: **never reuse or renumber a landed id** — docs,
registers and probe baselines cite them. Take the next free number after N19.

## Checklist

- [ ] The rule answers "which failure already happened?" — a rule without an
      incident goes to the not-doing list instead (the family's anti-overreach
      discipline). Write that incident into the docblock entry.
- [ ] Docblock entry in the file header, same style as the others:
      ` *   N<id>. <one-line claim>` followed by the incident and the register
      name. The startup inventory check reads exactly this shape.
- [ ] `RULES` registry entry `{ id, title }` — appended at the END of the array.
- [ ] A **detector self-test** in the `detectors` list at startup: samples must be
      INCIDENT shapes (the spelling that actually shipped), plus one clean shape
      that must stay clean. A detector that matches nothing reports a pass. —
      *`verify-arch-guards.mjs` fails its own self-test and exits 1.*
- [ ] A **vacuity sentry** for the tree pass: an empty/misconfigured tree must
      name what it could not check instead of passing. — *the N8 "no manifest
      read" and N19 "not armed / zero facts / zero docs" messages are the
      pattern.*
- [ ] If the rule needs an escape hatch, make it a named register (a `Set` of
      keys with reasons) — never a silent allowlist in the detector.
- [ ] Fixtures in `packages/evolution-host/tests/guard-scripts.spec.ts`: one
      positive run on the real tree, one deliberate violation that must name the
      site and the fix. — *scripts are outside oxlint; the fixture IS the proof.*
- [ ] `node packages/scripts/verify-arch-guards.mjs packages --strict` is 0
      violations on the real mirror tree, and `--list-rules` prints the new id.
- [ ] Rule count in the OK summary line and in any doc that counts rules.
