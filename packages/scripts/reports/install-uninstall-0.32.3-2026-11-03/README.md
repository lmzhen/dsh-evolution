# 0.32.3 install-layered install/uninstall — 2026-11-03

Isolated profile `D:/dsh-lab-install-0323b`, harness overlay 0.32.3:

```
node packages/evolution/scripts/install-layered.mjs --home <lab> --profile web --mode layered
node packages/evolution/scripts/install-layered.mjs --home <lab> --profile web --uninstall
```

Result: install copied 36 packages, journal + preset row present; uninstall removed all 30 visible `dsh-evolution-*` dirs, journal and preset row. This is the installer path, not the dist tarball consumer path (see sibling `tarball-install-0.32.3-2026-11-03`).
