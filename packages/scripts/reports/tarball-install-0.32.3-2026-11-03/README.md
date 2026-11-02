# 0.32.3 dist tarball install/uninstall — 2026-11-03

Clean consumer (no DSH profile, no platform peer install), 36 packed tarballs:

```
npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund <36 tgz>
npm uninstall @lmzhen/... (all 36)
```

Result:

- install exit 0, 52 packages (36 family + 16 runtime deps), `@lmzhen` dirs = 36
- uninstall exit 0, 52 packages removed, `@lmzhen` dirs = 0

This proves tarball resolution and clean removal.

## Host boot

The same 36 tarballs were installed into an isolated DSH web profile (`profiles/web`) and the host was started on 127.0.0.1:3084. Owner-auth probes:

- diagnostics 200: familyVersion 0.32.3, installForm 完整功能包, schema 2, facts 7, runtime 8
- merge/view 200: wireVersion 1
- anonymous diagnostics: 401

Readings: `host-boot-readings.json`.
