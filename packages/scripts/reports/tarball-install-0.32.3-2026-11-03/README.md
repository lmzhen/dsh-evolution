# 0.32.3 dist tarball install/uninstall — 2026-11-03

Clean consumer (no DSH profile, no platform peer install), 36 packed tarballs:

```
npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund <36 tgz>
npm uninstall @lmzhen/... (all 36)
```

Result:

- install exit 0, 52 packages (36 family + 16 runtime deps), `@lmzhen` dirs = 36
- uninstall exit 0, 52 packages removed, `@lmzhen` dirs = 0

This proves tarball resolution and clean removal. It does **not** boot a DSH host; platform peers are supplied by the host in a real profile. That is still a CI/real-profile gate.
