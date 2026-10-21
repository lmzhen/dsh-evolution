---
name: dsh-desktop-source-build
description: Build and run the DSH desktop from a source tarball.
version: 0.1.0
author: Hermes
platforms: [windows]
metadata:
  hermes:
    tags: [DSH, Desktop, Electron, Build]
    related_skills: [dsh-plugin-compatibility, dsh-plugin-discovery]
---

# DSH Desktop Source Build

Builds the `@deepseek-ai/dsh-desktop` Electron shell from a DSH source tarball and runs it in
development mode against an isolated `DSH_HOME`. It does NOT produce a distributable installer:
Windows packaging requires a GlobalSign EV certificate plus a physical SafeNet token, and macOS
requires a Developer ID identity, so the official `package:desktop:*` pipeline cannot run without
the release environment.

## When to Use

- "Run the DSH desktop app", "install the desktop version" on a machine with no prebuilt installer.
- The published update channel is empty (e.g. `https://download.deepseek.com/_/harness/desktop/stable/win-x64/rc.yml` returns 404).
- Verifying desktop plugin eligibility (`dsh.bundle.patch`, registry, `strictDepBuilds`).

## Prerequisites

- Windows x64, Node `^22.19 || >=24`, pnpm available as `.cmd`, ~5 GB free on the target drive.
- The PowerShell execution policy blocks `pnpm.ps1` under **Windows PowerShell 5.1**; the DSH `pwsh` tool is **7.6.7 / RemoteSigned since 2026-10-15** and runs bare `pnpm` (measured: `pnpm --version` -> 11.17.0). Under 5.1, invoke `pnpm.cmd`.
- Behind a slow network to GitHub, set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`.

## How to Run

```powershell
tar -xzf <tarball> -C <src> --strip-components=1
cd <src>
& "$env:APPDATA\npm\pnpm.cmd" install --frozen-lockfile --reporter=append-only
$env:DSH_CLIENT_COMMIT_HASH='0d15c200'      # tarball has no .git; see Pitfalls
& "$env:APPDATA\npm\pnpm.cmd" run build
node apps\desktop\node_modules\electron\install.js   # skipped by pnpm allowBuilds
& "$env:APPDATA\npm\pnpm.cmd" run build:desktop
$env:DSH_HOME='<src>\apps\desktop\.desktop-build\development\home'
$env:DSH_DESKTOP_OPEN_DEVTOOLS='0'
& "$env:APPDATA\npm\pnpm.cmd" run start:desktop
```

## Quick Reference

| Item | Value |
|---|---|
| Root build | `build:native-system` -> `build:lib:host` (`tsc -b tsconfig.host.json` + tsdown) -> `build:lib:client` -> `build:web` |
| Dev launcher | `apps/desktop/scripts/dev.ts`, `--skip-build` = `start:desktop` |
| Isolated state | `apps/desktop/.desktop-build/development/{home,project,electron-user-data}` |
| Debug ports | main 9229, renderer 9222, host 9230 |
| Renderer page | `dsh-app://app/index.html` |

## Procedure

1. Extract the tarball to a scratch tree; never build inside a mirrored family checkout.
2. `pnpm install --frozen-lockfile`. pnpm self-selects the repo's pinned version from `packageManager`.
3. Export `DSH_CLIENT_COMMIT_HASH` (any 7-40 hex chars) before `run build`.
4. Run the root build, then `run build:desktop`.
5. If `apps/desktop/node_modules/electron/path.txt` is missing, run `install.js` in that directory.
6. Launch with an explicit `DSH_HOME` so the dev app never touches the user's real `~/.dsh`.
7. Verify with `Get-Process electron`, `(Invoke-WebRequest http://127.0.0.1:9222/json -UseBasicParsing).Content`, and `Get-Process electron | Select MainWindowTitle`.

## Desktop Plugin Gates

A plugin can only be installed through the packaged plugin window when ALL hold. Reproduce any gate
in a scratch project before predicting the outcome.

1. `package.json` declares `dsh.bundle.patch` pointing at an existing file (`inspectPlugin`).
2. The package is published on `https://registry.npmjs.org/` at the exact version; the desktop pins
   that registry and an empty private `npmrc`, so user mirrors and git specs do not apply.
3. No dependency in the closure runs `preinstall`/`install`/`postinstall` outside the fixed
   `allowBuilds` list (`node-pty`, `koffi`, `fs-ext`, `@deepseek-ai/dsh-subprocess-local`), because the
   generated workspace sets `strictDepBuilds: true`; violations fail with `ERR_PNPM_IGNORED_BUILDS`.
4. Plugin mutations are refused in development mode: "plugin package changes require a packaged application".

Scratch reproduction: copy the generated `pnpm-workspace.yaml` (`nodeLinker: hoisted`,
`autoInstallPeers: false`, `strictDepBuilds: true`, the `allowBuilds` block) plus the desktop's flags
`--config.registry=https://registry.npmjs.org/ --config.userconfig=<empty npmrc>` and run
`pnpm add <spec> --save-exact`.

## Relocating the Built Tree

Moving the tree does NOT break the pnpm links: pnpm creates **relative** symlinks
(`..\..\zod@4.4.3\node_modules\zod`), which survive a move intact. What breaks is the
**absolute paths recorded in pnpm state files**, which makes pnpm declare `node_modules`
stale and abort with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` under `pnpm run`:

| File | Stale content | Count |
|---|---|---|
| `node_modules/.modules.yaml` | `virtualStoreDir` | 1 |
| `node_modules/.pnpm-workspace-state-v1.json` | one key per workspace project | ~290 |

Rewrite the old root prefix in both files instead of reinstalling:

```powershell
$old = 'D:\\old\\tree'; $new = 'D:\\new tree'
$enc = New-Object System.Text.UTF8Encoding($false)   # never emit a BOM
foreach ($f in @("$root\node_modules\.modules.yaml", "$root\node_modules\.pnpm-workspace-state-v1.json")) {
  [System.IO.File]::WriteAllText($f, [System.IO.File]::ReadAllText($f).Replace($old, $new), $enc)
}
```

After this repair `pnpm install --frozen-lockfile` reports `Already up to date` in ~1 s (verified),
so the rewrite is sufficient on its own and no reinstall is needed.

Both files escape backslashes, so the literal to match is `D:\\old\\tree` in file bytes.
Reinstalling also works but is slower and loses the Electron download: `electron` is absent
from the workspace `allowBuilds`, so a purge removes `dist/` and `install.js` must fetch 233 MB again.

Spaces in the destination path are fine: repo scripts pass arguments as `spawn` arrays, never
through a shell.

The `.desktop-build/development/project` dir uses absolute junctions, but
`prepareDevelopmentProject` deletes and rebuilds it on every launch, so it self-heals.
## Self-Contained Launcher

Daily launching does not need pnpm at all. `start:desktop` maps to `dev.ts --skip-build`, which
skips both `runPackageScript` calls, so `npm_execpath` is never read and the pnpm version link
under `<store>/links/@/pnpm/<version>/` (pnpm `manage-package-manager-versions`) is not consulted.
Invoke the tree's own tsx with the system Node instead:

```cmd
@echo off
setlocal
set "TREE=%~dp0dl-0.1.5-rc.2-src"
set "DSH_HOME=%TREE%\apps\desktop\.desktop-build\development\home"
set "DSH_DESKTOP_OPEN_DEVTOOLS=0"
cd /d "%TREE%\apps\desktop" || exit /b 1
node "%TREE%\node_modules\tsx\dist\cli.mjs" "scripts\dev.ts" --skip-build
```

Verified: 4 Electron processes, the app window, and `dsh-app://app/index.html`, with zero processes
running from the pnpm store. The only external dependency is a system Node.js on `PATH`. A desktop
shortcut can therefore target a launcher that lives entirely inside the tree folder.
To give it a proper shortcut with no console window, wrap the .cmd in a hidden VBS launcher
and point the `.lnk` at `wscript.exe` (a `.lnk` fired straight at a `.cmd` leaves a black console):

```vbs
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base
cmd = "cmd /c """"" & base & "\start-desktop.cmd"" >> """ & base & "\desktop.log"" 2>&1"""
sh.Run cmd, 0, False   ' 0 = hidden, False = do not wait
```

Create the shortcut with `WScript.Shell` `CreateShortcut`: TargetPath = `wscript.exe`,
Arguments = the quoted `.vbs` path, IconLocation = an `.exe`/`.ico` (Windows ignores `.svg`).
Verified end to end: launching the `.lnk` yields 4 Electron processes, the app window, and
`dsh-app://app/index.html`, with zero processes from the pnpm store.
## Desktop Icon

The repo ships only `apps/web/public/favicon.svg` (a monochrome whale, no `.ico`), and Windows
`.lnk` icons require `.ico`. Rasterise with the tree's own `sharp` — SVG input works, but this
build has **no ICO output** (`sharp.format.ico.output === false`), so assemble the ICONDIR by
hand: 16/24/32/48 as classic **DIB** entries and 64/128/256 as **PNG** entries.

Recipe: `sharp(svg, { density: 720 }).resize(s, s, { fit: "contain", background: transparent })`,
then `.ensureAlpha().raw()` for DIB or `.png()` for the large sizes. ICONDIR = 6-byte header
(type 1, count), a 16-byte entry per size (width/height, 0 meaning 256, bitCount 32, length,
offset), then the payloads.

Gotchas learned the hard way:

- `sharp` >= 0.34 must be loaded as `require(dir).default ?? require(dir)`; the bare `require` returns a namespace.
- `System.Drawing` / GDI+ returns **garbage colours for PNG-compressed ICO entries**; verify small
  sizes numerically after building. DIB entries read back correctly.
- Strip the `<style>` block first: it carries a `prefers-color-scheme` rule that flips the fill,
  and `.ico` has no colour-scheme concept (one colour must be baked in).
- An array literal followed on the next line by `(async () => {})()` parses as a call — keep the semicolon.
## Desktop Plugins Are Packaged-Only (documented)

Do not try to inject plugins into a source-built (dev-mode) desktop. The repository documents this as a
formal decision in `.agents/notes/implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.md`
(177 lines, + `.zh.md`):

- Review decision: "Plugin management | Electron-only GUI and package service; **no CLI, backend, or browser installation path**."
- Rejected alternative: reusing the CLI/browser installer "crosses the desktop authorization and release scope";
  a separate desktop project "creates a **second resolution anchor** and peer-dependency fallback".
- Security: "The plugin installer API is available **only to the Electron-owned management GUI** and is absent
  from the browser application and backend RPC."
- Dev mode: "Package mutation is disabled in this mode because its **linked dependency graph is not a
  pnpm-installed desktop project**."
- Resolution anchor: "The backend and Loader use `.dsh/profiles/desktop/package.json` as their profile manifest
  and **npm resolution anchor**", and "Production startup **rejects a bundle resolved outside this profile**."
- Risk entry: the registry policy, exact versions, integrity and `allowBuilds` "require security review
  **before GUI installation ships**."

A hand-built profile fails with `Cannot find package '@deepseek-ai/dsh-agent' imported from <profile>` because
the profile must carry the complete production dependency graph; the disposable dev project sidesteps this only
because its host resolves through the workspace links.

The channel itself is a GUI text box for an npm spec (`@scope/plugin@1.2.3`) against the fixed
`https://registry.npmjs.org/`; there is no in-app catalog. `docs/user/**` contains **zero** desktop-plugin
documentation, so the rules exist only in developer docs.
## Pitfalls

- `git rev-parse HEAD` fails with exit 128 on a tarball tree; that is the only git dependency in the build.
- pnpm skips `electron`'s postinstall because it is absent from the workspace `allowBuilds`, leaving no binary.
- `Tee-Object` writes UTF-16 in PowerShell 5.1 and makes logs unreadable as text; use `Out-File -Encoding utf8`. (The DSH `pwsh` tool is 7.6.7 since 2026-10-15 and writes UTF-8, so this only bites an explicit `powershell.exe`.)
- `Invoke-WebRequest -SkipHttpErrorCheck` does not exist in PowerShell 5.1; catch the exception instead.
- Dev mode skips the seed install entirely, so nothing lands in `$DSH_HOME/profiles/desktop`.
- Restarting repeatedly leaves orphaned `dev.ts` launchers behind: their command line contains
  `scripts/dev.ts`, **not** `.desktop-build`, so a kill filter keyed on the build directory misses
  them. An orphan then makes the next Electron instance quit immediately on the single-instance
  lock, which looks like "the shortcut silently fails". Kill `electron.exe`, the host children,
  **and** the `scripts/dev.ts` node process before relaunching.
- Launching the app **from inside the agent `pwsh` tool** makes it die when that call ends: the tool
  runs commands in a Windows Job object, so a `Start-Process` child is torn down with the job. Start
  it through `explorer.exe <shortcut>` (or any out-of-job parent) instead; a user double-clicking the
  shortcut is unaffected because explorer is the parent.

## Verification

```powershell
Get-Process electron | Select-Object Id, MainWindowTitle
```

A window titled after the local build profile, plus a `dsh-app://app/index.html` renderer target,
proves the shell, preload, host child, and bundled client all started.
