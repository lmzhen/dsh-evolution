{
  "level": "L1",
  "skill_a": {
    "id": "dsh-plugin-discovery",
    "description": "Rank DSH plugins from the live market catalog and GitHub.",
    "head": "Rank DSH plugins from the live market catalog and GitHub.\n\n# DSH Plugin Discovery & Ranking\n\nUse when the user wants to find, compare, or rank DSH community plugins by\ntopic, category, stars, downloads, or maintenance signals.\n\n# does not expose ./lib/* -> ERR_PACKAGE_PATH_NOT_EXPORTED. Import by file URL.\n### `gh api --jq` 的准确边界（比\"\\(...) 会被 mangled\"更精确）"
  },
  "skill_b": {
    "id": "platform-plugin-port-verification",
    "description": "Prove a plugin port against a new platform release.",
    "head": "Prove a plugin port against a new platform release.\n\n# Platform Plugin Port Verification\n\nAdapt a plugin to a new release of the platform that hosts it, and prove the port\nagainst the installed copy rather than against prose. The work ends as a landed\nchange set, refreshed docs, and one versioned release. It assumes the target\nplatform is installed locally so its bundled implementation, its docs, and its\nCLI can all be read and run; it does not cover authoring a plugin from scratch.\nSession-specific evidence lives in `references/openclaw-2026.9.4-seams.md` (seam map, live-proof commands, the four defects a live run exposed, and the claims left unverified).\n\n- \"This plugin was written for <older version>; make it work on <new version>.\"\n- A port review asks which platform interfaces a plugin uses and whether each use is still correct.\n- An audit document claims gaps; you must decide which are real, fix them, and record why.\n- Seam symptoms: a hook never fires, an approval never appears, a prompt section moved, a declared capability is silently absent.\n\n- Installed copy of the target platform. Its bundled JS **and** its `docs/` are both evidence; every quoted line number must come from the install, not from the upstream source tree.\n- The port's upstream implementation, plus a sibling port when one exists (the sibling shows which divergences are intentional).\n- An isolated instance for live proof: its own profile/state dir, its own port, a scratch workspace. Never prove behavior in the user's live instance.\n- A gate pair that always runs together (typecheck + the repo's behavior suite) and one home document for evidence.\n\n1. Inventory the plugin's platform call sites first (per-API counts, not prose).\n2. Read each seam in the install: type declarations + implementation + docs page; record `path:line`.\n3. Decide per seam: valid / renamed / removed / behavior-changed / better equivalent exists.\n4. Design invariants and fallbacks before code; one owner per responsibility.\n5. Implement in small batches; run the gate pair after every batch; commit each green batch.\n6. Prove each batch on the isolated instance with a real turn and a real tool call.\n7. Refresh all docs, bump every manifest, present the release checklist, publish on approval.\n\n| Need | Method that worked |\n|---|---|\n| Seam contract | grep the installed bundle for the symbol; confirm against `docs/`; l"
  },
  "scores": {
    "jaccard_summary": 0.05,
    "jaccard_body": 0.1583,
    "summary_cosine": 0.5849
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