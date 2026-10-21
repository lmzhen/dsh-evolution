{
  "level": "L1",
  "skill_a": {
    "id": "dsh-plugin-compatibility",
    "description": "Audit DSH plugins against a new release and fix what breaks.",
    "head": "Audit DSH plugins against a new release and fix what breaks.\n\n# DSH Plugin Compatibility\n\nDSH has changed its client module-system protocol between releases. Plugins\nthat hard-code an old global usually break on newer hosts with errors like:\n\n- `[plugin] chunk \"x\": client module system unavailable`\n- `client-modules: window.__DSH_MODULES__ missing`\n- `window.__ModuleLoader__ bootstrap facade is missing`\n- lazy-loaded chunk externals fail to resolve after a DSH upgrade\n\n**Host-service contract changes also break plugins** — audit every host API\nyour plugin consumes after a DSH upgrade, not just the client surface. See\n`references/session-projection-contract-011.md` for the 0.1.0-rc.6 → 0.1.1\n`sessionProjections.register` contract change (`schema`/`view` →\n`stateSchema` + `wire.viewSchema`, cold reads call `stateSchema.parse`) and\nthe dual-contract registration shim that serves both host lines.\n\n### Browser-realm service rename: `settingsScope` → `configForms` (0.1.7-rc.2)\n\nThe seam was **replaced, not aliased** — and the API moved with the name:\n`bind({ namespace })` → `get(entryId)`, writes return `Promise<boolean>`, and\nregistration is now `whileServed`. Version boundaries, declared-at paths, the\nmeasured fallout and the upgrade recipe: `references/browser-realm-seam-rename.md`.\n\n`settingsScope` is **0 hits in the whole 0.1.7-rc.2 and 0.2.0-rc.2 trees** except\n`.agents/notes/**` prose (one *implemented* note still names the old symbol — a\nstale doc, not evidence; trust the code). An ecosystem plugin that lists\n`settingsScope` in its client `export const inject = [...]` stays **PENDING\nforever** (cordis required inject has no timeout), so its whole browser half\nsilently never mounts — no error, no crash, just a missing UI. Cascades outweigh\ncounts: where a compat shim wraps the seam, every sibling that falls back to\nthat shim dies with it (measured numbers in the reference file).\n\n### Three edges, not one — and two planes a Context diff cannot see\n\nScan **every tree in the corridor**, not the two endpoints: the same 0.1.5-rc.2 → 0.2.0-rc.2 delta splits across three edges, and mis-attributing them makes the migration plan wrong.\n\n| break | first version it is gone | how it was pinned |\n|---|---|---|\n| `settingsScope` (client seam) | **0.1.7-alpha.1** | present in 0.1.6-alpha.1 (`packages/client/ui-settings/src/client/settings-scope.ts`), replaced by `config-f"
  },
  "skill_b": {
    "id": "platform-plugin-port-verification",
    "description": "Prove a plugin port against a new platform release.",
    "head": "Prove a plugin port against a new platform release.\n\n# Platform Plugin Port Verification\n\nAdapt a plugin to a new release of the platform that hosts it, and prove the port\nagainst the installed copy rather than against prose. The work ends as a landed\nchange set, refreshed docs, and one versioned release. It assumes the target\nplatform is installed locally so its bundled implementation, its docs, and its\nCLI can all be read and run; it does not cover authoring a plugin from scratch.\nSession-specific evidence lives in `references/openclaw-2026.9.4-seams.md` (seam map, live-proof commands, the four defects a live run exposed, and the claims left unverified).\n\n- \"This plugin was written for <older version>; make it work on <new version>.\"\n- A port review asks which platform interfaces a plugin uses and whether each use is still correct.\n- An audit document claims gaps; you must decide which are real, fix them, and record why.\n- Seam symptoms: a hook never fires, an approval never appears, a prompt section moved, a declared capability is silently absent.\n\n- Installed copy of the target platform. Its bundled JS **and** its `docs/` are both evidence; every quoted line number must come from the install, not from the upstream source tree.\n- The port's upstream implementation, plus a sibling port when one exists (the sibling shows which divergences are intentional).\n- An isolated instance for live proof: its own profile/state dir, its own port, a scratch workspace. Never prove behavior in the user's live instance.\n- A gate pair that always runs together (typecheck + the repo's behavior suite) and one home document for evidence.\n\n1. Inventory the plugin's platform call sites first (per-API counts, not prose).\n2. Read each seam in the install: type declarations + implementation + docs page; record `path:line`.\n3. Decide per seam: valid / renamed / removed / behavior-changed / better equivalent exists.\n4. Design invariants and fallbacks before code; one owner per responsibility.\n5. Implement in small batches; run the gate pair after every batch; commit each green batch.\n6. Prove each batch on the isolated instance with a real turn and a real tool call.\n7. Refresh all docs, bump every manifest, present the release checklist, publish on approval.\n\n| Need | Method that worked |\n|---|---|\n| Seam contract | grep the installed bundle for the symbol; confirm against `docs/`; l"
  },
  "scores": {
    "jaccard_summary": 0.2941,
    "jaccard_body": 0.0916,
    "summary_cosine": 0.6516
  },
  "note": "这是两份技能的能力宣言段与触发条件；仍不足请回 0。",
  "schema": {
    "verdict": "1 | 0 | -1",
    "reason": "<one sentence, in Chinese>",
    "evidence": [
      {
        "path": "<file>",
        "line": "<n or -1>",
        "quote": "<short quote>"
      }
    ]
  }
}