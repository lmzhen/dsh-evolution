# Real-host rehearsal — v0.32.3 (2026-11-03)

Host: isolated web profile, `http://127.0.0.1:3083`, platform 0.2.1-rc.3, npm-installed family 0.32.3.

## Captured

- `api-readings.json` — owner-auth diagnostics (schema 2, 7 facts, 8 runtime), skill-history (27 rows), merge view (wireVersion 1), anonymous 401.
- S4 contract: `pnpm exec vitest run packages/evolution/evolution-host/tests/s4-hmr-double-apply.spec.ts --maxWorkers=1` → 2/2.

## Not captured

- Browser client console / screenshots. The API readings do not claim them; the old 0.27.3 clientConsole block was removed from the rehearsal.
- CI gate ledger. `assemble-release-evidence --gates-from-manifest` is marked synthetic and `verify --release` refuses it; a real `--gates-report` from run-gates is still required.

Token was used only to establish the local owner cookie and is not stored here.
