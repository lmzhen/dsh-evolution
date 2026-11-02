# 0.32.3 packed tarball audit — 2026-11-03

Built from the harness overlay (version 0.32.3), not from the flat mirror:

```
cd D:\dsh\harness-0.2.1
node packages/evolution/scripts/build-lib.mjs
node packages/evolution/scripts/prepare-release.mjs --scope '@lmzhen' --version 0.32.3
node packages/evolution/scripts/audit-release-tarballs.mjs packages/evolution/dist --version 0.32.3 --platform-range '^0.2.1-rc.2'
```

Result: 36 tarballs, audit exit 0.

- `audit.txt` — full audit output.
- `sha256.txt` — per-tarball sha256.
- `summary.txt` — package count, manifest sha256, mirror HEAD at capture.

The tarball's merge bundle contains the P1-6 fix (`parentRunId: options.runId`) and the P2-20 undeclared staged-file check. Platform consumer import smoke is still CI-only: this machine's harness node_modules lacks the installed platform packages, and the flat mirror cannot build standalone (overlay tsconfig references).
