{
  "level": "L1",
  "skill_a": {
    "id": "dsh-plugin-compatibility",
    "description": "Audit DSH plugins against a new release and fix what breaks.",
    "head": "Audit DSH plugins against a new release and fix what breaks.\n\n# DSH Plugin Compatibility\n\nDSH has changed its client module-system protocol between releases. Plugins\nthat hard-code an old global usually break on newer hosts with errors like:\n\n- `[plugin] chunk \"x\": client module system unavailable`\n- `client-modules: window.__DSH_MODULES__ missing`\n- `window.__ModuleLoader__ bootstrap facade is missing`\n- lazy-loaded chunk externals fail to resolve after a DSH upgrade\n\n**Host-service contract changes also break plugins** — audit every host API\nyour plugin consumes after a DSH upgrade, not just the client surface. See\n`references/session-projection-contract-011.md` for the 0.1.0-rc.6 → 0.1.1\n`sessionProjections.register` contract change (`schema`/`view` →\n`stateSchema` + `wire.viewSchema`, cold reads call `stateSchema.parse`) and\nthe dual-contract registration shim that serves both host lines.\n\n### Browser-realm service rename: `settingsScope` → `configForms` (0.1.7-rc.2)\n\nThe seam was **replaced, not aliased** — and the API moved with the name:\n`bind({ namespace })` → `get(entryId)`, writes return `Promise<boolean>`, and\nregistration is now `whileServed`. Version boundaries, declared-at paths, the\nmeasured fallout and the upgrade recipe: `references/browser-realm-seam-rename.md`.\n\n`settingsScope` is **0 hits in the whole 0.1.7-rc.2 and 0.2.0-rc.2 trees** except\n`.agents/notes/**` prose (one *implemented* note still names the old symbol — a\nstale doc, not evidence; trust the code). An ecosystem plugin that lists\n`settingsScope` in its client `export const inject = [...]` stays **PENDING\nforever** (cordis required inject has no timeout), so its whole browser half\nsilently never mounts — no error, no crash, just a missing UI. Cascades outweigh\ncounts: where a compat shim wraps the seam, every sibling that falls back to\nthat shim dies with it (measured numbers in the reference file).\n\n### Three edges, not one — and two planes a Context diff cannot see\n\nScan **every tree in the corridor**, not the two endpoints: the same 0.1.5-rc.2 → 0.2.0-rc.2 delta splits across three edges, and mis-attributing them makes the migration plan wrong.\n\n| break | first version it is gone | how it was pinned |\n|---|---|---|\n| `settingsScope` (client seam) | **0.1.7-alpha.1** | present in 0.1.6-alpha.1 (`packages/client/ui-settings/src/client/settings-scope.ts`), replaced by `config-f"
  },
  "skill_b": {
    "id": "dsh-plugin-discovery",
    "description": "Rank DSH plugins from the live market catalog and GitHub.",
    "head": "Rank DSH plugins from the live market catalog and GitHub.\n\n# DSH Plugin Discovery & Ranking\n\nUse when the user wants to find, compare, or rank DSH community plugins by\ntopic, category, stars, downloads, or maintenance signals.\n\n# does not expose ./lib/* -> ERR_PACKAGE_PATH_NOT_EXPORTED. Import by file URL.\n### `gh api --jq` 的准确边界（比\"\\(...) 会被 mangled\"更精确）"
  },
  "scores": {
    "jaccard_summary": 0.1905,
    "jaccard_body": 0.1108,
    "summary_cosine": 0.6829
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